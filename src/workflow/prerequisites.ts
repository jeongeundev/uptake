import type {
  ApplyArtifact,
  AuthoringArtifact,
  SurveyArtifact,
  VerifyArtifact,
} from "@/workflow/artifacts";
import {
  readApplyArtifact,
  readAuthoringArtifact,
  readSurveyArtifact,
  readVerifyArtifact,
} from "@/workflow/artifacts";
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

type AuthoringDraftedArtifact = Extract<AuthoringArtifact, { status: "drafted" }>;

export function authoringState(
  runId: string,
  root?: string,
): StageState<AuthoringDraftedArtifact> {
  const artifact = readAuthoringArtifact(runId, root);
  if (artifact === undefined) {
    return { state: "missing" };
  }
  if (artifact.status === "drafted") {
    return { state: "succeeded", artifact };
  }
  return { state: "failed", status: artifact.status, detail: artifact.detail };
}

type VerifyVerifiedArtifact = Extract<VerifyArtifact, { status: "verified" }>;

export function verifyState(
  runId: string,
  root?: string,
): StageState<VerifyVerifiedArtifact> {
  const artifact = readVerifyArtifact(runId, root);
  if (artifact === undefined) {
    return { state: "missing" };
  }
  if (artifact.status === "verified") {
    return { state: "succeeded", artifact };
  }
  return { state: "failed", status: artifact.status, detail: artifact.detail };
}

type AppliedArtifact = Extract<ApplyArtifact, { status: "applied" }>;

export function applyState(
  runId: string,
  root?: string,
): StageState<AppliedArtifact> {
  const artifact = readApplyArtifact(runId, root);
  if (artifact === undefined) {
    return { state: "missing" };
  }
  if (artifact.status === "applied") {
    return { state: "succeeded", artifact };
  }
  return { state: "failed", status: artifact.status, detail: artifact.detail };
}
