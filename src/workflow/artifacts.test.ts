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

import type { BindingDetection } from "@/lib/engine/detect";
import type { GeneratedFile } from "@/lib/engine/instantiate";
import type { InstantiatedInjection, Pattern } from "@/types/pattern";
import {
  WorkflowArtifactError,
  readApplyArtifact,
  readAuthoringArtifact,
  readBindingsArtifact,
  readGeneratedArtifact,
  readSurveyArtifact,
  readVerifyArtifact,
  runLogPath,
  writeApplyArtifact,
  writeAuthoringArtifact,
  writeBindingsArtifact,
  writeGeneratedArtifact,
  writeRunLog,
  writeSurveyArtifact,
  writeVerifyArtifact,
  type ApplyArtifact,
  type AuthoringArtifact,
  type BindingsArtifact,
  type GeneratedArtifact,
  type SurveyArtifact,
  type VerifyArtifact,
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

const bindings: BindingDetection[] = [
  {
    bindingId: "checker",
    kind: "checker",
    status: "detected",
    value: "vitest",
    evidence: [{ path: "package.json" }],
  },
  {
    bindingId: "spec-format",
    kind: "spec-format",
    status: "binding-unresolved",
  },
];

const bindingsArtifact: BindingsArtifact = {
  patternId: "spec-gate",
  targetRepoRoot: "/tmp/target",
  bindings,
};

const generatedFiles: GeneratedFile[] = [
  {
    path: "uptake-gate/declared-changes.ts",
    role: "spec-artifact",
    content: "export const declaredChanges: string[] = [];\n",
  },
  {
    path: "uptake-gate/spec-gate.test.ts",
    role: "spec-check",
    content: "test(\"gate\", () => {});\n",
  },
];

const injection: InstantiatedInjection = {
  operation: "replace",
  path: "uptake-gate/declared-changes.ts",
  marker: "MARKER",
  replacement: "'violation'",
};

const generatedArtifact: GeneratedArtifact = {
  patternId: "spec-gate",
  files: generatedFiles,
  injection,
  gateTestId: "gate-test",
};

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

const patternInvalid: VerifyArtifact = {
  status: "pattern-invalid",
  detail: "pattern failed the layer 1 hard gate",
  targetRepoRoot: "/tmp/target",
};

const gateError: VerifyArtifact = {
  status: "gate-error",
  detail: "spawn error: ENOENT",
  targetRepoRoot: "/tmp/target",
  patternId: "spec-gate",
  frozenArgv: ["node", "vitest", "run"],
};

const applied: ApplyArtifact = {
  status: "applied",
  verificationId: "verif-1",
  targetRepoRoot: "/tmp/target",
  written: generatedFiles.map(({ path }) => path),
};

const baseChanged: ApplyArtifact = {
  status: "base-changed",
  verificationId: "verif-1",
  targetRepoRoot: "/tmp/target",
  detail: "target repository changed after approval",
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

describe("bindings artifact", () => {
  it("round-trips", () => {
    writeBindingsArtifact(runId, bindingsArtifact, root);
    expect(readBindingsArtifact(runId, root)).toEqual(bindingsArtifact);
  });

  it("returns undefined when bindings.json does not exist", () => {
    expect(readBindingsArtifact(runId, root)).toBeUndefined();
  });

  it("throws WorkflowArtifactError when bindings is missing", () => {
    writeFileSync(
      join(runDir(runId, root), "bindings.json"),
      JSON.stringify({ patternId: "spec-gate", targetRepoRoot: "/tmp/target" }),
      "utf8",
    );
    expect(() => readBindingsArtifact(runId, root)).toThrow(
      WorkflowArtifactError,
    );
  });
});

describe("generated artifact", () => {
  it("round-trips", () => {
    writeGeneratedArtifact(runId, generatedArtifact, root);
    expect(readGeneratedArtifact(runId, root)).toEqual(generatedArtifact);
  });

  it("returns undefined when generated.json does not exist", () => {
    expect(readGeneratedArtifact(runId, root)).toBeUndefined();
  });

  it("throws WorkflowArtifactError when injection is missing", () => {
    writeFileSync(
      join(runDir(runId, root), "generated.json"),
      JSON.stringify({
        patternId: "spec-gate",
        files: [],
        gateTestId: "gate-test",
      }),
      "utf8",
    );
    expect(() => readGeneratedArtifact(runId, root)).toThrow(
      WorkflowArtifactError,
    );
  });
});

describe("verify artifact", () => {
  it("round-trips the verified shape", () => {
    writeVerifyArtifact(runId, verified, root);
    expect(readVerifyArtifact(runId, root)).toEqual(verified);
  });

  it("round-trips a failure shape carrying only the required targetRepoRoot", () => {
    writeVerifyArtifact(runId, patternInvalid, root);
    expect(readVerifyArtifact(runId, root)).toEqual(patternInvalid);
  });

  it("round-trips a failure shape with optional patternId and frozenArgv", () => {
    writeVerifyArtifact(runId, gateError, root);
    expect(readVerifyArtifact(runId, root)).toEqual(gateError);
  });

  it("returns undefined when verify.json does not exist", () => {
    expect(readVerifyArtifact(runId, root)).toBeUndefined();
  });

  it("throws WorkflowArtifactError when a failure is missing targetRepoRoot", () => {
    writeFileSync(
      join(runDir(runId, root), "verify.json"),
      JSON.stringify({ status: "gate-error", detail: "boom" }),
      "utf8",
    );
    expect(() => readVerifyArtifact(runId, root)).toThrow(
      WorkflowArtifactError,
    );
  });

  it("throws WorkflowArtifactError on an unrecognized status", () => {
    writeFileSync(
      join(runDir(runId, root), "verify.json"),
      JSON.stringify({
        status: "not-a-real-status",
        detail: "x",
        targetRepoRoot: "/tmp/target",
      }),
      "utf8",
    );
    expect(() => readVerifyArtifact(runId, root)).toThrow(
      WorkflowArtifactError,
    );
  });
});

describe("apply artifact", () => {
  it("round-trips the applied shape", () => {
    writeApplyArtifact(runId, applied, root);
    expect(readApplyArtifact(runId, root)).toEqual(applied);
  });

  it("round-trips a failure shape", () => {
    writeApplyArtifact(runId, baseChanged, root);
    expect(readApplyArtifact(runId, root)).toEqual(baseChanged);
  });

  it("returns undefined when apply.json does not exist", () => {
    expect(readApplyArtifact(runId, root)).toBeUndefined();
  });

  it("throws WorkflowArtifactError when applied is missing written", () => {
    writeFileSync(
      join(runDir(runId, root), "apply.json"),
      JSON.stringify({
        status: "applied",
        verificationId: "verif-1",
        targetRepoRoot: "/tmp/target",
      }),
      "utf8",
    );
    expect(() => readApplyArtifact(runId, root)).toThrow(
      WorkflowArtifactError,
    );
  });
});

describe("run logs", () => {
  it("copies the source log to runs/<id>/logs/<name>.log without removing the source", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "uptake-gate-log-src-"));
    const sourcePath = join(sourceDir, "gate.log");
    writeFileSync(sourcePath, "gate output\n", "utf8");

    writeRunLog(runId, "positive", sourcePath, root);

    const destination = runLogPath(runId, "positive", root);
    expect(destination).toBe(
      join(runDir(runId, root), "logs", "positive.log"),
    );
    expect(readFileSync(destination, "utf8")).toBe("gate output\n");
    expect(existsSync(sourcePath)).toBe(true);

    rmSync(sourceDir, { recursive: true, force: true });
  });

  it("does not throw when the source log is unreadable, and leaves a discoverable placeholder", () => {
    const missingSource = join(tmpdir(), `uptake-missing-${Date.now()}.log`);

    expect(() =>
      writeRunLog(runId, "negative", missingSource, root),
    ).not.toThrow();

    const destination = runLogPath(runId, "negative", root);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(destination, "utf8")).toContain(missingSource);
  });
});
