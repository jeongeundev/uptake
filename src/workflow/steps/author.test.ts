import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validatePatternValue } from "@/lib/catalog/load";
import { createStubSurveyProposer } from "@/services/proposer-stub";
import { __setSurveyProposerForTests } from "@/services/survey-proposer";
import type { SurveyCandidate } from "@/types/survey";
import {
  readAuthoringArtifact,
  readSurveyArtifact,
  writeSurveyArtifact,
} from "@/workflow/artifacts";
import { runAuthorCommand } from "@/workflow/steps/author";
import { runSurveyCommand } from "@/workflow/steps/survey";

let root: string;
let sources: string;
let previousSourceRoot: string | undefined;

const candidate: SurveyCandidate = {
  id: "review-gate",
  name: "Review gate",
  intent: "Require a review before accepting a change.",
  discipline: "A committed review policy records the blocking review gate.",
  tradeoffs: "Reviews add latency before changes can land.",
  evidence: ["AGENTS.md"],
  confidence: "high",
};

function createRepository(name: string, files: Record<string, string>): string {
  const path = join(sources, name);
  mkdirSync(path, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(path, file), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["add", "."], { cwd: path });
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
    { cwd: path },
  );
  return path;
}

function commitFile(repositoryPath: string, file: string, content: string): void {
  writeFileSync(join(repositoryPath, file), content);
  execFileSync("git", ["add", "."], { cwd: repositoryPath });
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
      "second",
    ],
    { cwd: repositoryPath },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-author-"));
  sources = join(root, "sources");
  mkdirSync(sources, { recursive: true });
  previousSourceRoot = process.env.UPTAKE_SOURCE_ROOT;
  process.env.UPTAKE_SOURCE_ROOT = sources;
});

afterEach(() => {
  __setSurveyProposerForTests(undefined);
  if (previousSourceRoot === undefined) {
    delete process.env.UPTAKE_SOURCE_ROOT;
  } else {
    process.env.UPTAKE_SOURCE_ROOT = previousSourceRoot;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("runAuthorCommand", () => {
  it("adopts a candidate, records authoring.json, and does not touch catalog/", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const surveyed = await runSurveyCommand("example/one", root);
    expect(surveyed.exitCode).toBe(0);
    const runId = surveyed.runId as string;

    const result = await runAuthorCommand(candidate.id, root);

    expect(result.exitCode).toBe(0);
    const artifact = readAuthoringArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "drafted",
      candidateId: candidate.id,
    });
    if (artifact?.status !== "drafted") throw new Error("expected drafted");
    expect(artifact.pattern.patternId).toBe(candidate.id);
    expect(artifact.pattern.capability).toBe("descriptive");
    expect(artifact.pattern.evidenceStatus).toBe("observed");
    expect(existsSync(join(root, "catalog"))).toBe(false);
  });

  it("serializes a pattern that validatePatternValue accepts as-is", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const surveyed = await runSurveyCommand("example/one", root);
    const runId = surveyed.runId as string;

    await runAuthorCommand(candidate.id, root);

    const artifact = readAuthoringArtifact(runId, root);
    if (artifact?.status !== "drafted") throw new Error("expected drafted");
    const validation = validatePatternValue(
      artifact.pattern,
      `${artifact.pattern.patternId}.json`,
      sources,
    );
    expect(validation.ok).toBe(true);
  });

  it("pins the survey revision even if the source repository's HEAD moves afterward", async () => {
    const repositoryPath = createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const surveyed = await runSurveyCommand("example/one", root);
    const runId = surveyed.runId as string;
    const surveyedArtifact = readSurveyArtifact(runId, root);
    if (surveyedArtifact?.status !== "surveyed") {
      throw new Error("expected surveyed");
    }
    const pinnedRevision = surveyedArtifact.revision;

    commitFile(repositoryPath, "unrelated.md", "unrelated change\n");

    const result = await runAuthorCommand(candidate.id, root);

    expect(result.exitCode).toBe(0);
    const artifact = readAuthoringArtifact(runId, root);
    if (artifact?.status !== "drafted") throw new Error("expected drafted");
    expect(artifact.pattern.sources[0]?.revision).toBe(pinnedRevision);
  });

  it("exits 2 and points at survey when no run has been recorded", async () => {
    const result = await runAuthorCommand(candidate.id, root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("uptake survey");
  });

  it("exits 2 and surfaces the failure reason when the current survey did not succeed", async () => {
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const surveyed = await runSurveyCommand("example/does-not-exist", root);
    expect(surveyed.exitCode).toBe(2);

    const result = await runAuthorCommand(candidate.id, root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("repository-unresolved");
    expect(result.message).toContain("uptake survey");
  });

  it("exits 2 and lists available candidates when candidateId is unknown", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    await runSurveyCommand("example/one", root);

    const result = await runAuthorCommand("does-not-exist", root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain(candidate.id);
  });

  it("exits 1 and records a failed authoring.json when evidence cannot be resolved at the pinned revision", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const surveyed = await runSurveyCommand("example/one", root);
    const runId = surveyed.runId as string;
    const surveyedArtifact = readSurveyArtifact(runId, root);
    if (surveyedArtifact?.status !== "surveyed") {
      throw new Error("expected surveyed");
    }
    writeSurveyArtifact(
      runId,
      {
        ...surveyedArtifact,
        candidates: [{ ...candidate, evidence: ["missing-file.md"] }],
      },
      root,
    );

    const result = await runAuthorCommand(candidate.id, root);

    expect(result.exitCode).toBe(1);
    const artifact = readAuthoringArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "provenance-unresolvable",
      candidateId: candidate.id,
    });
    expect(existsSync(join(root, "catalog"))).toBe(false);
  });
});
