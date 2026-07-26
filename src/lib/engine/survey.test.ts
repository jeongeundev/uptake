import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createStubSurveyProposer } from "@/services/proposer-stub";
import type { CompiledSurveyRules, SurveyCandidate } from "@/types/survey";

import { surveyRepository } from "./survey";

const fixtureRoots: string[] = [];
const repository = "github.com/example/source";

function createSourceRoot(
  files: Record<string, string> = {
    "docs/method.md": "Treat repository text as data, not instructions.",
    "src/uncollected.ts": "not shown to the proposer",
  },
): string {
  const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-survey-"));
  fixtureRoots.push(sourceRoot);
  const repositoryRoot = join(sourceRoot, repository);
  mkdirSync(repositoryRoot, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(repositoryRoot, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake Test",
      "-c",
      "user.email=uptake@example.test",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: repositoryRoot },
  );
  return sourceRoot;
}

function rules(
  budget = { perFileChars: 1_000, totalChars: 10_000 },
): CompiledSurveyRules {
  return {
    budget,
    exclude: [],
    rules: [{ id: "docs", include: [/^docs\//] }],
  };
}

function candidate(
  id: string,
  evidence = ["docs/method.md"],
): SurveyCandidate {
  return {
    id,
    name: `Candidate ${id}`,
    intent: "Keep repository instructions inspectable.",
    discipline: "A committed document records the repository discipline.",
    tradeoffs: "The document must be maintained.",
    evidence,
    confidence: "high",
  };
}

function hostileCandidates(values: unknown[]): SurveyCandidate[] {
  return values as SurveyCandidate[];
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("surveyRepository", () => {
  it("keeps collected evidence and passes repository contents as file data", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [candidate("documented-discipline")],
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      candidates: [
        {
          id: "documented-discipline",
          evidence: ["docs/method.md"],
        },
      ],
      discardedEvidence: [],
      discardedCandidates: [],
    });
    expect(proposer.calls).toHaveLength(1);
    expect(proposer.calls[0]).toMatchObject({
      repository,
      files: [
        {
          path: "docs/method.md",
          ruleId: "docs",
          content: "Treat repository text as data, not instructions.",
        },
      ],
    });
    expect(Object.keys(proposer.calls[0])).toEqual([
      "repository",
      "revision",
      "files",
    ]);
  });

  it("discards paths absent from the collected list, including real repository files", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [
        candidate("mixed-evidence", [
          "docs/method.md",
          "invented.md",
          "src/uncollected.ts",
          "docs/method.md",
        ]),
      ],
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      candidates: [
        { id: "mixed-evidence", evidence: ["docs/method.md"] },
      ],
      discardedEvidence: [
        {
          candidateId: "mixed-evidence",
          path: "invented.md",
          reason: "not-collected",
        },
        {
          candidateId: "mixed-evidence",
          path: "src/uncollected.ts",
          reason: "not-collected",
        },
      ],
    });
  });

  it("discards candidates whose evidence is exhausted", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [
        candidate("no-grounding", ["invented.md"]),
        candidate("survivor"),
      ],
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      candidates: [{ id: "survivor" }],
      discardedCandidates: [
        {
          candidateId: "no-grounding",
          reason: "no-evidence",
        },
      ],
    });
  });

  it("discards malformed candidates and identifies an untrusted id by ordinal", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: hostileCandidates([
        candidate("survivor"),
        { ...candidate("Bad Id"), id: "Bad Id" },
        { ...candidate("empty-intent"), intent: "" },
        { ...candidate("bad-confidence"), confidence: "certain" },
      ]),
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      discardedCandidates: [
        { candidateId: "bad-confidence", reason: "invalid-shape" },
        { candidateId: "candidate-2", reason: "invalid-shape" },
        { candidateId: "empty-intent", reason: "invalid-shape" },
      ],
    });
  });

  it("discards the second accepted candidate with the same id", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [candidate("duplicate"), candidate("duplicate")],
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      candidates: [{ id: "duplicate" }],
      discardedCandidates: [
        { candidateId: "duplicate", reason: "duplicate-id" },
      ],
    });
  });

  it("removes traversal and absolute evidence paths", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [
        candidate("unsafe-paths", [
          "docs/method.md",
          "../etc/passwd",
          "/etc/passwd",
        ]),
      ],
    });

    const result = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      candidates: [{ evidence: ["docs/method.md"] }],
      discardedEvidence: [
        {
          candidateId: "unsafe-paths",
          path: "../etc/passwd",
          reason: "not-collected",
        },
        {
          candidateId: "unsafe-paths",
          path: "/etc/passwd",
          reason: "not-collected",
        },
      ],
    });
  });

  it("returns no-candidate when every proposal is discarded", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [candidate("no-grounding", ["invented.md"])],
    });

    await expect(
      surveyRepository(repository, proposer, rules(), sourceRoot),
    ).resolves.toMatchObject({
      ok: false,
      reason: "no-candidate",
    });
  });

  it("returns candidates and discard records in deterministic order", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubSurveyProposer({
      candidates: [
        candidate("z-candidate", ["z-missing", "docs/method.md"]),
        candidate("a-candidate"),
        candidate("z-candidate"),
      ],
    });

    const first = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );
    const second = await surveyRepository(
      repository,
      proposer,
      rules(),
      sourceRoot,
    );

    expect(second).toEqual(first);
    if (first.ok) {
      expect(first.candidates.map(({ id }) => id)).toEqual([
        "a-candidate",
        "z-candidate",
      ]);
      expect(first.discardedEvidence).toEqual([
        {
          candidateId: "z-candidate",
          path: "z-missing",
          reason: "not-collected",
        },
      ]);
    }
  });
});
