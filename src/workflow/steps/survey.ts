import { join } from "node:path";

import { surveyRepository, type SurveyResult } from "@/lib/engine/survey";
import { loadSurveyRules, SurveyRulesError } from "@/lib/engine/survey-rules";
import { AnthropicProposerConfigurationError } from "@/services/proposer-anthropic";
import { configuredSurveyProposer } from "@/services/survey-proposer";
import type { SurveyArtifact } from "@/workflow/artifacts";
import { writeSurveyArtifact } from "@/workflow/artifacts";
import {
  createRun,
  runDir,
  sourceRoot,
  writeCurrentRun,
} from "@/workflow/paths";

export type SurveyCommandResult = {
  exitCode: 0 | 1 | 2 | 3;
  message: string;
  runId?: string;
};

function toSurveyArtifact(result: SurveyResult): SurveyArtifact {
  if (result.ok) {
    return {
      status: "surveyed",
      repository: result.repository,
      revision: result.revision,
      collected: result.collected,
      skipped: result.skipped,
      candidates: result.candidates,
      discardedEvidence: result.discardedEvidence,
      discardedCandidates: result.discardedCandidates,
    };
  }

  if (result.reason === "no-signal" || result.reason === "no-candidate") {
    return {
      status: result.reason,
      detail: result.detail,
      repository: result.repository,
      revision: result.revision,
      collected: result.collected,
      skipped: result.skipped,
      discardedEvidence: result.discardedEvidence,
      discardedCandidates: result.discardedCandidates,
    };
  }

  return { status: result.reason, detail: result.detail };
}

function describeCandidates(
  candidates: { id: string; name: string; evidence: string[] }[],
): string[] {
  return candidates.map(
    (candidate) =>
      `  - ${candidate.id} (${candidate.name}): ${candidate.evidence.length} evidence path(s)`,
  );
}

function artifactPath(runId: string, root: string | undefined): string {
  return join(runDir(runId, root), "survey.json");
}

export async function runSurveyCommand(
  repository: string,
  root?: string,
): Promise<SurveyCommandResult> {
  let rules;
  try {
    rules = loadSurveyRules();
  } catch (error) {
    if (!(error instanceof SurveyRulesError)) throw error;
    return {
      exitCode: 2,
      message: `Survey rules are not available: ${error.message}`,
    };
  }

  let proposer;
  try {
    proposer = configuredSurveyProposer();
  } catch (error) {
    if (!(error instanceof AnthropicProposerConfigurationError)) throw error;
    return {
      exitCode: 2,
      message: `Survey proposer is not configured: ${error.message}`,
    };
  }

  const runId = createRun(repository, root);
  const result = await surveyRepository(
    repository,
    proposer,
    rules,
    sourceRoot(root),
  );

  writeSurveyArtifact(runId, toSurveyArtifact(result), root);
  writeCurrentRun(runId, root);

  const path = artifactPath(runId, root);

  if (result.ok) {
    const lines = [
      `Surveyed ${result.repository} at ${result.revision} (run ${runId}).`,
      `${result.candidates.length} candidate(s):`,
      ...describeCandidates(result.candidates),
      `Recorded ${path}.`,
      "Next: uptake author --candidate <id>",
    ];
    return { exitCode: 0, message: lines.join("\n"), runId };
  }

  if (
    result.reason === "repository-unresolved" ||
    result.reason === "revision-unpinnable"
  ) {
    return {
      exitCode: 2,
      message: `${result.reason}: ${result.detail}\nRecorded ${path}.`,
      runId,
    };
  }

  return {
    exitCode: 1,
    message: `${result.reason}: ${result.detail}\nRecorded ${path}.`,
    runId,
  };
}
