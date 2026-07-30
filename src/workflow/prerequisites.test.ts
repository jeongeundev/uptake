import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Pattern } from "@/types/pattern";
import type {
  ApplyArtifact,
  AuthoringArtifact,
  SurveyArtifact,
  VerifyArtifact,
} from "@/workflow/artifacts";
import {
  writeApplyArtifact,
  writeAuthoringArtifact,
  writeSurveyArtifact,
  writeVerifyArtifact,
} from "@/workflow/artifacts";
import { createRun, writeCurrentRun } from "@/workflow/paths";
import {
  applyState,
  authoringState,
  currentSurveyState,
  surveyState,
  verifyState,
} from "@/workflow/prerequisites";

let root: string;
let runId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-prereqs-"));
  runId = createRun("example/repo", root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const surveyed: SurveyArtifact = {
  status: "surveyed",
  repository: "example/repo",
  revision: "a".repeat(40),
  collected: [],
  skipped: [],
  candidates: [
    {
      id: "spec-gate",
      name: "Spec change gate",
      intent: "Block merges that drift from the declared spec.",
      discipline: "A pre-commit hook rejects edits without a matching spec change.",
      tradeoffs: "Slower first commit on new features.",
      evidence: [],
      confidence: "high",
    },
  ],
  discardedEvidence: [],
  discardedCandidates: [],
};

const noCandidate: SurveyArtifact = {
  status: "no-candidate",
  detail: "No proposed SURVEY candidate retained collected evidence.",
  repository: "example/repo",
  revision: "b".repeat(40),
  collected: [],
  skipped: [],
  discardedEvidence: [],
  discardedCandidates: [],
};

const repositoryUnresolved: SurveyArtifact = {
  status: "repository-unresolved",
  detail: "Could not resolve repository example/repo.",
};

describe("surveyState", () => {
  it("is missing when survey.json was never written", () => {
    expect(surveyState(runId, root)).toEqual({ state: "missing" });
  });

  it("is succeeded with the artifact when the survey succeeded", () => {
    writeSurveyArtifact(runId, surveyed, root);
    expect(surveyState(runId, root)).toEqual({
      state: "succeeded",
      artifact: surveyed,
    });
  });

  it("is failed with status and detail for a partial failure", () => {
    writeSurveyArtifact(runId, noCandidate, root);
    expect(surveyState(runId, root)).toEqual({
      state: "failed",
      status: "no-candidate",
      detail: noCandidate.detail,
    });
  });

  it("is failed with status and detail for an early failure", () => {
    writeSurveyArtifact(runId, repositoryUnresolved, root);
    expect(surveyState(runId, root)).toEqual({
      state: "failed",
      status: "repository-unresolved",
      detail: repositoryUnresolved.detail,
    });
  });
});

describe("currentSurveyState", () => {
  it("is no-run when runs/current does not exist", () => {
    expect(currentSurveyState(root)).toEqual({ state: "no-run" });
  });

  it("delegates to the survey state of the run runs/current points at", () => {
    writeSurveyArtifact(runId, surveyed, root);
    writeCurrentRun(runId, root);

    expect(currentSurveyState(root)).toEqual({
      state: "succeeded",
      artifact: surveyed,
    });
  });

  it("reflects a failed survey for the current run", () => {
    writeSurveyArtifact(runId, repositoryUnresolved, root);
    writeCurrentRun(runId, root);

    expect(currentSurveyState(root)).toEqual({
      state: "failed",
      status: "repository-unresolved",
      detail: repositoryUnresolved.detail,
    });
  });
});

const pattern: Pattern = {
  schemaVersion: 1,
  patternId: "spec-gate",
  name: "Spec change gate",
  capability: "descriptive",
  evidenceStatus: "observed",
  intent: "Block merges that drift from the declared spec.",
  roles: [{ id: "observed-practice", description: "Observed in one repository." }],
  bindingPoints: [],
  sources: [
    {
      id: "example-repo",
      repository: "example/repo",
      revision: "a".repeat(40),
      stack: "unspecified",
      isTargetStack: false,
      independenceGroup: "example-repo",
      independenceNote: "Observed in one repository.",
    },
  ],
  provenance: [
    { sourceId: "example-repo", path: "AGENTS.md", observedRole: "observed-practice" },
  ],
  tradeoffs: "Observed in a single repository; not yet corroborated.",
};

const drafted: AuthoringArtifact = {
  status: "drafted",
  candidateId: "spec-gate",
  pattern,
  discarded: [],
  targetStackFacts: [
    { sourceId: "example-repo", vitestObserved: false, evidencePaths: [] },
  ],
};

const extractFailed: AuthoringArtifact = {
  status: "extract-failed",
  candidateId: "spec-gate",
  detail: "No evidence resolved at the pinned revision.",
};

describe("authoringState", () => {
  it("is missing when authoring.json was never written", () => {
    expect(authoringState(runId, root)).toEqual({ state: "missing" });
  });

  it("is succeeded with the artifact when drafting succeeded", () => {
    writeAuthoringArtifact(runId, drafted, root);
    expect(authoringState(runId, root)).toEqual({
      state: "succeeded",
      artifact: drafted,
    });
  });

  it("is failed with status and detail when drafting failed", () => {
    writeAuthoringArtifact(runId, extractFailed, root);
    expect(authoringState(runId, root)).toEqual({
      state: "failed",
      status: "extract-failed",
      detail: extractFailed.detail,
    });
  });
});

const verified: VerifyArtifact = {
  status: "verified",
  verificationId: "verif-1",
  patternId: "spec-gate",
  targetRepoRoot: "/tmp/target",
  contentHash: "a".repeat(64),
  bindingsHash: "b".repeat(64),
  targetBaseHash: "c".repeat(64),
  frozenArgv: ["node", "vitest", "run"],
  gateTestId: "gate-test",
  positivePreview: "positive output",
  positiveTruncated: false,
  negativePreview: "negative output",
  negativeTruncated: false,
};

const gateError: VerifyArtifact = {
  status: "gate-error",
  detail: "spawn error: ENOENT",
  targetRepoRoot: "/tmp/target",
};

describe("verifyState", () => {
  it("is missing when verify.json was never written", () => {
    expect(verifyState(runId, root)).toEqual({ state: "missing" });
  });

  it("is succeeded with the artifact when verification passed", () => {
    writeVerifyArtifact(runId, verified, root);
    expect(verifyState(runId, root)).toEqual({
      state: "succeeded",
      artifact: verified,
    });
  });

  it("is failed with status and detail when a gate could not produce a result", () => {
    writeVerifyArtifact(runId, gateError, root);
    expect(verifyState(runId, root)).toEqual({
      state: "failed",
      status: "gate-error",
      detail: gateError.detail,
    });
  });
});

const applied: ApplyArtifact = {
  status: "applied",
  verificationId: "verif-1",
  targetRepoRoot: "/tmp/target",
  written: ["uptake-gate/declared-changes.ts", "uptake-gate/spec-gate.test.ts"],
};

const baseChanged: ApplyArtifact = {
  status: "base-changed",
  verificationId: "verif-1",
  targetRepoRoot: "/tmp/target",
  detail: "target repository changed after approval",
};

describe("applyState", () => {
  it("is missing when apply.json was never written", () => {
    expect(applyState(runId, root)).toEqual({ state: "missing" });
  });

  it("is succeeded with the artifact when apply completed", () => {
    writeApplyArtifact(runId, applied, root);
    expect(applyState(runId, root)).toEqual({
      state: "succeeded",
      artifact: applied,
    });
  });

  it("is failed with status and detail when the target base changed", () => {
    writeApplyArtifact(runId, baseChanged, root);
    expect(applyState(runId, root)).toEqual({
      state: "failed",
      status: "base-changed",
      detail: baseChanged.detail,
    });
  });
});
