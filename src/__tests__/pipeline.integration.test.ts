import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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

const sourceRoot = resolve(".uptake/sources");
const seedRepositories = [
  resolve(sourceRoot, "github.com/lablup/backend.ai"),
  resolve(sourceRoot, "github.com/pytest-dev/pytest"),
];
const seedsAvailable = seedRepositories.every(existsSync);
const temporaryRoots: string[] = [];

if (!seedsAvailable) {
  console.warn(
    `[pipeline integration] skipped: required seed repositories are absent under ${sourceRoot}`,
  );
}

function createTarget(): string {
  const root = mkdtempSync(resolve(tmpdir(), "uptake-pipeline-"));
  temporaryRoots.push(root);
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({
      name: "uptake-pipeline-target",
      private: true,
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
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

const describeWithSeeds = seedsAvailable ? describe : describe.skip;

describeWithSeeds("catalog to verification and apply pipeline", () => {
  it("runs real positive and negative vitest gates before approved apply", async () => {
    const catalog = loadCatalog(resolve("catalog"), sourceRoot);
    const loaded = catalog.loaded.find(
      ({ pattern }) =>
        pattern.patternId === "spec-change-declaration-gate",
    );
    expect(loaded).toBeDefined();
    expect(loaded?.generationEnabled).toBe(true);
    if (loaded === undefined) {
      throw new Error("spec-change-declaration-gate was not loaded");
    }

    const targetRoot = createTarget();
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
      expect(approveVerification(verificationId)).toEqual({ ok: true });
      return verificationId;
    };
    const changedFiles = generated.files.map((file, index) =>
      index === 0 ? { ...file, content: `${file.content}\nchanged` } : file,
    );
    expect(
      applyGenerated(createVerifiedApproval(), changedFiles, targetRoot),
    ).toMatchObject({ status: "diff-mismatch" });
    expect(
      generated.files.every(({ path }) => !existsSync(resolve(targetRoot, path))),
    ).toBe(true);

    expect(
      applyGenerated(createVerifiedApproval(), generated.files, targetRoot),
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
