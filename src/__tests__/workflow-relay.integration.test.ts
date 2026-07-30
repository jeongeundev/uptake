import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validatePatternValue } from "@/lib/catalog/load";
import type { AuthoringArtifact, SurveyArtifact } from "@/workflow/artifacts";

// This test proves the relay survives a process boundary: each CLI command
// below is a separate `tsx` child process, not an in-process function call.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");
const uptakeBin = resolve(repoRoot, "bin/uptake.ts");
// tsx resolves "@/*" path aliases against a tsconfig.json found by walking up
// from cwd, not from the entry script's location. Once cwd is outside this
// repository, that search never finds ours, so "@/..." imports fail to
// resolve. `--tsconfig` pins it explicitly regardless of cwd.
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
  if (!existsSync(resolve(root, ".git"))) {
    execFileSync("git", ["init", "-q"], { cwd: root });
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake Relay Test",
      "-c",
      "user.email=uptake-relay@example.test",
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

const surveyRepository = "fixtures/survey-source";
const validCandidateId = "repository-check-discipline";
const hallucinatedCandidateId = "hallucinated-discipline";

function createSurveySource(sourceRoot: string): string {
  const root = resolve(sourceRoot, surveyRepository);
  const files = [
    {
      path: "AGENTS.md",
      content:
        "# Development discipline\nRun the repository checks before merging.\n",
    },
    {
      path: "scripts/enforce.py",
      content: "print('enforce repository checks')\n",
    },
    {
      path: ".github/workflows/verify.yml",
      content: "name: verify\non: [push]\njobs: {}\n",
    },
  ];
  for (const file of files) {
    const path = resolve(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }
  return commitRepository(root, "fixture");
}

function writeStubScript(path: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      metadata: { providerId: "stub", modelId: "workflow-relay-e2e" },
      candidates: [
        {
          id: validCandidateId,
          name: "Repository check discipline",
          intent: "Keep repository changes aligned with documented checks.",
          discipline:
            "The repository documents checks, implements an enforcement script, and runs verification in CI.",
          tradeoffs:
            "The observed checks add maintenance cost and may have been inherited from a template.",
          evidence: [
            "AGENTS.md",
            "scripts/enforce.py",
            ".github/workflows/verify.yml",
          ],
          confidence: "high",
        },
        {
          id: hallucinatedCandidateId,
          name: "Hallucinated discipline",
          intent: "Claim a method without collected evidence.",
          discipline: "A missing file supposedly enforces a repository rule.",
          tradeoffs: "This claim has no collected evidence.",
          evidence: ["missing/not-collected.md"],
          confidence: "low",
        },
      ],
    }),
  );
}

const temporaryRoots: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryRoots.push(dir);
  return dir;
}

