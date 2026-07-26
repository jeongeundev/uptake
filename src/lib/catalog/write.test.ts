import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCatalog } from "@/lib/catalog/load";
import { registerPattern } from "@/lib/catalog/write";
import type { Pattern, Source } from "@/types/pattern";

let root: string;
let catalogDir: string;
let sourceRoot: string;
let pattern: Pattern;

function commitSource(repository: string): string {
  const repositoryPath = join(sourceRoot, repository);
  mkdirSync(repositoryPath, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repositoryPath });
  writeFileSync(join(repositoryPath, "method.md"), "method\n");
  execFileSync("git", ["add", "."], { cwd: repositoryPath });
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
    { cwd: repositoryPath },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function entries(): string[] {
  return readdirSync(catalogDir).sort();
}

function stagingEntries(): string[] {
  return entries().filter((entry) => entry.startsWith(".staging-"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-catalog-write-"));
  catalogDir = join(root, "catalog");
  sourceRoot = join(root, "sources");
  mkdirSync(catalogDir);
  mkdirSync(sourceRoot);
  const sources: Source[] = [
    {
      id: "one",
      repository: "example/one",
      revision: commitSource("example/one"),
      stack: "typescript/vitest",
      isTargetStack: true,
      independenceGroup: "one",
      independenceNote: "Independent fixture one.",
    },
    {
      id: "two",
      repository: "example/two",
      revision: commitSource("example/two"),
      stack: "php/pest",
      isTargetStack: false,
      independenceGroup: "two",
      independenceNote: "Independent fixture two.",
    },
  ];
  pattern = {
    schemaVersion: 1,
    patternId: "registered-pattern",
    name: "Registered pattern",
    capability: "descriptive",
    evidenceStatus: "corroborated",
    intent: "Describe a corroborated method.",
    roles: [{ id: "method", description: "Observed method" }],
    bindingPoints: [],
    sources,
    provenance: sources.map((source) => ({
      sourceId: source.id,
      path: "method.md",
      observedRole: "method",
    })),
    tradeoffs: "Observed in successful repositories.",
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("registerPattern", () => {
  it("registers through staging and can be loaded from the catalog", () => {
    const result = registerPattern(pattern, catalogDir, sourceRoot);

    expect(result).toEqual({
      ok: true,
      path: join(catalogDir, "registered-pattern.json"),
    });
    expect(loadCatalog(catalogDir, sourceRoot).loaded).toHaveLength(1);
    expect(stagingEntries()).toEqual([]);
  });

  it("protects an existing pattern byte-for-byte", () => {
    expect(registerPattern(pattern, catalogDir, sourceRoot).ok).toBe(true);
    const path = join(catalogDir, "registered-pattern.json");
    const before = readFileSync(path);

    const second = registerPattern(
      { ...pattern, name: "Replacement attempt" },
      catalogDir,
      sourceRoot,
    );

    expect(second).toMatchObject({ ok: false, reason: "pattern-exists" });
    expect(readFileSync(path)).toEqual(before);
    expect(stagingEntries()).toEqual([]);
  });

  it("rejects unresolved provenance before writing and preserves entries", () => {
    writeFileSync(join(catalogDir, "seed.txt"), "seed");
    const before = entries();
    const unresolved: Pattern = {
      ...pattern,
      provenance: pattern.provenance.map((item, index) =>
        index === 0 ? { ...item, path: "missing.md" } : item,
      ),
    };

    expect(registerPattern(unresolved, catalogDir, sourceRoot)).toMatchObject({
      ok: false,
      reason: "pre-write-rejected",
    });
    expect(entries()).toEqual(before);
  });

  it("rejects a value changed by serialization and preserves entries", () => {
    writeFileSync(join(catalogDir, "seed.txt"), "seed");
    const before = entries();
    const serializesInvalid = structuredClone(pattern) as Pattern & {
      toJSON?: () => unknown;
    };
    Object.defineProperty(serializesInvalid, "toJSON", {
      enumerable: false,
      value: () => ({ ...pattern, capability: "generative" }),
    });

    expect(
      registerPattern(serializesInvalid, catalogDir, sourceRoot),
    ).toMatchObject({
      ok: false,
      reason: "post-write-rejected",
    });
    expect(entries()).toEqual(before);
    expect(stagingEntries()).toEqual([]);
  });
});
