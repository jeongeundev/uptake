import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashTargetBase } from "@/lib/engine/apply";
import type { BindingDetection } from "@/lib/engine/detect";
import type { GeneratedFile } from "@/lib/engine/instantiate";
import { hashBindings, hashGenerated } from "@/lib/engine/verify";
import type { InstantiatedInjection } from "@/types/pattern";
import type { VerifyArtifact } from "@/workflow/artifacts";
import {
  readApplyArtifact,
  writeBindingsArtifact,
  writeGeneratedArtifact,
  writeVerifyArtifact,
} from "@/workflow/artifacts";
import { createRun, runDir, writeCurrentRun } from "@/workflow/paths";
import { runApplyCommand, type ApprovalPrompt } from "@/workflow/steps/apply";

let root: string;
let target: string;

const patternId = "apply-fixture-gate";
const gateTestId = "gate-test";

const files: GeneratedFile[] = [
  {
    path: "uptake-gate/spec-gate.test.ts",
    role: "spec-check",
    content:
      'import { test, expect } from "vitest";\ntest("gate", () => { expect(true).toBe(true); });\n',
  },
];

const injection: InstantiatedInjection = {
  operation: "replace",
  path: "uptake-gate/spec-gate.test.ts",
  marker: "MARKER",
  replacement: "REPLACED",
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
    bindingId: "gate-location",
    kind: "gate-location",
    status: "detected",
    value: "uptake-gate/spec-gate.test.ts",
    evidence: [{ path: "package.json" }],
  },
];

type VerifiedArtifact = Extract<VerifyArtifact, { status: "verified" }>;

function writeVerificationArtifacts(
  runId: string,
  overrides: Partial<VerifiedArtifact> = {},
): void {
  const verified: VerifiedArtifact = {
    status: "verified",
    verificationId: "verification-1",
    patternId,
    targetRepoRoot: target,
    contentHash: hashGenerated(files),
    bindingsHash: hashBindings(bindings),
    targetBaseHash: hashTargetBase(target),
    frozenArgv: [process.execPath, "vitest", "run"],
    gateTestId,
    positivePreview: "",
    positiveTruncated: false,
    negativePreview: "",
    negativeTruncated: false,
    tradeoffs: "Costs a review gate on every change.",
    provenance: [
      {
        repository: "github.com/example/seed",
        revision: "0123456789012345678901234567890123456789",
        path: "changes/12359.feature.md",
      },
    ],
    ...overrides,
  };
  writeVerifyArtifact(runId, verified, root);
  writeGeneratedArtifact(
    runId,
    { patternId, files, injection, gateTestId },
    root,
  );
  writeBindingsArtifact(
    runId,
    { patternId, targetRepoRoot: target, bindings },
    root,
  );
}

function setUpRun(): string {
  const runId = createRun("example/target", root);
  writeCurrentRun(runId, root);
  return runId;
}

const approve = async () => true;
const reject = async () => false;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-apply-"));
  target = mkdtempSync(join(tmpdir(), "uptake-apply-target-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("runApplyCommand — prerequisites", () => {
  it("exits 2 and points at survey when no run has been recorded", async () => {
    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("uptake survey");
  });

  it("exits 2 and points at verify when verify.json is missing, without writing apply.json", async () => {
    const runId = setUpRun();

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("uptake verify");
    expect(readApplyArtifact(runId, root)).toBeUndefined();
  });

  it("exits 2 and surfaces the failure reason when verify did not succeed, without writing apply.json", async () => {
    const runId = setUpRun();
    writeVerifyArtifact(
      runId,
      { status: "gate-error", detail: "gate crashed", targetRepoRoot: target },
      root,
    );

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("gate-error");
    expect(result.message).toContain("uptake verify");
    expect(readApplyArtifact(runId, root)).toBeUndefined();
  });

  it("exits 2 when verify succeeded but generated.json/bindings.json are missing", async () => {
    const runId = setUpRun();
    writeVerifyArtifact(
      runId,
      {
        status: "verified",
        verificationId: "verification-1",
        patternId,
        targetRepoRoot: target,
        contentHash: hashGenerated(files),
        bindingsHash: hashBindings(bindings),
        targetBaseHash: hashTargetBase(target),
        frozenArgv: [process.execPath, "vitest", "run"],
        gateTestId,
        positivePreview: "",
        positiveTruncated: false,
        negativePreview: "",
        negativeTruncated: false,
        tradeoffs: "Costs a review gate on every change.",
        provenance: [],
      },
      root,
    );

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(2);
    expect(readApplyArtifact(runId, root)).toBeUndefined();
  });
});

