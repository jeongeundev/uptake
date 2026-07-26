import { createHash, randomUUID } from "node:crypto";

import type { ProposerMetadata } from "@/services/proposer";
import type { AuthoringRequest } from "@/types/authoring";
import type { Pattern } from "@/types/pattern";

export type StoredDraft = {
  sessionId: string;
  requestFingerprint: string;
  pattern: Pattern;
  proposerMetadata: ProposerMetadata;
  status: "pending" | "approved" | "consumed" | "rejected";
};

const drafts = new Map<string, StoredDraft>();

function copyDraft(draft: StoredDraft): StoredDraft {
  return structuredClone(draft);
}

export function hashAuthoringRequest(request: AuthoringRequest): string {
  const hash = createHash("sha256");
  const update = (value: string): void => {
    hash.update(String(Buffer.byteLength(value)));
    hash.update(":");
    hash.update(value);
  };
  for (const value of [
    request.patternId,
    request.name,
    request.intent,
    request.capability,
    request.evidenceStatus,
  ]) {
    update(value);
  }
  for (const source of request.sources) {
    for (const value of [
      source.id,
      source.repository,
      source.stack,
      String(source.isTargetStack),
      source.independenceGroup,
      source.independenceNote,
    ]) {
      update(value);
    }
  }
  return hash.digest("hex");
}

export function createDraft(input: Omit<StoredDraft, "status">): string {
  for (const draft of drafts.values()) {
    if (
      draft.sessionId === input.sessionId &&
      (draft.status === "pending" || draft.status === "approved")
    ) {
      draft.status = "rejected";
    }
  }
  const draftId = randomUUID();
  drafts.set(draftId, copyDraft({ ...input, status: "pending" }));
  return draftId;
}

export function approveDraft(
  draftId: string,
  sessionId: string,
  requestFingerprint: string,
):
  | { ok: true }
  | {
      ok: false;
      reason: "unknown-draft" | "stale-input" | "invalid-state";
    } {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.sessionId !== sessionId) {
    return { ok: false, reason: "unknown-draft" };
  }
  if (draft.requestFingerprint !== requestFingerprint) {
    return { ok: false, reason: "stale-input" };
  }
  if (draft.status !== "pending") {
    return { ok: false, reason: "invalid-state" };
  }
  draft.status = "approved";
  return { ok: true };
}

export function rejectDraft(
  draftId: string,
  sessionId: string,
): { ok: true } | { ok: false; reason: "unknown-draft" | "invalid-state" } {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.sessionId !== sessionId) {
    return { ok: false, reason: "unknown-draft" };
  }
  if (draft.status !== "pending" && draft.status !== "approved") {
    return { ok: false, reason: "invalid-state" };
  }
  draft.status = "rejected";
  return { ok: true };
}

export function consumeApprovedDraft(
  draftId: string,
  sessionId: string,
  requestFingerprint: string,
):
  | { ok: true; draft: StoredDraft }
  | {
      ok: false;
      reason:
        | "unknown-draft"
        | "stale-input"
        | "not-approved"
        | "already-consumed";
    } {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.sessionId !== sessionId) {
    return { ok: false, reason: "unknown-draft" };
  }
  if (draft.requestFingerprint !== requestFingerprint) {
    return { ok: false, reason: "stale-input" };
  }
  if (draft.status === "pending" || draft.status === "rejected") {
    return { ok: false, reason: "not-approved" };
  }
  if (draft.status === "consumed") {
    return { ok: false, reason: "already-consumed" };
  }
  draft.status = "consumed";
  return { ok: true, draft: copyDraft(draft) };
}

export function __resetDraftStoreForTests(): void {
  drafts.clear();
}
