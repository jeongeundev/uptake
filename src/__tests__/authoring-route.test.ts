import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setAuthoringProposerForTests } from "@/app/api/authoring/proposer";
import { POST as createDraft } from "@/app/api/authoring/drafts/route";
import { POST as approveDraft } from "@/app/api/authoring/drafts/[draftId]/approve/route";
import { POST as registerDraft } from "@/app/api/authoring/drafts/[draftId]/register/route";
import { POST as rejectDraft } from "@/app/api/authoring/drafts/[draftId]/reject/route";
import {
  AnthropicProposerConfigurationError,
  createAnthropicProposerFromEnv,
} from "@/services/proposer-anthropic";
import {
  __resetAuthoringStoreForTests,
  createAuthoringDraft,
} from "@/services/authoring-store";
import { createStubProposer } from "@/services/proposer-stub";

vi.mock("@/services/proposer-anthropic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/proposer-anthropic")>();
  return { ...actual, createAnthropicProposerFromEnv: vi.fn() };
});

let root: string;

function createRepository(sourceRoot: string): void {
  const path = join(sourceRoot, "example", "one");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "method.md"), "observed method\n");
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake Test",
      "-c",
      "user.email=uptake@example.test",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: path },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-authoring-route-"));
  const sourceRoot = join(root, "sources");
  mkdirSync(sourceRoot);
  createRepository(sourceRoot);
  process.env.UPTAKE_SOURCE_ROOT = sourceRoot;
  __resetAuthoringStoreForTests();
});

afterEach(() => {
  __setAuthoringProposerForTests(undefined);
  vi.mocked(createAnthropicProposerFromEnv).mockReset();
  delete process.env.UPTAKE_SOURCE_ROOT;
  rmSync(root, { recursive: true, force: true });
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

  it("returns an explicit error when proposer configuration is missing", async () => {
    vi.mocked(createAnthropicProposerFromEnv).mockImplementation(() => {
      throw new AnthropicProposerConfigurationError(
        "UPTAKE_PROPOSER_MODEL is required",
      );
    });
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
      detail: "UPTAKE_PROPOSER_MODEL is required",
    });
  });

  it("preserves production adapter metadata in the authoring response", async () => {
    vi.mocked(createAnthropicProposerFromEnv).mockReturnValue(
      createStubProposer({
        metadata: {
          providerId: "anthropic",
          modelId: "configured-production-model",
        },
        fileCandidates: ({ sourceId }) => [
          {
            sourceId,
            path: "method.md",
            roleId: "method",
            rationale: "fixture",
          },
        ],
        contrast: {
          roles: [{ id: "method", description: "Observed method." }],
          bindingPoints: [],
        },
        narrative: {
          violation: "not used",
          tradeoffs: "Observed in the supplied repository.",
        },
      }),
    );
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

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "drafted",
      proposer: {
        providerId: "anthropic",
        modelId: "configured-production-model",
      },
    });
    expect(createAnthropicProposerFromEnv).toHaveBeenCalledOnce();
  });

  it("does not disguise production adapter failures as configuration errors", async () => {
    const sdkError = new Error("sdk unavailable");
    vi.mocked(createAnthropicProposerFromEnv).mockImplementation(() => {
      throw sdkError;
    });

    await expect(
      createDraft(
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
      ),
    ).rejects.toBe(sdkError);
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

  it("rejects a session-owned pending draft and blocks later approval and registration", async () => {
    const proposer = createStubProposer({
      fileCandidates: ({ sourceId }) => [
        {
          sourceId,
          path: "method.md",
          roleId: "method",
          rationale: "fixture",
        },
      ],
      contrast: {
        roles: [{ id: "method", description: "Observed method." }],
        bindingPoints: [],
      },
    });
    const created = await createAuthoringDraft(
      "session-one",
      {
        patternId: "rejected-method",
        name: "Rejected method",
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
      },
      proposer,
    );
    expect(created.status).toBe("drafted");
    if (created.status !== "drafted") return;
    const context = { params: Promise.resolve({ draftId: created.draftId }) };
    const request = () =>
      new NextRequest("http://localhost/api/authoring/drafts/id", {
        method: "POST",
        headers: { cookie: "uptake-session=session-one" },
      });

    const rejected = await rejectDraft(request(), context);
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ status: "rejected" });

    expect((await approveDraft(request(), context)).status).toBe(404);
    expect((await registerDraft(request(), context)).status).toBe(400);
  });
});
