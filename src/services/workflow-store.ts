import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { loadCatalog, type CatalogLoadResult } from "@/lib/catalog/load";
import {
  applyGenerated,
  hashTargetBase,
  type ApplyResult,
} from "@/lib/engine/apply";
import {
  detectBindings,
  mergeUserProvidedBindings,
  type BindingDetection,
} from "@/lib/engine/detect";
import {
  instantiate,
  type GeneratedFile,
  type InstantiateResult,
} from "@/lib/engine/instantiate";
import {
  executeVerification,
  prepareVerification,
  type PreparedVerification,
  type VerifyOutcome,
} from "@/lib/engine/verify";
import {
  approveVerification,
  createApproval,
} from "@/services/approval-store";
import { DEFAULT_GATE_TIMEOUT_MS } from "@/services/gate-runner";
import type { Pattern } from "@/types/pattern";

type Generated = Extract<InstantiateResult, { ok: true }>;

type Workflow = {
  workflowId: string;
  sessionId: string;
  pattern: Pattern;
  targetRepoRoot: string;
  detections: BindingDetection[];
  bindings: BindingDetection[];
  generated?: Generated;
  prepared?: PreparedVerification;
  outcome?: VerifyOutcome;
  verificationId?: string;
};

type WorkflowErrorStatus =
  | "workflow-not-found"
  | "pattern-not-found"
  | "generation-blocked"
  | "generation-failed"
  | "injection-failed"
  | "target-ineligible"
  | "not-prepared"
  | "not-verified"
  | "not-approved";

export type WorkflowError = {
  status: WorkflowErrorStatus;
  detail: string;
};

export type WorkflowCreated = {
  status: "bindings-ready";
  workflowId: string;
  detections: BindingDetection[];
  bindings: BindingDetection[];
};

export type WorkflowPrepared = {
  status: "prepared";
  frozenArgv: string[];
  cwd: "temporary workspace outside the target repository";
  timeoutMs: number;
  files: Array<GeneratedFile & { operation: "add" }>;
};

const workflows = new Map<string, Workflow>();

function workflowFor(
  sessionId: string,
  workflowId: string,
): Workflow | undefined {
  const workflow = workflows.get(workflowId);
  return workflow?.sessionId === sessionId ? workflow : undefined;
}

function clearDownstream(workflow: Workflow): void {
  workflow.generated = undefined;
  workflow.prepared = undefined;
  workflow.outcome = undefined;
  workflow.verificationId = undefined;
}

function targetEligibility(targetRepoRoot: string): string | undefined {
  if (!isAbsolute(targetRepoRoot)) {
    return "target path must be absolute";
  }
  try {
    accessSync(targetRepoRoot, constants.R_OK);
    JSON.parse(readFileSync(resolve(targetRepoRoot, "package.json"), "utf8"));
  } catch {
    return "target must contain a readable package.json";
  }
  try {
    const worktree = execFileSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: targetRepoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (worktree !== "true") {
      return "target must be a Git worktree";
    }
  } catch {
    return "target must be a Git worktree";
  }
  return undefined;
}

export function createSession(): string {
  return randomUUID();
}

export function getCatalog(): CatalogLoadResult {
  return loadCatalog(
    process.env.UPTAKE_CATALOG_DIR ?? resolve("catalog"),
    process.env.UPTAKE_SOURCE_ROOT ?? resolve(".uptake/sources"),
  );
}

export function createWorkflow(
  sessionId: string,
  patternId: string,
  targetRepoRoot: string,
): WorkflowCreated | WorkflowError {
  const catalog = getCatalog();
  const loaded = catalog.loaded.find(
    ({ pattern }) => pattern.patternId === patternId,
  );
  if (loaded === undefined) {
    const rejection = catalog.rejected.find(
      ({ file }) => file === `${patternId}.json`,
    );
    return {
      status: "pattern-not-found",
      detail: rejection?.reason ?? "pattern is not available",
    };
  }
  if (!loaded.generationEnabled) {
    return {
      status: "generation-blocked",
      detail: "generation requires a generative, corroborated pattern",
    };
  }
  const targetError = targetEligibility(targetRepoRoot);
  if (targetError !== undefined) {
    return { status: "target-ineligible", detail: targetError };
  }
  const detections = detectBindings(loaded.pattern, targetRepoRoot);
  const checker = detections.find(({ kind }) => kind === "checker");
  if (
    checker === undefined ||
    checker.status !== "detected" ||
    checker.value !== "vitest"
  ) {
    return {
      status: "target-ineligible",
      detail: "target package.json must declare a vitest checker",
    };
  }

  const workflowId = randomUUID();
  workflows.set(workflowId, {
    workflowId,
    sessionId,
    pattern: loaded.pattern,
    targetRepoRoot,
    detections,
    bindings: detections,
  });
  return {
    status: "bindings-ready",
    workflowId,
    detections,
    bindings: detections,
  };
}

