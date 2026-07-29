import { join } from "node:path";

import { adoptSurveyCandidate } from "@/lib/engine/survey-adopt";
import type { AuthoringArtifact } from "@/workflow/artifacts";
import { writeAuthoringArtifact } from "@/workflow/artifacts";
import { readCurrentRun, runDir, sourceRoot } from "@/workflow/paths";
import { surveyState } from "@/workflow/prerequisites";

export type AuthorCommandResult = {
  exitCode: 0 | 1 | 2 | 3;
  message: string;
};

const RUN_SURVEY_HINT = "Run `uptake survey <repository>` first.";

export async function runAuthorCommand(
  candidateId: string,
  root?: string,
): Promise<AuthorCommandResult> {
  const runId = readCurrentRun(root);
  if (runId === undefined) {
    return {
      exitCode: 2,
      message: `No survey run found. ${RUN_SURVEY_HINT}`,
    };
  }

  const state = surveyState(runId, root);
  if (state.state === "missing") {
    return {
      exitCode: 2,
      message: `survey.json is missing for run ${runId}. ${RUN_SURVEY_HINT}`,
    };
  }
  if (state.state === "failed") {
    return {
      exitCode: 2,
      message: `The current survey (run ${runId}) did not succeed (${state.status}): ${state.detail}\n${RUN_SURVEY_HINT}`,
    };
  }

  const artifact = state.artifact;
  const candidate = artifact.candidates.find((item) => item.id === candidateId);
  if (candidate === undefined) {
    const available =
      artifact.candidates.map((item) => item.id).join(", ") || "(none)";
    return {
      exitCode: 2,
      message: `Unknown candidate "${candidateId}". Available candidates: ${available}`,
    };
  }

  const adopted = await adoptSurveyCandidate(
    {
      repository: artifact.repository,
      revision: artifact.revision,
      candidate,
    },
    sourceRoot(root),
  );

  const authoringArtifact: AuthoringArtifact = adopted.ok
    ? {
        status: "drafted",
        candidateId,
        pattern: adopted.pattern,
        discarded: adopted.discarded,
        targetStackFacts: adopted.targetStackFacts,
      }
    : {
        status: adopted.reason,
        candidateId,
        detail: adopted.detail,
        discarded: adopted.discarded,
      };

  writeAuthoringArtifact(runId, authoringArtifact, root);
  const path = join(runDir(runId, root), "authoring.json");

  if (!adopted.ok) {
    return {
      exitCode: 1,
      message: `${adopted.reason}: ${adopted.detail}\nRecorded ${path}.`,
    };
  }

  const lines = [
    `Adopted candidate "${candidateId}" as pattern "${adopted.pattern.name}" (${adopted.pattern.patternId}).`,
    `capability=${adopted.pattern.capability} evidenceStatus=${adopted.pattern.evidenceStatus}`,
    `Evidence: ${adopted.pattern.provenance.map((item) => item.path).join(", ")}`,
  ];
  if (adopted.discarded.length > 0) {
    lines.push(
      `Discarded ${adopted.discarded.length} candidate file(s):`,
      ...adopted.discarded.map(
        (item) => `  - ${item.sourceId}:${item.path} (${item.reason})`,
      ),
    );
  }
  lines.push(`Recorded ${path}.`);
  lines.push("This is the current end of the deployed workflow.");

  return { exitCode: 0, message: lines.join("\n") };
}
