import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Pattern } from "@/types/pattern";
import {
  readApplyArtifact,
  readGeneratedArtifact,
  readVerifyArtifact,
  runLogPath,
  writeAuthoringArtifact,
} from "@/workflow/artifacts";
import { createRun, runDir, writeCurrentRun } from "@/workflow/paths";
import { runApplyCommand } from "@/workflow/steps/apply";

// This suite proves the second half of the relay: a `generative`/
// `corroborated` pattern in authoring.json actually runs the real gate
// (positive green + negative red) via `verify`, and `apply` writes the
// verified files with its two reapply defenses intact. Steps 1-2 below run
// the CLI as a separate `tsx` child process (same as
// workflow-relay.integration.test.ts) to prove the process boundary and to
// exercise step 0's install-location vitest path resolution outside this
// repository. Steps 3-6 call `runApplyCommand` in-process with an injected
// `confirm` port instead: there is no automated-approval flag to script
// against (ADR-022 deliberately has none), and faking a TTY to drive the CLI
// would not test anything `runApplyCommand`'s own port doesn't already cover.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const uptakeBin = resolve(repoRoot, "bin/uptake.ts");
const repoTsconfig = resolve(repoRoot, "tsconfig.json");

const CLI_TIMEOUT_MS = 30_000;

type CliRunResult = { exitCode: number; stdout: string; stderr: string };

function isExecFileError(
  error: unknown,
): error is { status: number | null; stdout?: string; stderr?: string } {
  return typeof error === "object" && error !== null && "status" in error;
}

