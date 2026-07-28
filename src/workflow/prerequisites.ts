import type { SurveyArtifact } from "@/workflow/artifacts";
import { readSurveyArtifact } from "@/workflow/artifacts";
import { readCurrentRun } from "@/workflow/paths";

export type StageState<T> =
  | { state: "missing" }
  | { state: "failed"; status: string; detail: string }
  | { state: "succeeded"; artifact: T };

type SurveySucceededArtifact = Extract<SurveyArtifact, { status: "surveyed" }>;

export function surveyState(
  runId: string,
  root?: string,
): StageState<SurveySucceededArtifact> {
  const artifact = readSurveyArtifact(runId, root);
  if (artifact === undefined) {
    return { state: "missing" };
  }
  if (artifact.status === "surveyed") {
    return { state: "succeeded", artifact };
  }
  return { state: "failed", status: artifact.status, detail: artifact.detail };
}

export type CurrentSurveyState =
  | { state: "no-run" }
  | StageState<SurveySucceededArtifact>;

export function currentSurveyState(root?: string): CurrentSurveyState {
  const runId = readCurrentRun(root);
  if (runId === undefined) {
    return { state: "no-run" };
  }
  return surveyState(runId, root);
}
