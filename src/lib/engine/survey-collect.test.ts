import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CompiledSurveyRules } from "@/types/survey";

import { collectSignalFiles } from "./survey-collect";

const fixtureRoots: string[] = [];

function createSourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "uptake-survey-collect-"));
  fixtureRoots.push(root);
  return root;
}

function createRepository(
  sourceRoot: string,
  repository: string,
  files: Record<string, string>,
): string {
  const repositoryRoot = join(sourceRoot, repository);
  mkdirSync(repositoryRoot, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(repositoryRoot, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
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
    { cwd: repositoryRoot },
  );
  return repositoryRoot;
}

function rules(
  entries: { id: string; include: RegExp[] }[],
  budget = { perFileChars: 100, totalChars: 1_000 },
  exclude: RegExp[] = [],
): CompiledSurveyRules {
  return { budget, exclude, rules: entries };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectSignalFiles", () => {
  it("collects matching files and pins a 40-character revision", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "docs/method.md": "method\n",
      "scripts/check.ts": "check\n",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules([
        { id: "automation", include: [/^scripts\//] },
        { id: "docs", include: [/^docs\//] },
      ]),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [
        {
          path: "scripts/check.ts",
          ruleId: "automation",
          content: "check\n",
          truncated: false,
        },
        {
          path: "docs/method.md",
          ruleId: "docs",
          content: "method\n",
          truncated: false,
        },
      ],
      skipped: [],
    });
    if (result.ok) {
      expect(result.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("reads committed content instead of the working tree", () => {
    const sourceRoot = createSourceRoot();
    const repositoryRoot = createRepository(
      sourceRoot,
      "github.com/example/source",
      { "docs/method.md": "committed\n" },
    );
    writeFileSync(join(repositoryRoot, "docs/method.md"), "working tree\n");

    const result = collectSignalFiles(
      "github.com/example/source",
      rules([{ id: "docs", include: [/^docs\//] }]),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [{ content: "committed\n" }],
    });
  });

  it("round-robins rule queues so one category cannot exhaust the budget", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "a/one.txt": "1111",
      "a/two.txt": "2222",
      "b/only.txt": "bbbb",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules(
        [
          { id: "a", include: [/^a\//] },
          { id: "b", include: [/^b\//] },
        ],
        { perFileChars: 4, totalChars: 8 },
      ),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [
        { path: "a/one.txt", ruleId: "a" },
        { path: "b/only.txt", ruleId: "b" },
      ],
      skipped: [
        { path: "a/two.txt", ruleId: "a", reason: "budget-exhausted" },
      ],
    });
  });

  it("continues after a budget-exhausted file", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "docs/a-seed.md": "aa",
      "docs/b-large.md": "xxxxxxxxxx",
      "docs/c-small.md": "bbb",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules(
        [{ id: "docs", include: [/^docs\//] }],
        { perFileChars: 4, totalChars: 5 },
      ),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [
        { path: "docs/a-seed.md" },
        { path: "docs/c-small.md" },
      ],
      skipped: [
        {
          path: "docs/b-large.md",
          ruleId: "docs",
          reason: "budget-exhausted",
        },
      ],
    });
  });

  it("truncates content at the per-file budget", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "docs/large.md": "abcdefgh",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules(
        [{ id: "docs", include: [/^docs\//] }],
        { perFileChars: 4, totalChars: 10 },
      ),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [{ content: "abcd", truncated: true }],
    });
  });

  it("excludes matching paths and ignores unmatched paths", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "docs/keep.md": "keep",
      "docs/fixtures/drop.md": "drop",
      "src/unmatched.ts": "ignore",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules(
        [{ id: "docs", include: [/^docs\//] }],
        undefined,
        [/(^|\/)fixtures\//],
      ),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [{ path: "docs/keep.md" }],
    });
    if (result.ok) {
      expect(result.files).toHaveLength(1);
    }
  });

  it("assigns a path only to the first matching rule", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "docs/method.md": "method",
    });

    const result = collectSignalFiles(
      "github.com/example/source",
      rules([
        { id: "first", include: [/method\.md$/] },
        { id: "second", include: [/^docs\//] },
      ]),
      sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      files: [{ path: "docs/method.md", ruleId: "first" }],
    });
  });

  it("returns files in the same order on repeated collection", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "a/two.txt": "two",
      "b/one.txt": "one",
      "a/one.txt": "one",
    });
    const compiled = rules([
      { id: "a", include: [/^a\//] },
      { id: "b", include: [/^b\//] },
    ]);

    const first = collectSignalFiles(
      "github.com/example/source",
      compiled,
      sourceRoot,
    );
    const second = collectSignalFiles(
      "github.com/example/source",
      compiled,
      sourceRoot,
    );

    expect(second).toEqual(first);
  });

  it("rejects repositories outside the source root", () => {
    const sourceRoot = createSourceRoot();

    expect(
      collectSignalFiles(
        "../outside",
        rules([{ id: "docs", include: [/^docs\//] }]),
        sourceRoot,
      ),
    ).toMatchObject({
      ok: false,
      reason: "repository-unresolved",
    });
  });

  it("reports no-signal when no committed file matches a rule", () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "src/index.ts": "export {}",
    });

    expect(
      collectSignalFiles(
        "github.com/example/source",
        rules([{ id: "docs", include: [/^docs\//] }]),
        sourceRoot,
      ),
    ).toMatchObject({
      ok: false,
      reason: "no-signal",
    });
  });
});