describe("workflow relay: init -> survey -> author across process boundaries", () => {
  let projectRoot: string;
  let sourceRoot: string;
  let env: NodeJS.ProcessEnv;
  let fixtureRevision: string;
  let repoCatalogSnapshot: string[];

  beforeAll(() => {
    repoCatalogSnapshot = readdirSync(resolve(repoRoot, "catalog")).sort();

    projectRoot = makeTempDir("uptake-relay-project-");
    sourceRoot = makeTempDir("uptake-relay-sources-");
    const stubDir = makeTempDir("uptake-relay-stub-");
    const stubScriptPath = resolve(stubDir, "survey-proposer-stub.json");
    writeStubScript(stubScriptPath);
    fixtureRevision = createSurveySource(sourceRoot);

    env = {
      ...process.env,
      UPTAKE_SOURCE_ROOT: sourceRoot,
      UPTAKE_PROPOSER: "stub",
      UPTAKE_SURVEY_PROPOSER_STUB_SCRIPT: stubScriptPath,
    };
  });

  afterAll(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "creates .uptake/METHOD.md idempotently, describing all five stages",
    () => {
      const first = runUptake(["init"], { cwd: projectRoot, env });
      expect(first.exitCode).toBe(0);

      const methodPath = resolve(projectRoot, ".uptake/METHOD.md");
      expect(existsSync(methodPath)).toBe(true);
      const contentAfterFirst = readFileSync(methodPath, "utf8");

      const second = runUptake(["init"], { cwd: projectRoot, env });
      expect(second.exitCode).toBe(0);
      expect(readFileSync(methodPath, "utf8")).toBe(contentAfterFirst);

      expect(contentAfterFirst).toContain(
        "init → survey → author → verify → apply",
      );
      expect(contentAfterFirst).toContain("다섯 단계가 모두 배포됐다.");
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "surveys the repository into a new run pinned to its HEAD revision",
    () => {
      const result = runUptake(["survey", surveyRepository], {
        cwd: projectRoot,
        env,
      });
      expect(result.exitCode).toBe(0);

      const runId = readFileSync(
        resolve(projectRoot, ".uptake/runs/current"),
        "utf8",
      ).trim();
      expect(runId).toBe("001-fixtures-survey-source");

      const survey = JSON.parse(
        readFileSync(
          resolve(projectRoot, ".uptake/runs", runId, "survey.json"),
          "utf8",
        ),
      ) as SurveyArtifact;
      if (survey.status !== "surveyed") {
        throw new Error(`expected survey to succeed, got: ${JSON.stringify(survey)}`);
      }
      expect(survey.revision).toBe(fixtureRevision);
      expect(survey.candidates.map((candidate) => candidate.id)).toContain(
        validCandidateId,
      );
      expect(
        survey.discardedCandidates.some(
          (candidate) => candidate.candidateId === hallucinatedCandidateId,
        ),
      ).toBe(true);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "authors from a second process, pinning the survey revision even though HEAD moved since",
    () => {
      // HEAD moves after survey but before author — ADR-021 says this must not fail the author step.
      commitRepository(
        (() => {
          const path = resolve(sourceRoot, surveyRepository, "README.md");
          writeFileSync(path, "# later change\n");
          return resolve(sourceRoot, surveyRepository);
        })(),
        "second commit after survey",
      );

      const result = runUptake(
        ["author", "--candidate", validCandidateId],
        { cwd: projectRoot, env },
      );
      expect(result.exitCode).toBe(0);

      const runId = readFileSync(
        resolve(projectRoot, ".uptake/runs/current"),
        "utf8",
      ).trim();
      const authoring = JSON.parse(
        readFileSync(
          resolve(projectRoot, ".uptake/runs", runId, "authoring.json"),
          "utf8",
        ),
      ) as AuthoringArtifact;
      if (authoring.status !== "drafted") {
        throw new Error(
          `expected author to succeed, got: ${JSON.stringify(authoring)}`,
        );
      }
      expect(authoring.pattern.sources[0]?.revision).toBe(fixtureRevision);

      // validatePatternValue enforces filename-basename === patternId (the
      // catalog/<patternId>.json convention), so re-validation must name the
      // file after the pattern's own id rather than the artifact's filename.
      const validation = validatePatternValue(
        authoring.pattern,
        `${authoring.pattern.patternId}.json`,
        sourceRoot,
      );
      expect(validation.ok).toBe(true);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "rejects author before survey and points at the missing step",
    () => {
      const freshProjectRoot = makeTempDir("uptake-relay-empty-project-");
      const result = runUptake(
        ["author", "--candidate", validCandidateId],
        { cwd: freshProjectRoot, env },
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("uptake survey");
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "exits 3 when the survey artifact on disk is corrupt",
    () => {
      const corruptProjectRoot = makeTempDir("uptake-relay-corrupt-project-");
      const surveyed = runUptake(["survey", surveyRepository], {
        cwd: corruptProjectRoot,
        env,
      });
      expect(surveyed.exitCode).toBe(0);

      const runsRoot = resolve(corruptProjectRoot, ".uptake", "runs");
      const runId = readFileSync(resolve(runsRoot, "current"), "utf8").trim();
      writeFileSync(resolve(runsRoot, runId, "survey.json"), "{ not json");

      const result = runUptake(["author", "--candidate", validCandidateId], {
        cwd: corruptProjectRoot,
        env,
      });

      // A corrupt artifact is an infrastructure error: neither "never ran" (2)
      // nor a gate failure (1). Without this the three-state model's third
      // branch is only covered by a mocked throw.
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain("survey.json");
    },
    CLI_TIMEOUT_MS,
  );

  it(
    "rejects commands that are not known, listing the available ones",
    () => {
      // All five commands are deployed as of this phase (apply is exercised
      // in its own suite — src/workflow/steps/apply.test.ts); only a
      // genuinely unknown command belongs here.
      const result = runUptake(["nonexistent"], { cwd: projectRoot, env });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("init");
      expect(result.stderr).toContain("survey");
      expect(result.stderr).toContain("author");
    },
    CLI_TIMEOUT_MS,
  );

  it("never registers anything in the catalog", () => {
    expect(existsSync(resolve(projectRoot, "catalog"))).toBe(false);
    expect(readdirSync(resolve(repoRoot, "catalog")).sort()).toEqual(
      repoCatalogSnapshot,
    );
  });
});