export function mergeWorkflowBindings(
  sessionId: string,
  workflowId: string,
  values: Readonly<Record<string, string>>,
): WorkflowCreated | WorkflowError {
  const workflow = workflowFor(sessionId, workflowId);
  if (workflow === undefined) {
    return { status: "workflow-not-found", detail: "workflow was not found" };
  }
  workflow.bindings = mergeUserProvidedBindings(workflow.detections, values);
  clearDownstream(workflow);
  return {
    status: "bindings-ready",
    workflowId,
    detections: workflow.detections,
    bindings: workflow.bindings,
  };
}

export function prepareWorkflow(
  sessionId: string,
  workflowId: string,
): WorkflowPrepared | WorkflowError {
  const workflow = workflowFor(sessionId, workflowId);
  if (workflow === undefined) {
    return { status: "workflow-not-found", detail: "workflow was not found" };
  }
  clearDownstream(workflow);
  const generated = instantiate(workflow.pattern, workflow.bindings);
  if (!generated.ok) {
    return { status: generated.reason, detail: generated.detail };
  }
  const prepared = prepareVerification(
    workflow.pattern,
    generated,
    workflow.bindings,
    workflow.targetRepoRoot,
  );
  if (prepared.status !== "prepared") {
    return { status: "not-prepared", detail: prepared.detail };
  }
  workflow.generated = generated;
  workflow.prepared = prepared;
  return {
    status: "prepared",
    frozenArgv: [...prepared.frozenArgv],
    cwd: "temporary workspace outside the target repository",
    timeoutMs: DEFAULT_GATE_TIMEOUT_MS,
    files: generated.files.map((file) => ({ ...file, operation: "add" })),
  };
}

export async function executeWorkflow(
  sessionId: string,
  workflowId: string,
): Promise<VerifyOutcome | WorkflowError> {
  const workflow = workflowFor(sessionId, workflowId);
  if (workflow === undefined) {
    return { status: "workflow-not-found", detail: "workflow was not found" };
  }
  if (workflow.prepared === undefined || workflow.generated === undefined) {
    return { status: "not-prepared", detail: "workflow is not prepared" };
  }
  const outcome = await executeVerification(workflow.prepared);
  workflow.outcome = outcome;
  workflow.verificationId = undefined;
  if (outcome.status === "awaiting-approval") {
    workflow.verificationId = createApproval({
      patternId: workflow.pattern.patternId,
      targetRepoRoot: workflow.targetRepoRoot,
      contentHash: outcome.contentHash,
      targetBaseHash: hashTargetBase(workflow.targetRepoRoot),
      frozenArgv: outcome.frozenArgv,
    });
  }
  return outcome;
}

export function approveWorkflow(
  sessionId: string,
  workflowId: string,
): { status: "approved" } | WorkflowError {
  const workflow = workflowFor(sessionId, workflowId);
  if (workflow === undefined) {
    return { status: "workflow-not-found", detail: "workflow was not found" };
  }
  if (workflow.verificationId === undefined) {
    return { status: "not-verified", detail: "workflow is not verified" };
  }
  const approved = approveVerification(workflow.verificationId);
  return approved.ok
    ? { status: "approved" }
    : { status: "not-verified", detail: approved.reason };
}

export function applyWorkflow(
  sessionId: string,
  workflowId: string,
): ApplyResult | WorkflowError {
  const workflow = workflowFor(sessionId, workflowId);
  if (workflow === undefined) {
    return { status: "workflow-not-found", detail: "workflow was not found" };
  }
  if (
    workflow.verificationId === undefined ||
    workflow.generated === undefined
  ) {
    return { status: "not-approved", detail: "workflow is not approved" };
  }
  const result = applyGenerated(
    workflow.verificationId,
    workflow.generated.files,
    workflow.targetRepoRoot,
  );
  if (result.status === "completed") {
    workflow.verificationId = undefined;
  }
  return result;
}

export function __resetWorkflowStoreForTests(): void {
  workflows.clear();
}
