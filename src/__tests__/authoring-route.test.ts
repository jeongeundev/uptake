import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { __setAuthoringProposerForTests } from "@/app/api/authoring/proposer";
import { POST as createDraft } from "@/app/api/authoring/drafts/route";
import { POST as approveDraft } from "@/app/api/authoring/drafts/[draftId]/approve/route";
import { createStubProposer } from "@/services/proposer-stub";

afterEach(() => {
  __setAuthoringProposerForTests(undefined);
});

describe("authoring route boundary", () => {
  it("rejects unknown request fields", async () => {
    __setAuthoringProposerForTests(createStubProposer({}));
    const response = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        body: JSON.stringify({
          patternId: "method",
          name: "Method",
          intent: "Observe method",
          capability: "descriptive",
          evidenceStatus: "observed",
          sources: [],
          approved: true,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "invalid-request",
    });
  });

  it("returns an explicit error when no proposer adapter is configured", async () => {
    const response = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        body: JSON.stringify({
          patternId: "method",
          name: "Method",
          intent: "Observe method",
          capability: "descriptive",
          evidenceStatus: "observed",
          sources: [
            {
              id: "one",
              repository: "example/one",
              stack: "php",
              isTargetStack: false,
              independenceGroup: "one",
              independenceNote: "Independent.",
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid-request",
      detail: "authoring proposer adapter is not configured",
    });
  });

  it("binds approval to the session cookie", async () => {
    const response = await approveDraft(
      new NextRequest("http://localhost/api/authoring/drafts/id/approve", {
        method: "POST",
        headers: { cookie: "uptake-session=other-session" },
      }),
      { params: Promise.resolve({ draftId: "unknown" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      status: "draft-not-found",
    });
  });
});
