import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthoringArtifact } from "@/workflow/artifacts";
import {
  readBindingsArtifact,
  readGeneratedArtifact,
  readVerifyArtifact,
  runLogPath,
  writeAuthoringArtifact,
} from "@/workflow/artifacts";
import { createRun, writeCurrentRun } from "@/workflow/paths";
import { runVerifyCommand } from "@/workflow/steps/verify";
import type { Pattern } from "@/types/pattern";

let root: string;
let sources: string;
let previousSourceRoot: string | undefined;

const eligibleTarget = resolve("tests/fixtures/target-vitest");

const sourceFiles = [
  { path: "changes/12359.feature.md", role: "spec-artifact" },
  { path: ".github/workflows/timeline-check.yml", role: "spec-check" },
  { path: "gates/blocking-gate.py", role: "blocking-gate" },
] as const;

function commitRepository(path: string): string {
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
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).trim();
}

function createEvidenceRepository(name: string): string {
  const path = join(sources, name);
  for (const file of sourceFiles) {
    const filePath = join(path, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `# ${file.role} fixture\n`);
  }
  return commitRepository(path);
}

function createSingleFileRepository(name: string, file: string): string {
  const path = join(sources, name);
  mkdirSync(join(path, dirname(file)), { recursive: true });
  writeFileSync(join(path, file), "fixture content\n");
  return commitRepository(path);
}

function buildGenerativePattern(): Pattern {
  const revisionOne = createEvidenceRepository("example/one");
  const revisionTwo = createEvidenceRepository("example/two");
  return {
    schemaVersion: 1,
    patternId: "verify-fixture-gate",
    name: "Verify fixture gate",
    capability: "generative",
    evidenceStatus: "corroborated",
    intent: "Block merges that lack a declared change.",
    roles: [
      { id: "spec-artifact", description: "Declares the change." },
      { id: "spec-check", description: "Checks the declaration." },
      { id: "blocking-gate", description: "Blocks on failure." },
    ],
    bindingPoints: [
      { id: "spec-format", description: "Declaration format.", kind: "spec-format" },
      { id: "checker", description: "Verification runner.", kind: "checker" },
      { id: "gate-location", description: "Blocking gate location.", kind: "gate-location" },
      { id: "naming", description: "Declaration naming convention.", kind: "naming" },
    ],
    sources: [
      {
        id: "example-one",
        repository: "example/one",
        revision: revisionOne,
        stack: "python",
        isTargetStack: false,
        independenceGroup: "example-one",
        independenceNote: "Independent fixture repository one.",
      },
      {
        id: "example-two",
        repository: "example/two",
        revision: revisionTwo,
        stack: "python",
        isTargetStack: false,
        independenceGroup: "example-two",
        independenceNote: "Independent fixture repository two.",
      },
    ],
    provenance: sourceFiles.flatMap((file) => [
      { sourceId: "example-one", path: file.path, observedRole: file.role },
      { sourceId: "example-two", path: file.path, observedRole: file.role },
    ]),
    oracle: {
      violation:
        "The declaration list is empty even though the gate still passes.",
      gateTestId: "declared-change-present",
      injection: {
        operation: "replace",
        targetRole: "spec-artifact",
        marker: '/* @uptake:marker:begin */ "seed-change" /* @uptake:marker:end */',
        replacement: "",
      },
      expect: "red",
    },
    tradeoffs: "Observed in fixture repositories only.",
  };
}

function buildDescriptivePattern(): Pattern {
  const revision = createSingleFileRepository(
    "example/descriptive",
    "AGENTS.md",
  );
  return {
    schemaVersion: 1,
    patternId: "verify-fixture-descriptive",
    name: "Verify fixture descriptive",
    capability: "descriptive",
    evidenceStatus: "observed",
    intent: "Describe an observed practice.",
    roles: [{ id: "observed-practice", description: "An observed practice." }],
    bindingPoints: [
      { id: "checker", description: "Verification runner.", kind: "checker" },
      {
        id: "gate-location",
        description: "Blocking gate location.",
        kind: "gate-location",
      },
    ],
    sources: [
      {
        id: "example-descriptive",
        repository: "example/descriptive",
        revision,
        stack: "unspecified",
        isTargetStack: false,
        independenceGroup: "example-descriptive",
        independenceNote: "Single observed repository.",
      },
    ],
    provenance: [
      {
        sourceId: "example-descriptive",
        path: "AGENTS.md",
        observedRole: "observed-practice",
      },
    ],
    tradeoffs: "Observed once; not corroborated.",
  };
}

function draftedArtifact(pattern: Pattern): AuthoringArtifact {
  return {
    status: "drafted",
    candidateId: pattern.patternId,
    pattern,
    discarded: [],
    targetStackFacts: [],
  };
}

function setUpRun(pattern?: Pattern): string {
  const runId = createRun("example/target", root);
  writeCurrentRun(runId, root);
  if (pattern !== undefined) {
    writeAuthoringArtifact(runId, draftedArtifact(pattern), root);
  }
  return runId;
}

