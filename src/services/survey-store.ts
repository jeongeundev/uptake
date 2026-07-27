import { randomUUID } from "node:crypto";

import type { ProposerMetadata } from "@/services/proposer";
import type { SurveyCandidate } from "@/types/survey";

export type StoredSurvey = {
  sessionId: string;
  repository: string;
  revision: string;
  candidates: SurveyCandidate[];
  proposerMetadata: ProposerMetadata;
};

const surveys = new Map<string, StoredSurvey>();

function copySurvey(survey: StoredSurvey): StoredSurvey {
  return structuredClone(survey);
}

export function createSurvey(input: StoredSurvey): string {
  const surveyId = randomUUID();
  surveys.set(surveyId, copySurvey(input));
  return surveyId;
}

export function getSurvey(
  surveyId: string,
  sessionId: string,
): StoredSurvey | undefined {
  const survey = surveys.get(surveyId);
  return survey?.sessionId === sessionId ? copySurvey(survey) : undefined;
}

export function __resetSurveyStoreForTests(): void {
  surveys.clear();
}
