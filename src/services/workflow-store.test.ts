import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { __resetApprovalStoreForTests } from "@/services/approval-store";
import {
  __resetWorkflowStoreForTests,
  applyWorkflow,
  approveWorkflow,
  createSession,
  createWorkflow,
  executeWorkflow,
  getCatalog,
  mergeWorkflowBindings,
  prepareWorkflow,
} from "@/services/workflow-store";
import type { Pattern } from "@/types/pattern";

const temporaryRoots: string[] = [];
const originalCatalogDir = process.env.UPTAKE_CATALOG_DIR;
const originalSourceRoot = process.env.UPTAKE_SOURCE_ROOT;
const fixturePatternPath = resolve(
  "catalog/spec-change-declaration-gate.json",
);
const seedFiles = [
  { path: "spec/change.md", role: "spec-artifact" },
  { path: "checks/spec-check.txt", role: "spec-check" },
  { path: "gates/blocking-gate.txt", role: "blocking-gate" },
] as const;

function commitRepository(root: string): string {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
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
    { cwd: root },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function createSeed(sourceRoot: string, repository: string): string {
  const root = resolve(sourceRoot, repository);
  for (const file of seedFiles) {
    const path = resolve(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${file.role}\n`);
  }
  return commitRepository(root);
}

function createFixtureCatalog(fixtureRoot: string): void {
  const sourceRoot = resolve(fixtureRoot, "sources");
  const catalogDir = resolve(fixtureRoot, "catalog");
  const sources = [
    {
      id: "seed-one",
      repository: "fixtures/seed-one",
      independenceGroup: "fixture-one",
    },
    {
      id: "seed-two",
      repository: "fixtures/seed-two",
      independenceGroup: "fixture-two",
    },
  ];
  const revisions = new Map(
    sources.map((source) => [
      source.id,
      createSeed(sourceRoot, source.repository),
    ]),
  );
  const pattern = JSON.parse(
    readFileSync(fixturePatternPath, "utf8"),
  ) as Pattern;
  const fixturePattern: Pattern = {
    ...pattern,
    sources: sources.map((source) => ({
      ...source,
      revision: revisions.get(source.id) ?? "",
      stack: "fixture/non-target",
      isTargetStack: false,
      independenceNote: "Independent runtime fixture repository.",
    })),
    provenance: sources.flatMap((source) =>
      seedFiles.map((file) => ({
        sourceId: source.id,
        path: file.path,
        observedRole: file.role,
      })),
    ),
  };
  mkdirSync(catalogDir);
  writeFileSync(
    resolve(catalogDir, `${fixturePattern.patternId}.json`),
    JSON.stringify(fixturePattern),
  );
  process.env.UPTAKE_CATALOG_DIR = catalogDir;
  process.env.UPTAKE_SOURCE_ROOT = sourceRoot;
}

function createTarget(fixtureRoot: string): string {
  const root = resolve(fixtureRoot, "target");
  mkdirSync(root);
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({
      name: "workflow-target",
      private: true,
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
  commitRepository(root);
  return root;
}

function setupFixture(): { targetRoot: string } {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "uptake-workflow-"));
  temporaryRoots.push(fixtureRoot);
  createFixtureCatalog(fixtureRoot);
  return { targetRoot: createTarget(fixtureRoot) };
}

afterEach(() => {
  __resetWorkflowStoreForTests();
  __resetApprovalStoreForTests();
  process.env.UPTAKE_CATALOG_DIR = originalCatalogDir;
  process.env.UPTAKE_SOURCE_ROOT = originalSourceRoot;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("workflow service boundary", () => {
  it("prepares without executing and keeps generated values server-side", () => {
    const { targetRoot } = setupFixture();
    const sessionId = createSession();
    const created = createWorkflow(
      sessionId,
      "spec-change-declaration-gate",
      targetRoot,
    );
    expect(created.status).toBe("bindings-ready");
    if (created.status !== "bindings-ready") {
      throw new Error(created.detail);
    }

    const prepared = prepareWorkflow(sessionId, created.workflowId);
    expect(prepared).toMatchObject({
      status: "prepared",
      cwd: "temporary workspace outside the target repository",
      files: [
        { operation: "add", path: "uptake-gate/declared-changes.ts" },
        { operation: "add", path: "uptake-gate/spec-gate.test.ts" },
      ],
    });
    expect(prepared).toHaveProperty("frozenArgv");
    expect(prepared).toHaveProperty("timeoutMs");
    expect(prepared).not.toHaveProperty("verificationId");
    expect(existsSync(resolve(targetRoot, "uptake-gate"))).toBe(false);
  });

  it("treats another session as an unknown workflow at every mutation", async () => {
    const { targetRoot } = setupFixture();
    const owner = createSession();
    const intruder = createSession();
    const created = createWorkflow(
      owner,
      "spec-change-declaration-gate",
      targetRoot,
    );
    if (created.status !== "bindings-ready") {
      throw new Error(created.detail);
    }

    expect(
      mergeWorkflowBindings(intruder, created.workflowId, {
        "spec-format": "markdown",
      }),
    ).toMatchObject({ status: "workflow-not-found" });
    expect(prepareWorkflow(intruder, created.workflowId)).toMatchObject({
      status: "workflow-not-found",
    });
    expect(await executeWorkflow(intruder, created.workflowId)).toMatchObject({
      status: "workflow-not-found",
    });
    expect(approveWorkflow(intruder, created.workflowId)).toMatchObject({
      status: "workflow-not-found",
    });
    expect(applyWorkflow(intruder, created.workflowId)).toMatchObject({
      status: "workflow-not-found",
    });
    expect(existsSync(resolve(targetRoot, "uptake-gate"))).toBe(false);
  });

  it("requires approval, rejects forged and reused workflows, then applies server files", async () => {
    const { targetRoot } = setupFixture();
    const sessionId = createSession();
    const created = createWorkflow(
      sessionId,
      "spec-change-declaration-gate",
      targetRoot,
    );
    if (created.status !== "bindings-ready") {
      throw new Error(created.detail);
    }
    expect(prepareWorkflow(sessionId, created.workflowId).status).toBe(
      "prepared",
    );
    const executed = await executeWorkflow(sessionId, created.workflowId);
    expect(executed.status).toBe("awaiting-approval");

    expect(applyWorkflow(sessionId, created.workflowId)).toMatchObject({
      status: "not-approved",
    });
    expect(applyWorkflow(sessionId, "forged-workflow")).toMatchObject({
      status: "workflow-not-found",
    });
    expect(existsSync(resolve(targetRoot, "uptake-gate"))).toBe(false);

    expect(approveWorkflow(sessionId, created.workflowId)).toEqual({
      status: "approved",
    });
    expect(applyWorkflow(sessionId, created.workflowId)).toMatchObject({
      status: "completed",
    });
    expect(
      readFileSync(
        resolve(targetRoot, "uptake-gate/declared-changes.ts"),
        "utf8",
      ),
    ).toContain("patternId=spec-change-declaration-gate");
    expect(applyWorkflow(sessionId, created.workflowId)).toMatchObject({
      status: "not-approved",
    });
  });

  it("invalidates prepared and approval state when user bindings change", async () => {
    const { targetRoot } = setupFixture();
    const sessionId = createSession();
    const created = createWorkflow(
      sessionId,
      "spec-change-declaration-gate",
      targetRoot,
    );
    if (created.status !== "bindings-ready") {
      throw new Error(created.detail);
    }
    prepareWorkflow(sessionId, created.workflowId);
    expect((await executeWorkflow(sessionId, created.workflowId)).status).toBe(
      "awaiting-approval",
    );

    expect(
      mergeWorkflowBindings(sessionId, created.workflowId, {
        "spec-format": "markdown",
      }),
    ).toMatchObject({ status: "bindings-ready" });
    expect(approveWorkflow(sessionId, created.workflowId)).toMatchObject({
      status: "not-verified",
    });
    expect(applyWorkflow(sessionId, created.workflowId)).toMatchObject({
      status: "not-approved",
    });
  });

  it("returns provenance rejection when the configured source root is absent", () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), "uptake-workflow-"));
    temporaryRoots.push(fixtureRoot);
    process.env.UPTAKE_CATALOG_DIR = resolve("catalog");
    process.env.UPTAKE_SOURCE_ROOT = resolve(fixtureRoot, "missing-sources");

    const catalog = getCatalog();
    expect(catalog.loaded).toEqual([]);
    expect(catalog.rejected).toContainEqual(
      expect.objectContaining({ reason: "provenance-unresolved" }),
    );
  });
});
