import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import type { AuthoringRequest } from "@/types/authoring";

vi.mock("@/services/proposer-anthropic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/proposer-anthropic")>();
  return { ...actual, createAnthropicProposerFromEnv: vi.fn() };
});

let root: string;
let catalogDir: string;

function authoringRequest(
  overrides: Partial<AuthoringRequest> = {},
): AuthoringRequest {
  return {
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
    ...overrides,
  };
}

function draftActionRequest(
  cookie: string,
  request: AuthoringRequest,
): NextRequest {
  return new NextRequest("http://localhost/api/authoring/drafts/id", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ request }),
  });
}

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
  catalogDir = join(root, "catalog");
  mkdirSync(sourceRoot);
  mkdirSync(catalogDir);
  createRepository(sourceRoot);
  process.env.UPTAKE_SOURCE_ROOT = sourceRoot;
  process.env.UPTAKE_CATALOG_DIR = catalogDir;
  __resetAuthoringStoreForTests();
});

afterEach(() => {
  __setAuthoringProposerForTests(undefined);
  vi.mocked(createAnthropicProposerFromEnv).mockReset();
  delete process.env.UPTAKE_SOURCE_ROOT;
  delete process.env.UPTAKE_CATALOG_DIR;
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
        body: JSON.stringify({ request: authoringRequest() }),
      }),
      { params: Promise.resolve({ draftId: "unknown" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      status: "draft-not-found",
    });
  });

  it.each([
    ["approve", approveDraft],
    ["register", registerDraft],
  ])("requires an exact request body for %s", async (_name, handler) => {
    const context = { params: Promise.resolve({ draftId: "unknown" }) };
    for (const body of [
      undefined,
      {},
      { request: authoringRequest(), extra: true },
      { request: { ...authoringRequest(), intent: "" } },
    ]) {
      const response = await handler(
        new NextRequest("http://localhost/api/authoring/drafts/id", {
          method: "POST",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        context,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        status: "invalid-request",
      });
    }
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
      draftActionRequest(
        "uptake-session=session-one",
        authoringRequest({
          patternId: "rejected-method",
          name: "Rejected method",
        }),
      );

    const rejected = await rejectDraft(request(), context);
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ status: "rejected" });

    expect((await approveDraft(request(), context)).status).toBe(404);
    expect((await registerDraft(request(), context)).status).toBe(400);
  });

  it("blocks direct approval and registration of a prior draft after a new draft POST", async () => {
    __setAuthoringProposerForTests(
      createStubProposer({
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
      }),
    );
    const body = (patternId: string) =>
      JSON.stringify({
        patternId,
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
      });
    const first = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        body: body("first-method"),
      }),
    );
    const firstResult = await first.json();
    const cookie = first.headers.get("set-cookie");
    expect(firstResult.status).toBe("drafted");
    expect(cookie).toBeTruthy();

    const second = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        headers: { cookie: cookie ?? "" },
        body: body("second-method"),
      }),
    );
    expect(second.status).toBe(200);

    const context = {
      params: Promise.resolve({ draftId: firstResult.draftId as string }),
    };
    const oldDraftRequest = () =>
      draftActionRequest(
        cookie ?? "",
        authoringRequest({ patternId: "first-method" }),
      );
    expect((await approveDraft(oldDraftRequest(), context)).status).toBe(404);
    expect((await registerDraft(oldDraftRequest(), context)).status).toBe(400);
  });

  it("rejects stale input without a replacement draft POST and preserves the catalog", async () => {
    __setAuthoringProposerForTests(
      createStubProposer({
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
      }),
    );
    const original = authoringRequest();
    const changed = authoringRequest({ intent: "Changed current input" });
    const createdResponse = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        body: JSON.stringify(original),
      }),
    );
    const created = await createdResponse.json();
    const cookie = createdResponse.headers.get("set-cookie") ?? "";
    const context = {
      params: Promise.resolve({ draftId: created.draftId as string }),
    };

    const staleApproval = await approveDraft(
      draftActionRequest(cookie, changed),
      context,
    );
    expect(staleApproval.status).toBe(400);
    expect(await staleApproval.json()).toMatchObject({
      status: "stale-input",
    });

    const before = readdirSync(catalogDir);
    const staleRegistration = await registerDraft(
      draftActionRequest(cookie, changed),
      context,
    );
    expect(staleRegistration.status).toBe(400);
    expect(await staleRegistration.json()).toMatchObject({
      status: "stale-input",
    });
    expect(readdirSync(catalogDir)).toEqual(before);

    const approval = await approveDraft(
      draftActionRequest(cookie, original),
      context,
    );
    expect(approval.status).toBe(200);
    expect(await approval.json()).toEqual({ status: "approved" });
  });

  it("treats source order changes as stale input", async () => {
    __setAuthoringProposerForTests(
      createStubProposer({
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
      }),
    );
    const secondSource = {
      ...authoringRequest().sources[0],
      id: "two",
      independenceGroup: "two",
    };
    const original = authoringRequest({
      evidenceStatus: "corroborated",
      sources: [authoringRequest().sources[0], secondSource],
    });
    const createdResponse = await createDraft(
      new NextRequest("http://localhost/api/authoring/drafts", {
        method: "POST",
        body: JSON.stringify(original),
      }),
    );
    const created = await createdResponse.json();
    const context = {
      params: Promise.resolve({ draftId: created.draftId as string }),
    };
    const response = await approveDraft(
      draftActionRequest(
        createdResponse.headers.get("set-cookie") ?? "",
        { ...original, sources: [...original.sources].reverse() },
      ),
      context,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "stale-input" });
  });
});
