import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetDraftStoreForTests,
  approveDraft,
  consumeApprovedDraft,
  createDraft,
} from "@/services/draft-store";
import type { Pattern } from "@/types/pattern";

const pattern = {
  schemaVersion: 1,
  patternId: "draft-pattern",
  name: "Draft pattern",
  capability: "descriptive",
  evidenceStatus: "observed",
  intent: "Describe a method.",
  roles: [{ id: "method", description: "Observed method" }],
  bindingPoints: [],
  sources: [
    {
      id: "source",
      repository: "example/source",
      revision: "a".repeat(40),
      stack: "text",
      isTargetStack: false,
      independenceGroup: "source",
      independenceNote: "Independent fixture.",
    },
  ],
  provenance: [
    { sourceId: "source", path: "method.md", observedRole: "method" },
  ],
  tradeoffs: "Observed once.",
} satisfies Pattern;

const input = {
  sessionId: "session-one",
  pattern,
  proposerMetadata: { providerId: "stub", modelId: "fixture" },
};

beforeEach(__resetDraftStoreForTests);

describe("draft store", () => {
  it("moves from pending to approved and permits one consumption", () => {
    const draftId = createDraft(input);

    expect(consumeApprovedDraft(draftId, input.sessionId)).toEqual({
      ok: false,
      reason: "not-approved",
    });
    expect(approveDraft(draftId, input.sessionId)).toEqual({ ok: true });
    expect(approveDraft(draftId, input.sessionId)).toEqual({
      ok: false,
      reason: "invalid-state",
    });
    expect(consumeApprovedDraft(draftId, input.sessionId)).toMatchObject({
      ok: true,
      draft: { ...input, status: "consumed" },
    });
    expect(consumeApprovedDraft(draftId, input.sessionId)).toEqual({
      ok: false,
      reason: "already-consumed",
    });
  });

  it("hides drafts from other sessions", () => {
    const draftId = createDraft(input);

    expect(approveDraft(draftId, "session-two")).toEqual({
      ok: false,
      reason: "unknown-draft",
    });
    expect(consumeApprovedDraft(draftId, "session-two")).toEqual({
      ok: false,
      reason: "unknown-draft",
    });
  });

  it("defensively copies stored and returned pattern values", () => {
    const mutablePattern = structuredClone(pattern);
    const draftId = createDraft({ ...input, pattern: mutablePattern });
    mutablePattern.name = "mutated outside";
    expect(approveDraft(draftId, input.sessionId)).toEqual({ ok: true });

    const consumed = consumeApprovedDraft(draftId, input.sessionId);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.draft.pattern.name).toBe("Draft pattern");
    consumed.draft.pattern.name = "mutated return";

    expect(consumeApprovedDraft(draftId, input.sessionId)).toEqual({
      ok: false,
      reason: "already-consumed",
    });
  });
});