// `tests/fixtures/target-vitest` pins vitest.config.ts's `include` to
// `src/**/*.test.ts` for binding-detection assertions; the generated gate
// lands at `uptake-gate/spec-gate.test.ts`, which that pattern excludes.
// A real (unmocked) gate run needs a target without that restriction, so this
// mirrors what `e2e/fixtures.config.ts` builds: a package.json declaring
// vitest with no vitest.config.ts at all (default discovery covers the gate).
function createExecutableTarget(): string {
  const path = mkdtempSync(join(tmpdir(), "uptake-verify-target-"));
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({
      name: "uptake-verify-fixture-target",
      private: true,
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
  commitRepository(path);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-verify-"));
  sources = join(root, "sources");
  mkdirSync(sources, { recursive: true });
  previousSourceRoot = process.env.UPTAKE_SOURCE_ROOT;
  process.env.UPTAKE_SOURCE_ROOT = sources;
});

afterEach(() => {
  if (previousSourceRoot === undefined) {
    delete process.env.UPTAKE_SOURCE_ROOT;
  } else {
    process.env.UPTAKE_SOURCE_ROOT = previousSourceRoot;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("runVerifyCommand — prerequisites", () => {
  it("exits 2 and points at survey when no run has been recorded", async () => {
    const result = await runVerifyCommand(eligibleTarget, root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("uptake survey");
  });

  it("exits 2 and points at author when authoring.json is missing, without writing verify.json", async () => {
    const runId = setUpRun();

    const result = await runVerifyCommand(eligibleTarget, root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("uptake author");
    expect(readVerifyArtifact(runId, root)).toBeUndefined();
  });

  it("exits 2 and surfaces the failure reason when authoring did not succeed, without writing verify.json", async () => {
    const runId = createRun("example/target", root);
    writeCurrentRun(runId, root);
    writeAuthoringArtifact(
      runId,
      {
        status: "extract-failed",
        candidateId: "verify-fixture-gate",
        detail: "No evidence resolved at the pinned revision.",
      },
      root,
    );

    const result = await runVerifyCommand(eligibleTarget, root);

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("extract-failed");
    expect(result.message).toContain("uptake author");
    expect(readVerifyArtifact(runId, root)).toBeUndefined();
  });
});

describe("runVerifyCommand — layer 1 re-validation (ADR-025)", () => {
  it("re-validates provenance at consumption time and rejects evidence that no longer resolves", async () => {
    const pattern = buildGenerativePattern();
    pattern.provenance[0] = {
      ...pattern.provenance[0],
      path: "missing/nonexistent.md",
    };
    const runId = setUpRun(pattern);

    const result = await runVerifyCommand(eligibleTarget, root);

    expect(result.exitCode).toBe(1);
    const artifact = readVerifyArtifact(runId, root);
    // Asserting the exact reason (not just the top-level "pattern-invalid"
    // status) is what catches a missing filename synthesis: passing
    // "authoring.json" verbatim to validatePatternValue trips the filename
    // check and yields "schema-invalid" instead, without ever reaching
    // provenance re-validation.
    expect(artifact).toMatchObject({
      status: "pattern-invalid",
      detail: "provenance-unresolved",
    });
  });
});

describe("runVerifyCommand — target eligibility", () => {
  it("exits 2 and records target-ineligible when the target has no package.json", async () => {
    const pattern = buildDescriptivePattern();
    const runId = setUpRun(pattern);
    const ineligibleTarget = mkdtempSync(join(tmpdir(), "uptake-ineligible-"));

    const result = await runVerifyCommand(ineligibleTarget, root);

    expect(result.exitCode).toBe(2);
    const artifact = readVerifyArtifact(runId, root);
    expect(artifact).toMatchObject({ status: "target-ineligible" });

    rmSync(ineligibleTarget, { recursive: true, force: true });
  });
});

describe("runVerifyCommand — generation gate", () => {
  it("blocks generation for a descriptive pattern but still records resolved bindings", async () => {
    const pattern = buildDescriptivePattern();
    const runId = setUpRun(pattern);

    const result = await runVerifyCommand(eligibleTarget, root);

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("generation-blocked");
    const artifact = readVerifyArtifact(runId, root);
    expect(artifact).toMatchObject({ status: "generation-blocked" });
    const bindings = readBindingsArtifact(runId, root);
    expect(bindings?.bindings).toMatchObject([
      { bindingId: "checker", status: "detected", value: "vitest" },
      { bindingId: "gate-location", status: "detected" },
    ]);
  });
});

describe("runVerifyCommand — success path", () => {
  it("runs a real gate end-to-end and records a verified outcome", async () => {
    const pattern = buildGenerativePattern();
    const runId = setUpRun(pattern);
    const target = createExecutableTarget();

    try {
      const result = await runVerifyCommand(target, root);

      expect(result.exitCode).toBe(0);
      const artifact = readVerifyArtifact(runId, root);
      if (artifact?.status !== "verified") {
        throw new Error(`expected verified, got ${JSON.stringify(artifact)}`);
      }
      expect(artifact.patternId).toBe(pattern.patternId);
      expect(artifact.targetRepoRoot).toBe(target);
      expect(artifact.gateTestId).toBe("declared-change-present");
      expect(artifact.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.bindingsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.targetBaseHash).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.frozenArgv.length).toBeGreaterThan(0);
      expect(artifact.verificationId.length).toBeGreaterThan(0);

      const generated = readGeneratedArtifact(runId, root);
      expect(generated?.files.length).toBe(2);

      expect(existsSync(runLogPath(runId, "positive", root))).toBe(true);
      expect(existsSync(runLogPath(runId, "negative", root))).toBe(true);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }, 30_000);
});
