import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Pattern } from "@/types/pattern";
import {
  WorkflowArtifactError,
  readAuthoringArtifact,
  readSurveyArtifact,
  writeAuthoringArtifact,
  writeSurveyArtifact,
  type AuthoringArtifact,
  type SurveyArtifact,
} from "@/workflow/artifacts";
import { createRun, runDir } from "@/workflow/paths";

let root: string;
let runId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-artifacts-"));
  runId = createRun("example/repo", root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const surveyed: SurveyArtifact = {
  status: "surveyed",
  repository: "example/repo",
  revision: "a".repeat(40),
  collected: [{ path: "AGENTS.md", ruleId: "agent-instructions", truncated: false }],
  skipped: [{ path: "big.md", ruleId: "docs", reason: "budget-exhausted" }],
  candidates: [
    {
      id: "spec-gate",
      name: "Spec change gate",
      intent: "Block merges that drift from the declared spec.",
      discipline: "A pre-commit hook rejects edits without a matching spec change.",
      tradeoffs: "Slower first commit on new features.",
      evidence: ["AGENTS.md"],
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
  discardedEvidence: [
    { candidateId: "ghost", path: "missing.md", reason: "not-collected" },
  ],
  discardedCandidates: [
    { candidateId: "ghost", reason: "no-evidence", detail: "no evidence left" },
  ],
};

const repositoryUnresolved: SurveyArtifact = {
  status: "repository-unresolved",
  detail: "Could not resolve repository example/repo.",
};

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

const provenanceUnresolvable: AuthoringArtifact = {
  status: "provenance-unresolvable",
  candidateId: "spec-gate",
  detail: "Could not read evidence at the pinned revision.",
};

describe("survey artifact", () => {
  it("round-trips the succeeded shape", () => {
    writeSurveyArtifact(runId, surveyed, root);
    expect(readSurveyArtifact(runId, root)).toEqual(surveyed);
  });

  it("round-trips the no-candidate failure shape", () => {
    writeSurveyArtifact(runId, noCandidate, root);
    expect(readSurveyArtifact(runId, root)).toEqual(noCandidate);
  });

  it("round-trips the repository-unresolved failure shape", () => {
    writeSurveyArtifact(runId, repositoryUnresolved, root);
    expect(readSurveyArtifact(runId, root)).toEqual(repositoryUnresolved);
  });

  it("returns undefined when survey.json does not exist", () => {
    expect(readSurveyArtifact(runId, root)).toBeUndefined();
  });

  it("writes pretty-printed JSON with a trailing newline and no leftover temp file", () => {
    writeSurveyArtifact(runId, surveyed, root);
    const path = join(runDir(runId, root), "survey.json");
    const raw = readFileSync(path, "utf8");

    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  ");
    expect(
      readdirSync(runDir(runId, root)).filter((entry) => entry.includes(".tmp")),
    ).toEqual([]);
  });

  it("throws WorkflowArtifactError on malformed JSON instead of returning undefined", () => {
    writeFileSync(join(runDir(runId, root), "survey.json"), "{ not json", "utf8");
    expect(() => readSurveyArtifact(runId, root)).toThrow(WorkflowArtifactError);
  });

  it("throws WorkflowArtifactError on an unrecognized status", () => {
    writeFileSync(
      join(runDir(runId, root), "survey.json"),
      JSON.stringify({ status: "not-a-real-status", detail: "x" }),
      "utf8",
    );
    expect(() => readSurveyArtifact(runId, root)).toThrow(WorkflowArtifactError);
  });

  it("throws WorkflowArtifactError when a succeeded artifact is missing required fields", () => {
    writeFileSync(
      join(runDir(runId, root), "survey.json"),
      JSON.stringify({ status: "surveyed", repository: "example/repo" }),
      "utf8",
    );
    expect(() => readSurveyArtifact(runId, root)).toThrow(WorkflowArtifactError);
  });
});

describe("authoring artifact", () => {
  it("round-trips the drafted shape", () => {
    writeAuthoringArtifact(runId, drafted, root);
    expect(readAuthoringArtifact(runId, root)).toEqual(drafted);
  });

  it("round-trips a failure shape", () => {
    writeAuthoringArtifact(runId, provenanceUnresolvable, root);
    expect(readAuthoringArtifact(runId, root)).toEqual(provenanceUnresolvable);
  });

  it("returns undefined when authoring.json does not exist", () => {
    expect(readAuthoringArtifact(runId, root)).toBeUndefined();
  });

  it("throws WorkflowArtifactError when drafted is missing its pattern", () => {
    writeFileSync(
      join(runDir(runId, root), "authoring.json"),
      JSON.stringify({ status: "drafted", candidateId: "spec-gate" }),
      "utf8",
    );
    expect(() => readAuthoringArtifact(runId, root)).toThrow(WorkflowArtifactError);
  });

  it("throws WorkflowArtifactError on malformed JSON", () => {
    writeFileSync(join(runDir(runId, root), "authoring.json"), "not json at all", "utf8");
    expect(() => readAuthoringArtifact(runId, root)).toThrow(WorkflowArtifactError);
  });
});

describe("writes are atomic", () => {
  it("does not leave a partial file if a second write races the first (last writer wins)", () => {
    writeSurveyArtifact(runId, surveyed, root);
    writeSurveyArtifact(runId, noCandidate, root);

    expect(existsSync(join(runDir(runId, root), "survey.json"))).toBe(true);
    expect(readSurveyArtifact(runId, root)).toEqual(noCandidate);
  });
});
