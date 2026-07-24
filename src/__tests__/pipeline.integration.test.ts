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

import { loadCatalog } from "@/lib/catalog/load";
import { applyGenerated, hashTargetBase } from "@/lib/engine/apply";
import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import {
  executeVerification,
  prepareVerification,
} from "@/lib/engine/verify";
import {
  __resetApprovalStoreForTests,
  approveVerification,
  createApproval,
} from "@/services/approval-store";
import type { Pattern } from "@/types/pattern";

const temporaryRoots: string[] = [];
const fixturePatternPath = resolve(
  "catalog/spec-change-declaration-gate.json",
);
const seedFiles = [
  { path: "spec/change.md", role: "spec-artifact" },
  { path: "checks/spec-check.txt", role: "spec-check" },
  { path: "gates/blocking-gate.txt", role: "blocking-gate" },
] as const;

function commitFixtureRepository(root: string): string {
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
  return commitFixtureRepository(root);
}

function createFixtureCatalog(
  fixtureRoot: string,
): { catalogDir: string; sourceRoot: string } {
  const sourceRoot = resolve(fixtureRoot, "sources");
  const catalogDir = resolve(fixtureRoot, "catalog");
  const sourceFixtures = [
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
    sourceFixtures.map((source) => [
      source.id,
      createSeed(sourceRoot, source.repository),
    ]),
  );
  const actualPattern = JSON.parse(
    readFileSync(fixturePatternPath, "utf8"),
  ) as Pattern;
  const fixturePattern: Pattern = {
    ...actualPattern,
    sources: sourceFixtures.map((source) => ({
      ...source,
      revision: revisions.get(source.id) ?? "",
      stack: "fixture/non-target",
      isTargetStack: false,
      independenceNote: "Independent runtime fixture repository.",
    })),
    provenance: sourceFixtures.flatMap((source) =>
      seedFiles.map((file) => ({
        sourceId: source.id,
        path: file.path,
        observedRole: file.role,
      })),
    ),
  };
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(
    resolve(catalogDir, "spec-change-declaration-gate.json"),
    JSON.stringify(fixturePattern),
  );
  return { catalogDir, sourceRoot };
}

function createTarget(fixtureRoot: string): string {
  const root = resolve(fixtureRoot, "target");
  mkdirSync(root);
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({
      name: "uptake-pipeline-target",
      private: true,
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
  commitFixtureRepository(root);
  return root;
}

function gitStatus(root: string): string {
  return execFileSync("git", ["status", "--short", "--", "."], {
    cwd: root,
    encoding: "utf8",
  });
}

afterEach(() => {
  __resetApprovalStoreForTests();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("catalog to verification and apply pipeline", () => {
  it("runs real positive and negative vitest gates before approved apply", async () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), "uptake-pipeline-"));
    temporaryRoots.push(fixtureRoot);
    const { catalogDir, sourceRoot } = createFixtureCatalog(fixtureRoot);
    const catalog = loadCatalog(catalogDir, sourceRoot);
    const loaded = catalog.loaded.find(
      ({ pattern }) =>
        pattern.patternId === "spec-change-declaration-gate",
    );
    expect(loaded).toBeDefined();
    expect(loaded?.generationEnabled).toBe(true);
    if (loaded === undefined) {
      throw new Error("spec-change-declaration-gate was not loaded");
    }

    const targetRoot = createTarget(fixtureRoot);
    const bindings = detectBindings(loaded.pattern, targetRoot);
    expect(bindings.find(({ kind }) => kind === "checker")).toMatchObject({
      status: "detected",
      value: "vitest",
    });
    expect(bindings.find(({ kind }) => kind === "gate-location")).toMatchObject({
      status: "detected",
    });

    const generated = instantiate(loaded.pattern, bindings);
    expect(generated).toMatchObject({
      ok: true,
      gateTestId: "declared-change-present",
      files: [
        { path: "uptake-gate/declared-changes.ts" },
        { path: "uptake-gate/spec-gate.test.ts" },
      ],
    });
    if (!generated.ok) {
      throw new Error(`pipeline instantiation failed: ${generated.detail}`);
    }

    const beforeVerification = {
      baseHash: hashTargetBase(targetRoot),
      status: gitStatus(targetRoot),
    };
    const prepared = prepareVerification(
      loaded.pattern,
      generated,
      bindings,
      targetRoot,
    );
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") {
      throw new Error(`pipeline preparation failed: ${prepared.detail}`);
    }

    const verified = await executeVerification(prepared);
    expect(verified.status).toBe("awaiting-approval");
    expect({
      baseHash: hashTargetBase(targetRoot),
      status: gitStatus(targetRoot),
    }).toEqual(beforeVerification);
    expect(
      generated.files.every(({ path }) => !existsSync(resolve(targetRoot, path))),
    ).toBe(true);
    if (verified.status !== "awaiting-approval") {
      throw new Error(`pipeline verification failed: ${verified.detail}`);
    }

    const createVerifiedApproval = () => {
      const verificationId = createApproval({
        patternId: loaded.pattern.patternId,
        targetRepoRoot: targetRoot,
        contentHash: verified.contentHash,
        targetBaseHash: hashTargetBase(targetRoot),
        frozenArgv: verified.frozenArgv,
      });
      return verificationId;
    };
    const changedFiles = generated.files.map((file, index) =>
      index === 0 ? { ...file, content: `${file.content}\nchanged` } : file,
    );
    const changedVerificationId = createVerifiedApproval();
    expect(approveVerification(changedVerificationId)).toEqual({ ok: true });
    expect(
      applyGenerated(changedVerificationId, changedFiles, targetRoot),
    ).toMatchObject({ status: "diff-mismatch" });
    expect(
      generated.files.every(({ path }) => !existsSync(resolve(targetRoot, path))),
    ).toBe(true);

    const verificationId = createVerifiedApproval();
    expect(
      applyGenerated(verificationId, generated.files, targetRoot),
    ).toMatchObject({ status: "not-approved" });
    expect(
      generated.files.every(({ path }) => !existsSync(resolve(targetRoot, path))),
    ).toBe(true);

    expect(approveVerification(verificationId)).toEqual({ ok: true });
    expect(
      applyGenerated(verificationId, generated.files, targetRoot),
    ).toEqual({
      status: "completed",
      written: generated.files.map(({ path }) => path),
    });
    for (const file of generated.files) {
      expect(readFileSync(resolve(targetRoot, file.path), "utf8")).toBe(
        file.content,
      );
    }
  });
});
