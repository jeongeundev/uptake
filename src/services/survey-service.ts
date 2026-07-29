import { resolve } from "node:path";

import {
  type DiscardedEvidence,
  type DiscardedSurveyCandidate,
  surveyRepository,
} from "@/lib/engine/survey";
import { adoptSurveyCandidate } from "@/lib/engine/survey-adopt";
import {
  loadSurveyRules,
  SurveyRulesError,
} from "@/lib/engine/survey-rules";
import {
  createDraft,
  hashAuthoringRequest,
} from "@/services/draft-store";
import type { ProposerMetadata, SurveyProposer } from "@/services/proposer";
import { createSurvey, getSurvey } from "@/services/survey-store";
import type {
  AuthoringRequest,
  DiscardedCandidate,
  TargetStackFact,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";
import type { SurveyCandidate } from "@/types/survey";

export type SurveyError = {
  status:
    | "survey-not-found"
    | "candidate-not-found"
    | "survey-rules-error"
    | "repository-unresolved"
    | "revision-unpinnable"
    | "no-signal"
    | "no-candidate"
    | "adoption-failed";
  detail: string;
  repository?: string;
  revision?: string;
  collected?: { path: string; ruleId: string; truncated: boolean }[];
  skipped?: {
    path: string;
    ruleId: string;
    reason: "budget-exhausted" | "unreadable";
  }[];
  discardedEvidence?: DiscardedEvidence[];
  discardedCandidates?: DiscardedSurveyCandidate[];
};

export type SurveyedResponse = {
  status: "surveyed";
  surveyId: string;
  repository: string;
  revision: string;
  candidates: SurveyCandidate[];
  collected: { path: string; ruleId: string; truncated: boolean }[];
  skipped: {
    path: string;
    ruleId: string;
    reason: "budget-exhausted" | "unreadable";
  }[];
  discardedEvidence: DiscardedEvidence[];
  discardedCandidates: DiscardedSurveyCandidate[];
  proposer: ProposerMetadata;
};

export type AdoptedResponse = {
  status: "drafted";
  draftId: string;
  pattern: Pattern;
  authoringRequest: AuthoringRequest;
  discarded: DiscardedCandidate[];
  targetStackFacts: TargetStackFact[];
};

function sourceRoot(): string {
  return process.env.UPTAKE_SOURCE_ROOT ?? resolve(".uptake/sources");
}

export async function runSurvey(
  sessionId: string,
  repository: string,
  proposer: SurveyProposer,
): Promise<SurveyedResponse | SurveyError> {
  let rules;
  try {
    rules = loadSurveyRules();
  } catch (error) {
    if (!(error instanceof SurveyRulesError)) throw error;
    return { status: "survey-rules-error", detail: error.message };
  }
  const surveyed = await surveyRepository(
    repository,
    proposer,
    rules,
    sourceRoot(),
  );
  if (!surveyed.ok) {
    return "repository" in surveyed
      ? {
          status: surveyed.reason,
          detail: surveyed.detail,
          repository: surveyed.repository,
          revision: surveyed.revision,
          collected: surveyed.collected,
          skipped: surveyed.skipped,
          discardedEvidence: surveyed.discardedEvidence,
          discardedCandidates: surveyed.discardedCandidates,
        }
      : { status: surveyed.reason, detail: surveyed.detail };
  }
  const surveyId = createSurvey({
    sessionId,
    repository: surveyed.repository,
    revision: surveyed.revision,
    candidates: surveyed.candidates,
    proposerMetadata: proposer.metadata,
  });
  return {
    status: "surveyed",
    surveyId,
    repository: surveyed.repository,
    revision: surveyed.revision,
    candidates: surveyed.candidates,
    collected: surveyed.collected,
    skipped: surveyed.skipped,
    discardedEvidence: surveyed.discardedEvidence,
    discardedCandidates: surveyed.discardedCandidates,
    proposer: proposer.metadata,
  };
}

export async function adoptCandidate(
  sessionId: string,
  surveyId: string,
  candidateId: string,
): Promise<AdoptedResponse | SurveyError> {
  const survey = getSurvey(surveyId, sessionId);
  if (survey === undefined) {
    return { status: "survey-not-found", detail: "survey was not found" };
  }
  const candidate = survey.candidates.find(({ id }) => id === candidateId);
  if (candidate === undefined) {
    return {
      status: "candidate-not-found",
      detail: "candidate was not found in the survey",
    };
  }
  const adopted = await adoptSurveyCandidate(
    {
      repository: survey.repository,
      revision: survey.revision,
      candidate,
    },
    sourceRoot(),
  );
  if (!adopted.ok) {
    return {
      status: "adoption-failed",
      detail: `${adopted.reason}: ${adopted.detail}`,
    };
  }
  const draftId = createDraft({
    sessionId,
    requestFingerprint: hashAuthoringRequest(adopted.request),
    pattern: adopted.pattern,
    proposerMetadata: survey.proposerMetadata,
  });
  return {
    status: "drafted",
    draftId,
    pattern: adopted.pattern,
    authoringRequest: adopted.request,
    discarded: adopted.discarded,
    targetStackFacts: adopted.targetStackFacts,
  };
}
