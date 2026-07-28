import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SurveyArtifact } from "@/workflow/artifacts";
import { writeSurveyArtifact } from "@/workflow/artifacts";
import { createRun, writeCurrentRun } from "@/workflow/paths";
import { currentSurveyState, surveyState } from "@/workflow/prerequisites";

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
