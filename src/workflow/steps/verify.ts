import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { validatePatternValue } from "@/lib/catalog/load";
import { hashTargetBase } from "@/lib/engine/apply";
import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import { targetEligibility } from "@/lib/engine/target";
import {
  executeVerification,
  hashBindings,
  prepareVerification,
  type VerifyOutcome,
} from "@/lib/engine/verify";
import {
  writeBindingsArtifact,
  writeGeneratedArtifact,
  writeRunLog,
  writeVerifyArtifact,
  type PatternProvenance,
} from "@/workflow/artifacts";
import { readCurrentRun, runDir, sourceRoot } from "@/workflow/paths";
import { authoringState } from "@/workflow/prerequisites";
import type { Pattern } from "@/types/pattern";

export type VerifyCommandResult = {
  exitCode: 0 | 1 | 2 | 3;
  message: string;
};

const RUN_SURVEY_HINT = "Run `uptake survey <repository>` first.";
const RUN_AUTHOR_HINT = "Run `uptake author --candidate <id>` first.";

function artifactPath(runId: string, root: string | undefined): string {
  return join(runDir(runId, root), "verify.json");
}

// The same sourceId → repository/revision join the web surface renders
// (catalog-bindings-wizard 'Provenance'). Flattened onto verify.json so that
// apply can show where the pattern came from without reading the pattern.
function patternProvenance(pattern: Pattern): PatternProvenance[] {
  const sources = new Map(pattern.sources.map((source) => [source.id, source]));
  return pattern.provenance.map((item) => {
    const source = sources.get(item.sourceId);
    return {
      repository: source?.repository ?? item.sourceId,
      revision: source?.revision ?? "unknown revision",
      path: item.path,
    };
  });
}

function persistLogs(
  runId: string,
  outcome: VerifyOutcome,
  root: string | undefined,
): void {
  if (outcome.status === "awaiting-approval") {
    writeRunLog(runId, "positive", outcome.positiveLog, root);
    writeRunLog(runId, "negative", outcome.negativeLog, root);
    return;
  }
  if (outcome.positiveLog !== undefined) {
    writeRunLog(runId, "positive", outcome.positiveLog, root);
  }
  if (outcome.negativeLog !== undefined) {
    writeRunLog(runId, "negative", outcome.negativeLog, root);
  }
}