describe("runApplyCommand — approval", () => {
  it("writes nothing and leaves the target unchanged when confirm rejects", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId);

    const result = await runApplyCommand({ confirm: reject, root });

    expect(result.exitCode).toBe(2);
    expect(readApplyArtifact(runId, root)).toBeUndefined();
    expect(existsSync(join(target, "uptake-gate/spec-gate.test.ts"))).toBe(
      false,
    );
  });

  it("applies the generated files when confirm approves", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId);

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(0);
    const artifact = readApplyArtifact(runId, root);
    expect(artifact).toMatchObject({
      status: "applied",
      verificationId: "verification-1",
      targetRepoRoot: target,
    });
    const written = readFileSync(
      join(target, "uptake-gate/spec-gate.test.ts"),
      "utf8",
    );
    expect(written).toBe(files[0].content);
  });

  // ADR-006/009: 승인은 사용자가 자기 저장소에 코드를 쓰겠다고 확정하는
  // 지점이다. 웹 표면은 같은 지점에서 tradeoffs와 provenance를 보여준다 —
  // 정본인 CLI가 더 얇으면 안 된다(ADR-020).
  it("hands the prompt the tradeoffs and provenance verify recorded", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId);
    const confirmSpy = vi.fn<ApprovalPrompt>(async () => false);

    await runApplyCommand({ confirm: confirmSpy, root });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatchObject({
      tradeoffs: "Costs a review gate on every change.",
      provenance: [
        {
          repository: "github.com/example/seed",
          revision: "0123456789012345678901234567890123456789",
          path: "changes/12359.feature.md",
        },
      ],
    });
  });
});

describe("runApplyCommand — reapply blocking (ADR-022)", () => {
  it("blocks reapplying the same verification without prompting again", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId);
    const first = await runApplyCommand({ confirm: approve, root });
    expect(first.exitCode).toBe(0);

    const confirmSpy = vi.fn(async () => true);
    const second = await runApplyCommand({ confirm: confirmSpy, root });

    expect(second.exitCode).toBe(2);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(readApplyArtifact(runId, root)).toMatchObject({
      status: "applied",
    });
  });

  it("returns base-changed if apply.json is removed and the target already changed", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId);
    const first = await runApplyCommand({ confirm: approve, root });
    expect(first.exitCode).toBe(0);

    unlinkSync(join(runDir(runId, root), "apply.json"));

    const second = await runApplyCommand({ confirm: approve, root });

    expect(second.exitCode).toBe(1);
    expect(readApplyArtifact(runId, root)).toMatchObject({
      status: "base-changed",
    });
  });
});

describe("runApplyCommand — hash triple-check", () => {
  it("returns diff-mismatch when contentHash no longer matches the generated files", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId, { contentHash: "0".repeat(64) });

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(1);
    expect(readApplyArtifact(runId, root)).toMatchObject({
      status: "diff-mismatch",
    });
  });

  it("returns bindings-mismatch when bindingsHash no longer matches the bindings", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId, { bindingsHash: "0".repeat(64) });

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(1);
    expect(readApplyArtifact(runId, root)).toMatchObject({
      status: "bindings-mismatch",
    });
  });

  it("returns base-changed when targetBaseHash no longer matches the target tree", async () => {
    const runId = setUpRun();
    writeVerificationArtifacts(runId, { targetBaseHash: "0".repeat(64) });

    const result = await runApplyCommand({ confirm: approve, root });

    expect(result.exitCode).toBe(1);
    expect(readApplyArtifact(runId, root)).toMatchObject({
      status: "base-changed",
    });
  });
});
