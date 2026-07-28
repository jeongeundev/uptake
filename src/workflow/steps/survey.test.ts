import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStubSurveyProposer } from "@/services/proposer-stub";
import { __setSurveyProposerForTests } from "@/services/survey-proposer";
import { readSurveyArtifact } from "@/workflow/artifacts";
import { readCurrentRun } from "@/workflow/paths";
import { runSurveyCommand } from "@/workflow/steps/survey";
import type { SurveyCandidate } from "@/types/survey";

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

function createRepository(name: string, files: Record<string, string>): void {
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
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-survey-"));
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

describe("runSurveyCommand", () => {
  it("surveys a repository, records survey.json, and points current at the run", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));

    const result = await runSurveyCommand("example/one", root);

    expect(result.exitCode).toBe(0);
    expect(result.runId).toBeDefined();
    const runId = result.runId as string;
    const artifact = readSurveyArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "surveyed",
      repository: "example/one",
      candidates: [{ id: candidate.id }],
    });
    if (artifact?.status !== "surveyed") throw new Error("expected surveyed");
    expect(artifact.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(readCurrentRun(root)).toBe(runId);
  });

  it("creates a new run on every invocation and keeps the earlier run's survey.json", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));

    const first = await runSurveyCommand("example/one", root);
    const second = await runSurveyCommand("example/one", root);

    expect(first.runId).not.toBe(second.runId);
    expect(readSurveyArtifact(first.runId as string, root)).toMatchObject({
      status: "surveyed",
    });
    expect(readSurveyArtifact(second.runId as string, root)).toMatchObject({
      status: "surveyed",
    });
    expect(readCurrentRun(root)).toBe(second.runId);
  });

  it("records repository-unresolved and exits 2 without pinning a revision", async () => {
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));

    const result = await runSurveyCommand("example/does-not-exist", root);

    expect(result.exitCode).toBe(2);
    const runId = result.runId as string;
    expect(readSurveyArtifact(runId, root)).toEqual({
      status: "repository-unresolved",
      detail: expect.any(String),
    });
    expect(readCurrentRun(root)).toBe(runId);
  });

  it("records no-candidate and exits 1 when every proposed candidate is discarded", async () => {
    createRepository("example/one", {
      "AGENTS.md": "Changes require review.\n",
    });
    __setSurveyProposerForTests(
      createStubSurveyProposer({
        candidates: [{ ...candidate, evidence: ["invented.md"] }],
      }),
    );

    const result = await runSurveyCommand("example/one", root);

    expect(result.exitCode).toBe(1);
    const runId = result.runId as string;
    const artifact = readSurveyArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "no-candidate",
      repository: "example/one",
      discardedCandidates: [{ candidateId: candidate.id, reason: "no-evidence" }],
    });
  });

  it("records no-signal with the pinned revision and exits 1 when no file matches a rule", async () => {
    createRepository("example/unmatched", {
      "index.ts": "export {}\n",
    });
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [] }));

    const result = await runSurveyCommand("example/unmatched", root);

    expect(result.exitCode).toBe(1);
    const runId = result.runId as string;
    const artifact = readSurveyArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "no-signal",
      repository: "example/unmatched",
      revision: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
  });
});
