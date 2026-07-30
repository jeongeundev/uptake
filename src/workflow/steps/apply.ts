import type { BindingDetection } from "@/lib/engine/detect";
import { applyGenerated, type ApprovalInput } from "@/lib/engine/apply";
import {
  WorkflowArtifactError,
  readBindingsArtifact,
  readGeneratedArtifact,
  writeApplyArtifact,
  type BindingsArtifact,
  type GeneratedArtifact,
} from "@/workflow/artifacts";
import { readCurrentRun } from "@/workflow/paths";
import { applyState, verifyState } from "@/workflow/prerequisites";

export type ApprovalSummary = {
  patternId: string;
  targetRepoRoot: string;
  frozenArgv: string[];
  gateTestId: string;
  files: { path: string; role: string; content: string }[];
  bindings: BindingDetection[];
};

export type ApprovalPrompt = (summary: ApprovalSummary) => Promise<boolean>;

export type ApplyCommandResult = { exitCode: 0 | 1 | 2 | 3; message: string };

const RUN_SURVEY_HINT = "Run `uptake survey <repository>` first.";
const RUN_VERIFY_HINT = "Run `uptake verify --target <absolute path>` first.";

type VerificationArtifacts = {
  generated: GeneratedArtifact;
  bindings: BindingsArtifact;
};

// generated.json/bindings.json can be missing (verify never ran to
// completion) or malformed (hand-edited into an invalid shape). Both
// collapse into the same "incomplete verification artifacts" outcome —
// apply never regenerates them, it only reads what verify already produced
// (ARCHITECTURE 'verify → apply 결속').
function readVerificationArtifacts(
  runId: string,
  root: string | undefined,
): VerificationArtifacts | undefined {
  try {
    const generated = readGeneratedArtifact(runId, root);
    const bindings = readBindingsArtifact(runId, root);
    if (generated === undefined || bindings === undefined) {
      return undefined;
    }
    return { generated, bindings };
  } catch (error) {
    if (error instanceof WorkflowArtifactError) {
      return undefined;
    }
    throw error;
  }
}

export async function runApplyCommand(options: {
  confirm: ApprovalPrompt;
  root?: string;
}): Promise<ApplyCommandResult> {
  const { confirm, root } = options;

  const runId = readCurrentRun(root);
  if (runId === undefined) {
    return { exitCode: 2, message: `No survey run found. ${RUN_SURVEY_HINT}` };
  }

  const verify = verifyState(runId, root);
  if (verify.state === "missing") {
    return {
      exitCode: 2,
      message: `verify.json is missing for run ${runId}. ${RUN_VERIFY_HINT}`,
    };
  }
  if (verify.state === "failed") {
    return {
      exitCode: 2,
      message: `The current verification (run ${runId}) did not succeed (${verify.status}): ${verify.detail}\n${RUN_VERIFY_HINT}`,
    };
  }

  const artifacts = readVerificationArtifacts(runId, root);
  if (artifacts === undefined) {
    return {
      exitCode: 2,
      message: `Verification artifacts are incomplete for run ${runId}. ${RUN_VERIFY_HINT}`,
    };
  }
  const { generated, bindings } = artifacts;

  // Consumption seal (ADR-022): this must run before `confirm` is ever
  // called — a verification that was already applied cannot be re-approved
  // into a second write. The existing apply.json is the application record
  // and is left untouched, not overwritten.
  const priorApply = applyState(runId, root);
  if (
    priorApply.state === "succeeded" &&
    priorApply.artifact.verificationId === verify.artifact.verificationId
  ) {
    return {
      exitCode: 2,
      message:
        `Verification ${verify.artifact.verificationId} for run ${runId} was already applied. ` +
        "Run `uptake verify --target <absolute path>` again to apply a fresh outcome.",
    };
  }

  const summary: ApprovalSummary = {
    patternId: verify.artifact.patternId,
    targetRepoRoot: verify.artifact.targetRepoRoot,
    frozenArgv: verify.artifact.frozenArgv,
    gateTestId: verify.artifact.gateTestId,
    files: generated.files,
    bindings: bindings.bindings,
  };

  const approved = await confirm(summary);
  if (!approved) {
    // Declining is a person's choice, not a gate failure — apply.json is
    // not written, so the same verification can still be approved on a
    // later call (the consumption seal above only trips on an actual apply).
    return {
      exitCode: 2,
      message: "Apply was not approved; nothing was written.",
    };
  }

  // The approval input is fixed to what verify.json recorded, not
  // recomputed here — recomputing now would make the triple hash check
  // inside applyGenerated always pass, defeating all three defenses.
  const approval: ApprovalInput = {
    patternId: verify.artifact.patternId,
    targetRepoRoot: verify.artifact.targetRepoRoot,
    contentHash: verify.artifact.contentHash,
    bindingsHash: verify.artifact.bindingsHash,
    targetBaseHash: verify.artifact.targetBaseHash,
    frozenArgv: verify.artifact.frozenArgv,
  };

  const result = applyGenerated(
    approval,
    generated.files,
    bindings.bindings,
    verify.artifact.targetRepoRoot,
  );

  if (result.status === "completed") {
    writeApplyArtifact(
      runId,
      {
        status: "applied",
        verificationId: verify.artifact.verificationId,
        targetRepoRoot: verify.artifact.targetRepoRoot,
        written: result.written,
      },
      root,
    );
    const lines = [
      `Applied pattern "${verify.artifact.patternId}" to ${verify.artifact.targetRepoRoot}.`,
      `Wrote: ${result.written.join(", ")}`,
      "This completes the deployed workflow (init → survey → author → verify → apply).",
      "The generated gate is now part of your repository — review it before committing.",
    ];
    return { exitCode: 0, message: lines.join("\n") };
  }

  writeApplyArtifact(
    runId,
    {
      status: result.status,
      verificationId: verify.artifact.verificationId,
      targetRepoRoot: verify.artifact.targetRepoRoot,
      detail: result.detail,
    },
    root,
  );
  return {
    exitCode: 1,
    message: `${result.status}: ${result.detail}`,
  };
}