function runUptake(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): CliRunResult {
  try {
    const stdout = execFileSync(
      tsxBin,
      ["--tsconfig", repoTsconfig, uptakeBin, ...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        timeout: CLI_TIMEOUT_MS,
      },
    );
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    if (!isExecFileError(error) || error.status === null || error.status === undefined) {
      throw error;
    }
    return {
      exitCode: error.status,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function commitRepository(root: string, message: string): string {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake Verify Apply Test",
      "-c",
      "user.email=uptake-verify-apply@example.test",
      "commit",
      "-q",
      "-m",
      message,
    ],
    { cwd: root },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

// Mirrors the pattern's own three roles so each source supports all of them
// — two independent groups per role is what AC-2b (role-evidence-invalid)
// requires for a `corroborated` pattern.
const sourceFiles = [
  { path: "changes/12359.feature.md", role: "spec-artifact" },
  { path: ".github/workflows/timeline-check.yml", role: "spec-check" },
  { path: "gates/blocking-gate.py", role: "blocking-gate" },
] as const;

function createEvidenceSource(sourceRoot: string, repository: string): string {
  const root = resolve(sourceRoot, repository);
  for (const file of sourceFiles) {
    const filePath = resolve(root, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `# ${file.role} fixture\n`);
  }
  return commitRepository(root, "fixture");
}

// Swaps only sources/provenance on the real seed pattern, keeping its
// oracle/roles/bindingPoints untouched — this is what makes the gate run for
// real rather than against an invented oracle (ADR-008: a generator cannot
// author its own oracle).
function buildFixturePattern(sourceRoot: string): Pattern {
  const seed = JSON.parse(
    readFileSync(
      resolve(repoRoot, "catalog/spec-change-declaration-gate.json"),
      "utf8",
    ),
  ) as Pattern;

  const sourceOneRepository = "fixtures/verify-apply-one";
  const sourceTwoRepository = "fixtures/verify-apply-two";
  const revisionOne = createEvidenceSource(sourceRoot, sourceOneRepository);
  const revisionTwo = createEvidenceSource(sourceRoot, sourceTwoRepository);

  const sources: Pattern["sources"] = [
    {
      id: "verify-apply-one",
      repository: sourceOneRepository,
      revision: revisionOne,
      stack: "python/pytest",
      isTargetStack: false,
      independenceGroup: "verify-apply-one",
      independenceNote:
        "Independent fixture repository one for the verify+apply relay test.",
    },
    {
      id: "verify-apply-two",
      repository: sourceTwoRepository,
      revision: revisionTwo,
      stack: "python/pytest",
      isTargetStack: false,
      independenceGroup: "verify-apply-two",
      independenceNote:
        "Independent fixture repository two for the verify+apply relay test.",
    },
  ];

  return {
    ...seed,
    sources,
    provenance: sources.flatMap((source) =>
      sourceFiles.map((file) => ({
        sourceId: source.id,
        path: file.path,
        observedRole: file.role,
      })),
    ),
  };
}

// `tests/fixtures/target-vitest`'s vitest.config.ts pins `include` to
// `src/**/*.test.ts`, which excludes the generated gate at
// `uptake-gate/spec-gate.test.ts` (verified empirically: vitest reports zero
// test results and the run collapses to `gate-error`). Proving the real gate
// runs — the point of this suite — needs a target without that restriction,
// matching what `e2e/fixtures.config.ts` and `verify.test.ts`'s
// `createExecutableTarget` already build: a package.json declaring vitest
// with no vitest.config.ts, so default discovery covers the generated path.
function createExecutableTarget(): string {
  const path = mkdtempSync(resolve(tmpdir(), "uptake-verify-apply-target-"));
  writeFileSync(
    resolve(path, "package.json"),
    JSON.stringify({
      name: "uptake-verify-apply-target",
      private: true,
      devDependencies: { vitest: "^3.2.4" },
    }),
  );
  commitRepository(path, "fixture target");
  return path;
}

function setUpAuthoringRun(projectRoot: string, pattern: Pattern): string {
  const runId = createRun("fixtures/verify-apply", projectRoot);
  writeCurrentRun(runId, projectRoot);
  writeAuthoringArtifact(
    runId,
    {
      status: "drafted",
      candidateId: pattern.patternId,
      pattern,
      discarded: [],
      targetStackFacts: [],
    },
    projectRoot,
  );
  return runId;
}

const temporaryRoots: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryRoots.push(dir);
  return dir;
}

describe("workflow verify+apply: a generative/corroborated pattern runs the real gate and applies", () => {
  let projectRoot: string;
  let sourceRoot: string;
  let targetRoot: string;
  let env: NodeJS.ProcessEnv;
  let pattern: Pattern;
  let runId: string;
  let repoCatalogSnapshot: string[];

  beforeAll(() => {
    repoCatalogSnapshot = readdirSync(resolve(repoRoot, "catalog")).sort();

    projectRoot = makeTempDir("uptake-verify-apply-project-");
    sourceRoot = makeTempDir("uptake-verify-apply-sources-");
    targetRoot = createExecutableTarget();
    temporaryRoots.push(targetRoot);

    pattern = buildFixturePattern(sourceRoot);
    runId = setUpAuthoringRun(projectRoot, pattern);

    env = { ...process.env, UPTAKE_SOURCE_ROOT: sourceRoot };
  });

  afterAll(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "verifies the pattern end-to-end against a target outside this repository",
    () => {
      const result = runUptake(["verify", "--target", targetRoot], {
        cwd: projectRoot,
        env,
      });
      expect(result.exitCode).toBe(0);

      const verify = readVerifyArtifact(runId, projectRoot);
      if (verify?.status !== "verified") {
        throw new Error(`expected verified, got ${JSON.stringify(verify)}`);
      }
      expect(verify.verificationId.length).toBeGreaterThan(0);
      expect(verify.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(verify.bindingsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(verify.targetBaseHash).toMatch(/^[0-9a-f]{64}$/);
      expect(verify.frozenArgv.length).toBeGreaterThan(0);
      expect(verify.gateTestId).toBe("declared-change-present");

      const generated = readGeneratedArtifact(runId, projectRoot);
      expect(generated?.files.map((file) => file.path).sort()).toEqual([
        "uptake-gate/declared-changes.ts",
        "uptake-gate/spec-gate.test.ts",
      ]);

      expect(existsSync(runLogPath(runId, "positive", projectRoot))).toBe(
        true,
      );
      expect(existsSync(runLogPath(runId, "negative", projectRoot))).toBe(
        true,
      );

      // AC-5: the target repository itself is untouched by verification —
      // generation only ever happened inside disposable workspaces.
      expect(existsSync(resolve(targetRoot, "uptake-gate"))).toBe(false);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "refuses to apply from a non-interactive process",
    () => {
      // execFileSync gives the child a piped (non-TTY) stdin, so the CLI's
      // TTY guard (ADR-022) trips before any approval prompt could run.
      const result = runUptake(["apply"], { cwd: projectRoot, env });

      expect(result.exitCode).toBe(2);
      expect(readApplyArtifact(runId, projectRoot)).toBeUndefined();
    },
    CLI_TIMEOUT_MS,
  );

  it("declining the in-process approval prompt writes nothing", async () => {
    const result = await runApplyCommand({
      confirm: async () => false,
      root: projectRoot,
    });

    expect(result.exitCode).toBe(2);
    expect(readApplyArtifact(runId, projectRoot)).toBeUndefined();
    expect(
      existsSync(resolve(targetRoot, "uptake-gate/declared-changes.ts")),
    ).toBe(false);
  });

  it("approving the in-process prompt applies the verified files", async () => {
    const result = await runApplyCommand({
      confirm: async () => true,
      root: projectRoot,
    });

    expect(result.exitCode).toBe(0);
    const applied = readApplyArtifact(runId, projectRoot);
    if (applied?.status !== "applied") {
      throw new Error(`expected applied, got ${JSON.stringify(applied)}`);
    }
    expect(applied.written.sort()).toEqual([
      "uptake-gate/declared-changes.ts",
      "uptake-gate/spec-gate.test.ts",
    ]);

    const generated = readGeneratedArtifact(runId, projectRoot);
    for (const file of generated?.files ?? []) {
      expect(readFileSync(resolve(targetRoot, file.path), "utf8")).toBe(
        file.content,
      );
    }
  });

  it(
    "blocks reapplying the same verification without prompting again (ADR-022 consumption seal)",
    async () => {
      const confirmSpy = vi.fn(async () => true);
      const result = await runApplyCommand({ confirm: confirmSpy, root: projectRoot });

      expect(result.exitCode).toBe(2);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(readApplyArtifact(runId, projectRoot)).toMatchObject({
        status: "applied",
      });
    },
  );

  it(
    "reports base-changed if apply.json is removed and the target was already applied",
    async () => {
      unlinkSync(resolve(runDir(runId, projectRoot), "apply.json"));

      const result = await runApplyCommand({
        confirm: async () => true,
        root: projectRoot,
      });

      expect(result.exitCode).toBe(1);
      expect(readApplyArtifact(runId, projectRoot)).toMatchObject({
        status: "base-changed",
      });

      const generated = readGeneratedArtifact(runId, projectRoot);
      for (const file of generated?.files ?? []) {
        expect(readFileSync(resolve(targetRoot, file.path), "utf8")).toBe(
          file.content,
        );
      }
    },
  );

  it("never touches the repository's seed catalog", () => {
    expect(readdirSync(resolve(repoRoot, "catalog")).sort()).toEqual(
      repoCatalogSnapshot,
    );
  });
});