export async function runVerifyCommand(
  targetRepoRoot: string,
  root?: string,
): Promise<VerifyCommandResult> {
  const runId = readCurrentRun(root);
  if (runId === undefined) {
    return {
      exitCode: 2,
      message: `No survey run found. ${RUN_SURVEY_HINT}`,
    };
  }

  const authoring = authoringState(runId, root);
  if (authoring.state === "missing") {
    return {
      exitCode: 2,
      message: `authoring.json is missing for run ${runId}. ${RUN_AUTHOR_HINT}`,
    };
  }
  if (authoring.state === "failed") {
    return {
      exitCode: 2,
      message: `The current authoring draft (run ${runId}) did not succeed (${authoring.status}): ${authoring.detail}\n${RUN_AUTHOR_HINT}`,
    };
  }

  const pattern = authoring.artifact.pattern;
  const path = artifactPath(runId, root);

  // ADR-025: this is the CLI's entire layer-1 guarantee, made at consumption
  // time because the CLI never goes through loadCatalog. `filename` must be
  // synthesized as `${patternId}.json` (the catalog naming convention) and
  // must NOT be the literal artifact filename ("authoring.json") — passing
  // that verbatim trips the `basename(filename) !== patternId` check in
  // load.ts and returns "schema-invalid" before reference/evidence/
  // provenance are ever checked, which would make provenance re-validation
  // look like it ran when it never did.
  const validation = validatePatternValue(
    pattern,
    `${pattern.patternId}.json`,
    sourceRoot(root),
  );
  if (!validation.ok) {
    writeVerifyArtifact(
      runId,
      {
        status: "pattern-invalid",
        detail: validation.reason,
        patternId: pattern.patternId,
        targetRepoRoot,
      },
      root,
    );
    return {
      exitCode: 1,
      message: `pattern-invalid: ${validation.reason}\nRecorded ${path}.`,
    };
  }

  const ineligibleReason = targetEligibility(targetRepoRoot);
  if (ineligibleReason !== undefined) {
    writeVerifyArtifact(
      runId,
      {
        status: "target-ineligible",
        detail: ineligibleReason,
        patternId: pattern.patternId,
        targetRepoRoot,
      },
      root,
    );
    return {
      exitCode: 2,
      message: `target-ineligible: ${ineligibleReason}\nRecorded ${path}.`,
    };
  }

  const bindings = detectBindings(pattern, targetRepoRoot);
  writeBindingsArtifact(
    runId,
    { patternId: pattern.patternId, targetRepoRoot, bindings },
    root,
  );

  const checker = bindings.find((binding) => binding.kind === "checker");
  const gateLocation = bindings.find(
    (binding) => binding.kind === "gate-location",
  );
  const checkerResolved =
    checker !== undefined &&
    checker.status !== "binding-unresolved" &&
    checker.value === "vitest";
  const gateLocationResolved =
    gateLocation !== undefined && gateLocation.status !== "binding-unresolved";
  if (!checkerResolved || !gateLocationResolved) {
    // The CLI has no flow for entering binding values, unlike the web wizard
    // (ARCHITECTURE 'verify → apply 결속'). An unresolved checker or
    // gate-location is therefore a hard stop, not something to prompt for.
    const detail =
      "a resolved vitest checker and gate-location binding are required; " +
      "the CLI has no way to accept binding input";
    writeVerifyArtifact(
      runId,
      {
        status: "bindings-unresolved",
        detail,
        patternId: pattern.patternId,
        targetRepoRoot,
      },
      root,
    );
    return {
      exitCode: 2,
      message: `bindings-unresolved: ${detail}\nRecorded ${path}.`,
    };
  }

  const instantiated = instantiate(pattern, bindings);
  if (!instantiated.ok) {
    writeVerifyArtifact(
      runId,
      {
        status: instantiated.reason,
        detail: instantiated.detail,
        patternId: pattern.patternId,
        targetRepoRoot,
      },
      root,
    );
    // CLI `author` only ever produces descriptive/observed patterns
    // (ADR-023), so hitting the generative+corroborated gate here is the
    // expected outcome, not a bug to route around (ADR-007/012).
    const note =
      instantiated.reason === "generation-blocked"
        ? " This pattern is descriptive; it is not eligible for generation."
        : "";
    return {
      exitCode: 1,
      message: `${instantiated.reason}: ${instantiated.detail}${note}\nRecorded ${path}.`,
    };
  }

  writeGeneratedArtifact(
    runId,
    {
      patternId: pattern.patternId,
      files: instantiated.files,
      injection: instantiated.injection,
      gateTestId: instantiated.gateTestId,
    },
    root,
  );

  const prepared = prepareVerification(
    pattern,
    instantiated,
    bindings,
    targetRepoRoot,
  );
  if (prepared.status !== "prepared") {
    writeVerifyArtifact(
      runId,
      {
        status: "positive-failed",
        detail: prepared.detail,
        patternId: pattern.patternId,
        targetRepoRoot,
      },
      root,
    );
    return {
      exitCode: 1,
      message: `positive-failed: ${prepared.detail}\nRecorded ${path}.`,
    };
  }

  const outcome = await executeVerification(prepared);
  persistLogs(runId, outcome, root);

  if (outcome.status === "awaiting-approval") {
    const verificationId = randomUUID();
    writeVerifyArtifact(
      runId,
      {
        status: "verified",
        verificationId,
        patternId: pattern.patternId,
        targetRepoRoot,
        contentHash: outcome.contentHash,
        bindingsHash: hashBindings(bindings),
        targetBaseHash: hashTargetBase(targetRepoRoot),
        frozenArgv: outcome.frozenArgv,
        gateTestId: instantiated.gateTestId,
        positivePreview: outcome.positivePreview,
        positiveTruncated: outcome.positiveTruncated,
        negativePreview: outcome.negativePreview,
        negativeTruncated: outcome.negativeTruncated,
        tradeoffs: pattern.tradeoffs,
        provenance: patternProvenance(pattern),
      },
      root,
    );
    const lines = [
      `Verified pattern "${pattern.patternId}" against ${targetRepoRoot}.`,
      `Gate test: ${instantiated.gateTestId}`,
      `Recorded ${path}.`,
      "Next: uptake apply",
    ];
    return { exitCode: 0, message: lines.join("\n") };
  }

  writeVerifyArtifact(
    runId,
    {
      status: outcome.status,
      detail: outcome.detail,
      patternId: pattern.patternId,
      targetRepoRoot,
      frozenArgv: outcome.frozenArgv,
    },
    root,
  );
  // gate-error/timeout are infrastructure failures, not a caught violation —
  // they must never be counted as exit 1 (ADR-008: an execution that never
  // produced a reporter result is not "the gate caught the violation").
  const exitCode =
    outcome.status === "gate-error" || outcome.status === "timeout" ? 3 : 1;
  return {
    exitCode,
    message: `${outcome.status}: ${outcome.detail}\nRecorded ${path}.`,
  };
}
