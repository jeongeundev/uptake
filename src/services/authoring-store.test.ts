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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStubProposer } from "@/services/proposer-stub";
import type { AuthoringRequest } from "@/types/authoring";

vi.mock("@/lib/engine/self-verify", () => ({
  selfVerifyOracle: vi.fn(async () => ({
    ok: false,
    status: "negative-not-caught",
    detail: "fixture oracle did not catch the violation",
  })),
}));

import {
  __resetAuthoringStoreForTests,
  approveAuthoringDraft,
  createAuthoringDraft,
  rejectAuthoringDraft,
  registerAuthoringDraft,
} from "./authoring-store";

let root: string;
let sourceRoot: string;
let catalogDir: string;

function createRepository(repository: string): void {
  const path = join(sourceRoot, repository);
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

function request(
  overrides: Partial<AuthoringRequest> = {},
): AuthoringRequest {
  return {
    patternId: "authored-method",
    name: "Authored method",
    intent: "Observe a repository method.",
    capability: "descriptive",
    evidenceStatus: "corroborated",
    sources: [
      {
        id: "one",
        repository: "example/one",
        stack: "php/pest",
        isTargetStack: false,
        independenceGroup: "one",
        independenceNote: "Independent fixture one.",
      },
      {
        id: "two",
        repository: "example/two",
        stack: "typescript/vitest",
        isTargetStack: true,
        independenceGroup: "two",
        independenceNote: "Independent fixture two.",
      },
    ],
    ...overrides,
  };
}

function proposer(capability: AuthoringRequest["capability"] = "descriptive") {
  const roleIds =
    capability === "generative"
      ? ["spec-artifact", "spec-check", "blocking-gate"]
      : ["method"];
  return createStubProposer({
    metadata: { providerId: "test-provider", modelId: "test-model" },
    fileCandidates: ({ sourceId }) =>
      roleIds.map((roleId) => ({
        sourceId,
        path: "method.md",
        roleId,
        rationale: "fixture",
      })),
    contrast: {
      roles: roleIds.map((id) => ({ id, description: `${id} role` })),
      bindingPoints: [],
    },
    narrative: {
      violation: "The declared change is absent.",
      tradeoffs: "Observed in successful repositories.",
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-authoring-store-"));
  sourceRoot = join(root, "sources");
  catalogDir = join(root, "catalog");
  mkdirSync(sourceRoot);
  mkdirSync(catalogDir);
  createRepository("example/one");
  createRepository("example/two");
  process.env.UPTAKE_SOURCE_ROOT = sourceRoot;
  process.env.UPTAKE_CATALOG_DIR = catalogDir;
  __resetAuthoringStoreForTests();
});

afterEach(() => {
  delete process.env.UPTAKE_SOURCE_ROOT;
  delete process.env.UPTAKE_CATALOG_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("authoring store", () => {
  it("creates a descriptive draft without self-verification", async () => {
    const result = await createAuthoringDraft(
      "session-one",
      request(),
      proposer(),
    );

    expect(result).toMatchObject({
      status: "drafted",
      selfVerify: { status: "skipped", reason: "descriptive" },
      proposer: { providerId: "test-provider", modelId: "test-model" },
    });
    expect(readdirSync(catalogDir)).toEqual([]);
  });

  it("does not save or write a generative draft when self-verification fails", async () => {
    const result = await createAuthoringDraft(
      "session-one",
      request({ capability: "generative" }),
      proposer("generative"),
    );

    expect(result).toMatchObject({ status: "self-verify-failed" });
    expect(result).not.toHaveProperty("draftId");
    expect(readdirSync(catalogDir)).toEqual([]);
  });

  it("requires approval, consumes registration once, and protects session ownership", async () => {
    const created = await createAuthoringDraft(
      "session-one",
      request(),
      proposer(),
    );
    expect(created.status).toBe("drafted");
    if (created.status !== "drafted") return;

    expect(
      registerAuthoringDraft("session-one", created.draftId),
    ).toMatchObject({ status: "not-approved" });
    expect(
      approveAuthoringDraft("session-two", created.draftId),
    ).toMatchObject({ status: "draft-not-found" });
    expect(
      registerAuthoringDraft("session-two", created.draftId),
    ).toMatchObject({ status: "draft-not-found" });

    expect(
      approveAuthoringDraft("session-one", created.draftId),
    ).toEqual({ status: "approved" });
    expect(
      registerAuthoringDraft("session-one", created.draftId),
    ).toMatchObject({ status: "registered" });
    expect(
      registerAuthoringDraft("session-one", created.draftId),
    ).toMatchObject({ status: "not-approved" });
  });

  it("rejects a pending draft and blocks its approval and registration", async () => {
    const created = await createAuthoringDraft(
      "session-one",
      request(),
      proposer(),
    );
    expect(created.status).toBe("drafted");
    if (created.status !== "drafted") return;

    expect(
      rejectAuthoringDraft("session-two", created.draftId),
    ).toMatchObject({ status: "draft-not-found" });
    expect(
      rejectAuthoringDraft("session-one", created.draftId),
    ).toEqual({ status: "rejected" });
    expect(
      approveAuthoringDraft("session-one", created.draftId),
    ).toMatchObject({ status: "draft-not-found" });
    expect(
      registerAuthoringDraft("session-one", created.draftId),
    ).toMatchObject({ status: "not-approved" });
  });
});
