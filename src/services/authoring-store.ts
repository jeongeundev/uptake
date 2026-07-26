import { resolve } from "node:path";

import { isId, isRelativePosixPath } from "@/lib/catalog/load";
import { registerPattern } from "@/lib/catalog/write";
import { contrastEvidence } from "@/lib/engine/abstract";
import { extractEvidence } from "@/lib/engine/extract";
import { draftAnchorOracle } from "@/lib/engine/oracle-draft";
import { selfVerifyOracle } from "@/lib/engine/self-verify";
import {
  approveDraft,
  consumeApprovedDraft,
  createDraft,
  rejectDraft,
  __resetDraftStoreForTests,
} from "@/services/draft-store";
import type { Proposer, ProposerMetadata } from "@/services/proposer";
import type {
  AuthoringRequest,
  CorroborationReport,
  DiscardedCandidate,
  TargetStackFact,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";

export type AuthoringError = {
  status:
    | "invalid-request"
    | "draft-not-found"
    | "source-unresolved"
    | "no-evidence"
    | "contrast-failed"
    | "oracle-not-anchor"
    | "self-verify-failed"
    | "not-approved"
    | "register-rejected";
  detail: string;
};

export type AuthoringDrafted = {
  status: "drafted";
  draftId: string;
  pattern: Pattern;
  corroboration: CorroborationReport;
  targetStackFacts: TargetStackFact[];
  discarded: DiscardedCandidate[];
  selfVerify:
    | { status: "passed"; frozenArgv: string[] }
    | { status: "skipped"; reason: "descriptive" }
    | { status: "failed"; detail: string };
  proposer: ProposerMetadata;
};

const requestKeys = [
  "patternId",
  "name",
  "intent",
  "capability",
  "evidenceStatus",
  "sources",
] as const;
const sourceKeys = [
  "id",
  "repository",
  "stack",
  "isTargetStack",
  "independenceGroup",
  "independenceNote",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isAuthoringRequest(value: unknown): value is AuthoringRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, requestKeys) ||
    !isId(value.patternId) ||
    !nonEmpty(value.name) ||
    !nonEmpty(value.intent) ||
    (value.capability !== "generative" &&
      value.capability !== "descriptive") ||
    (value.evidenceStatus !== "observed" &&
      value.evidenceStatus !== "corroborated") ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !hasExactKeys(source, sourceKeys) ||
      !isId(source.id) ||
      ids.has(source.id) ||
      !isRelativePosixPath(source.repository) ||
      !nonEmpty(source.stack) ||
      typeof source.isTargetStack !== "boolean" ||
      !isId(source.independenceGroup) ||
      !nonEmpty(source.independenceNote)
    ) {
      return false;
    }
    ids.add(source.id);
  }
  return true;
}

export async function createAuthoringDraft(
  sessionId: string,
  request: AuthoringRequest,
  proposer: Proposer,
): Promise<AuthoringDrafted | AuthoringError> {
  if (!isAuthoringRequest(request)) {
    return { status: "invalid-request", detail: "invalid authoring request" };
  }
  if (
    request.evidenceStatus === "corroborated" &&
    request.sources.length < 2
  ) {
    return {
      status: "invalid-request",
      detail: "corroborated authoring requires at least two sources",
    };
  }

  const sourceRoot =
    process.env.UPTAKE_SOURCE_ROOT ?? resolve(".uptake/sources");
  const extracted = await extractEvidence(request, proposer, sourceRoot);
  if (!extracted.ok) {
    return { status: extracted.reason, detail: extracted.detail };
  }
  const contrasted = await contrastEvidence(request, extracted, proposer);
  if (!contrasted.ok) {
    return {
      status: "contrast-failed",
      detail: `${contrasted.reason}: ${contrasted.detail}; corroboration=${JSON.stringify(contrasted.corroboration)}`,
    };
  }

  let pattern = contrasted.draft;
  let selfVerify: AuthoringDrafted["selfVerify"];
  if (request.capability === "generative") {
    const narrative = await proposer.proposeNarrative({
      intent: request.intent,
      capability: request.capability,
      roles: pattern.roles,
      bindingPoints: pattern.bindingPoints,
      sources: pattern.sources.map(({ stack, isTargetStack }) => ({
        stack,
        isTargetStack,
      })),
    });
    const oracle = draftAnchorOracle(pattern, narrative.violation);
    if (!oracle.ok) {
      return { status: "oracle-not-anchor", detail: oracle.detail };
    }
    pattern = oracle.pattern;
    const verified = await selfVerifyOracle(pattern);
    if (!verified.ok) {
      return {
        status: "self-verify-failed",
        detail: `${verified.status}: ${verified.detail}`,
      };
    }
    selfVerify = { status: "passed", frozenArgv: verified.frozenArgv };
  } else {
    selfVerify = { status: "skipped", reason: "descriptive" };
  }

  const draftId = createDraft({
    sessionId,
    pattern,
    proposerMetadata: proposer.metadata,
  });
  return {
    status: "drafted",
    draftId,
    pattern,
    corroboration: contrasted.corroboration,
    targetStackFacts: extracted.targetStackFacts,
    discarded: extracted.discarded,
    selfVerify,
    proposer: proposer.metadata,
  };
}

export function approveAuthoringDraft(
  sessionId: string,
  draftId: string,
): { status: "approved" } | AuthoringError {
  const result = approveDraft(draftId, sessionId);
  if (!result.ok) {
    return {
      status: "draft-not-found",
      detail:
        result.reason === "unknown-draft"
          ? "draft was not found"
          : "draft is not pending",
    };
  }
  return { status: "approved" };
}

export function rejectAuthoringDraft(
  sessionId: string,
  draftId: string,
): { status: "rejected" } | AuthoringError {
  const result = rejectDraft(draftId, sessionId);
  if (!result.ok) {
    return {
      status: "draft-not-found",
      detail:
        result.reason === "unknown-draft"
          ? "draft was not found"
          : "draft is not pending",
    };
  }
  return { status: "rejected" };
}

export function registerAuthoringDraft(
  sessionId: string,
  draftId: string,
): { status: "registered"; path: string } | AuthoringError {
  const consumed = consumeApprovedDraft(draftId, sessionId);
  if (!consumed.ok) {
    if (consumed.reason === "unknown-draft") {
      return { status: "draft-not-found", detail: "draft was not found" };
    }
    return {
      status: "not-approved",
      detail:
        consumed.reason === "already-consumed"
          ? "draft was already consumed"
          : "draft has not been approved",
    };
  }
  const registered = registerPattern(
    consumed.draft.pattern,
    process.env.UPTAKE_CATALOG_DIR ?? resolve("catalog"),
    process.env.UPTAKE_SOURCE_ROOT ?? resolve(".uptake/sources"),
  );
  if (!registered.ok) {
    return {
      status: "register-rejected",
      detail: `${registered.reason}: ${registered.detail}`,
    };
  }
  return { status: "registered", path: registered.path };
}

export function __resetAuthoringStoreForTests(): void {
  __resetDraftStoreForTests();
}
