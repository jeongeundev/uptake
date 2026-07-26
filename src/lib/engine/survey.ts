import {
  isId,
  isRelativePosixPath,
} from "@/lib/catalog/load";
import {
  collectSignalFiles,
  type SkippedSignal,
} from "@/lib/engine/survey-collect";
import type { SurveyProposer } from "@/services/proposer";
import type {
  CompiledSurveyRules,
  SurveyCandidate,
} from "@/types/survey";

export type DiscardedEvidence = {
  candidateId: string;
  path: string;
  reason: "not-collected";
};

export type DiscardedSurveyCandidate = {
  candidateId: string;
  reason: "invalid-shape" | "duplicate-id" | "no-evidence";
  detail: string;
};

export type SurveyResult =
  | {
      ok: true;
      repository: string;
      revision: string;
      collected: { path: string; ruleId: string; truncated: boolean }[];
      skipped: SkippedSignal[];
      candidates: SurveyCandidate[];
      discardedEvidence: DiscardedEvidence[];
      discardedCandidates: DiscardedSurveyCandidate[];
    }
  | {
      ok: false;
      reason:
        | "repository-unresolved"
        | "revision-unpinnable"
        | "no-signal"
        | "no-candidate";
      detail: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSurveyCandidate(value: unknown): value is SurveyCandidate {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.intent) &&
    isNonEmptyString(value.discipline) &&
    isNonEmptyString(value.tradeoffs) &&
    (value.confidence === "high" ||
      value.confidence === "medium" ||
      value.confidence === "low") &&
    Array.isArray(value.evidence) &&
    value.evidence.every((path) => typeof path === "string")
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateIdentifier(value: unknown, index: number): string {
  return isRecord(value) && isId(value.id)
    ? value.id
    : `candidate-${index + 1}`;
}

export async function surveyRepository(
  repository: string,
  proposer: SurveyProposer,
  rules: CompiledSurveyRules,
  sourceRoot?: string,
): Promise<SurveyResult> {
  const collected = collectSignalFiles(repository, rules, sourceRoot);
  if (!collected.ok) {
    return collected;
  }

  const proposals: unknown[] = await proposer.proposeSurveyCandidates({
    repository,
    revision: collected.revision,
    files: collected.files.map(({ path, ruleId, content }) => ({
      path,
      ruleId,
      content,
    })),
  });
  const collectedPaths = new Set(collected.files.map(({ path }) => path));
  const acceptedIds = new Set<string>();
  const candidates: SurveyCandidate[] = [];
  const discardedEvidence: DiscardedEvidence[] = [];
  const discardedCandidates: DiscardedSurveyCandidate[] = [];

  for (const [index, proposal] of proposals.entries()) {
    const candidateId = candidateIdentifier(proposal, index);
    if (!isSurveyCandidate(proposal)) {
      discardedCandidates.push({
        candidateId,
        reason: "invalid-shape",
        detail: "Candidate does not match the SURVEY candidate schema.",
      });
      continue;
    }
    if (acceptedIds.has(proposal.id)) {
      discardedCandidates.push({
        candidateId: proposal.id,
        reason: "duplicate-id",
        detail: `Candidate id ${proposal.id} was already accepted.`,
      });
      continue;
    }

    const evidence: string[] = [];
    const seenEvidence = new Set<string>();
    for (const path of proposal.evidence) {
      if (!isRelativePosixPath(path) || !collectedPaths.has(path)) {
        discardedEvidence.push({
          candidateId: proposal.id,
          path,
          reason: "not-collected",
        });
      } else if (!seenEvidence.has(path)) {
        seenEvidence.add(path);
        evidence.push(path);
      }
    }

    if (evidence.length === 0) {
      discardedCandidates.push({
        candidateId: proposal.id,
        reason: "no-evidence",
        detail: "Candidate has no evidence from the collected signal files.",
      });
      continue;
    }

    acceptedIds.add(proposal.id);
    candidates.push({ ...proposal, evidence });
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "no-candidate",
      detail: "No proposed SURVEY candidate retained collected evidence.",
    };
  }

  candidates.sort((left, right) => compareText(left.id, right.id));
  discardedEvidence.sort(
    (left, right) =>
      compareText(left.candidateId, right.candidateId) ||
      compareText(left.path, right.path),
  );
  discardedCandidates.sort((left, right) =>
    compareText(left.candidateId, right.candidateId),
  );

  return {
    ok: true,
    repository,
    revision: collected.revision,
    collected: collected.files.map(({ path, ruleId, truncated }) => ({
      path,
      ruleId,
      truncated,
    })),
    skipped: collected.skipped,
    candidates,
    discardedEvidence,
    discardedCandidates,
  };
}
