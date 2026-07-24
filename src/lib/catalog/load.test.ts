import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { Pattern, Source } from "@/types/pattern";

import { loadCatalog } from "./load";

type Fixture = {
  catalogDir: string;
  sourceRoot: string;
  pattern: Pattern;
};

function commitSource(
  sourceRoot: string,
  repository: string,
  files: Record<string, string>,
): string {
  const repositoryPath = join(sourceRoot, repository);
  mkdirSync(repositoryPath, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repositoryPath });
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(repositoryPath, path), content);
  }
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

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "uptake-catalog-"));
  const catalogDir = join(root, "catalog");
  const sourceRoot = join(root, "sources");
  mkdirSync(catalogDir);
  mkdirSync(sourceRoot);
  const revisionOne = commitSource(
    sourceRoot,
    "github.com/example/one",
    { "method.md": "one\n" },
  );
  const revisionTwo = commitSource(
    sourceRoot,
    "gitlab.com/example/two",
    { "method.md": "two\n" },
  );
  const sources: Source[] = [
    {
      id: "source-one",
      repository: "github.com/example/one",
      revision: revisionOne,
      stack: "typescript/vitest",
      isTargetStack: true,
      independenceGroup: "group-one",
      independenceNote: "independent organization one",
    },
    {
      id: "source-two",
      repository: "gitlab.com/example/two",
      revision: revisionTwo,
      stack: "php/pest",
      isTargetStack: false,
      independenceGroup: "group-two",
      independenceNote: "independent organization two",
    },
  ];
  return {
    catalogDir,
    sourceRoot,
    pattern: {
      schemaVersion: 1,
      patternId: "spec-verification",
      name: "Spec verification",
      capability: "generative",
      evidenceStatus: "corroborated",
      intent: "Observe a spec-bound verification gate.",
      roles: [{ id: "spec", description: "A specification artifact" }],
      bindingPoints: [
        {
          id: "checker",
          description: "The verification tool",
          kind: "checker",
        },
      ],
      sources,
      provenance: sources.map((source) => ({
        sourceId: source.id,
        path: "method.md",
        observedRole: "spec",
      })),
      oracle: {
        violation: "The implementation contradicts the specification.",
        gateTestId: "spec-gate",
        injection: {
          operation: "replace",
          targetRole: "spec",
          marker: "UPTAKE_MARKER",
          replacement: "violation",
        },
        expect: "red",
      },
      tradeoffs: "Observed in successful repositories; causality is unproven.",
    },
  };
}

function writePattern(
  fixture: Fixture,
  pattern: unknown = fixture.pattern,
  filename = "spec-verification.json",
): void {
  writeFileSync(join(fixture.catalogDir, filename), JSON.stringify(pattern));
}

function rejectionReason(fixture: Fixture): string {
  const result = loadCatalog(fixture.catalogDir, fixture.sourceRoot);
  expect(result.loaded).toEqual([]);
  expect(result.rejected).toHaveLength(1);
  return result.rejected[0].reason;
}

describe("loadCatalog", () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it("loads a valid corroborated generative pattern with generation enabled", () => {
    writePattern(fixture);

    const result = loadCatalog(fixture.catalogDir, fixture.sourceRoot);

    expect(result.rejected).toEqual([]);
    expect(result.loaded).toEqual([
      { pattern: fixture.pattern, generationEnabled: true },
    ]);
  });

  it.each([
    ["observed generative", "generative", "observed"],
    ["corroborated descriptive", "descriptive", "corroborated"],
    ["observed descriptive", "descriptive", "observed"],
  ] as const)("loads %s with generation disabled", (_, capability, evidenceStatus) => {
    const pattern = {
      ...fixture.pattern,
      capability,
      evidenceStatus,
      sources:
        evidenceStatus === "observed"
          ? [fixture.pattern.sources[0]]
          : fixture.pattern.sources,
      provenance:
        evidenceStatus === "observed"
          ? [fixture.pattern.provenance[0]]
          : fixture.pattern.provenance,
      oracle: capability === "generative" ? fixture.pattern.oracle : undefined,
    };
    writePattern(fixture, pattern);

    const result = loadCatalog(fixture.catalogDir, fixture.sourceRoot);

    expect(result.rejected).toEqual([]);
    expect(result.loaded[0].generationEnabled).toBe(false);
  });

  it("rejects unresolved provenance", () => {
    writePattern(fixture, {
      ...fixture.pattern,
      provenance: [
        { ...fixture.pattern.provenance[0], path: "missing.md" },
        fixture.pattern.provenance[1],
      ],
    });
    expect(rejectionReason(fixture)).toBe("provenance-unresolved");
  });

  it.each([
    [
      "missing required field",
      (pattern) => {
        const result = { ...pattern } as Partial<Pattern>;
        delete result.name;
        return result;
      },
    ],
    ["unsupported schema version", (pattern) => ({ ...pattern, schemaVersion: 2 })],
    ["unknown field", (pattern) => ({ ...pattern, unexpected: true })],
    ["invalid id", (pattern) => ({ ...pattern, patternId: "Spec_Verification" })],
    [
      "duplicate role id",
      (pattern) => ({ ...pattern, roles: [...pattern.roles, pattern.roles[0]] }),
    ],
    [
      "non-SHA revision",
      (pattern) => ({
        ...pattern,
        sources: pattern.sources.map((source, index) =>
          index === 0 ? { ...source, revision: "main" } : source,
        ),
      }),
    ],
    [
      "non-normalized provenance path",
      (pattern) => ({
        ...pattern,
        provenance: pattern.provenance.map((provenance, index) =>
          index === 0 ? { ...provenance, path: "../method.md" } : provenance,
        ),
      }),
    ],
  ] as const)("rejects schema violation: %s", (_, mutate) => {
    writePattern(fixture, mutate(fixture.pattern));
    expect(rejectionReason(fixture)).toBe("schema-invalid");
  });

  it("rejects a filename that does not match patternId", () => {
    writePattern(fixture, fixture.pattern, "other.json");
    expect(rejectionReason(fixture)).toBe("schema-invalid");
  });

  it.each([
    ["empty sources", { sources: [] }],
    ["empty provenance", { provenance: [] }],
  ])("rejects %s", (_, mutation) => {
    writePattern(fixture, { ...fixture.pattern, ...mutation });
    expect(rejectionReason(fixture)).toBe("schema-invalid");
  });

  it.each([
    [
      "unknown source reference",
      (pattern: Pattern) => ({
        provenance: [
          { ...pattern.provenance[0], sourceId: "unknown-source" },
          pattern.provenance[1],
        ],
      }),
    ],
    [
      "unknown role reference",
      (pattern: Pattern) => ({
        provenance: [
          { ...pattern.provenance[0], observedRole: "unknown-role" },
          pattern.provenance[1],
        ],
      }),
    ],
    [
      "orphan source used as dummy independence evidence",
      (pattern: Pattern) => ({ provenance: [pattern.provenance[0]] }),
    ],
    [
      "orphan role",
      (pattern: Pattern) => ({
        roles: [
          ...pattern.roles,
          { id: "gate", description: "An unobserved gate" },
        ],
      }),
    ],
  ])("rejects reference integrity violation: %s", (_, mutate) => {
    writePattern(fixture, { ...fixture.pattern, ...mutate(fixture.pattern) });
    expect(rejectionReason(fixture)).toBe("reference-invalid");
  });

  it.each([
    [
      "generative without oracle",
      () => ({
        capability: "generative",
        oracle: undefined,
      }),
    ],
    [
      "descriptive with oracle",
      (pattern: Pattern) => ({
        capability: "descriptive",
        oracle: pattern.oracle,
      }),
    ],
  ])("rejects capability/oracle mismatch: %s", (_, mutate) => {
    writePattern(fixture, { ...fixture.pattern, ...mutate(fixture.pattern) });
    expect(rejectionReason(fixture)).toBe("schema-invalid");
  });

  it("rejects corroborated evidence with fewer than two independence groups", () => {
    writePattern(fixture, {
      ...fixture.pattern,
      sources: fixture.pattern.sources.map((source) => ({
        ...source,
        independenceGroup: "same-group",
      })),
    });
    expect(rejectionReason(fixture)).toBe("evidence-invalid");
  });

  it("rejects corroborated evidence without a non-target stack", () => {
    writePattern(fixture, {
      ...fixture.pattern,
      sources: fixture.pattern.sources.map((source) => ({
        ...source,
        isTargetStack: true,
      })),
    });
    expect(rejectionReason(fixture)).toBe("evidence-invalid");
  });

  it.each([
    ["zero groups", () => ({ sources: [], provenance: [] })],
    [
      "two groups",
      (pattern: Pattern) => ({
        sources: pattern.sources,
        provenance: pattern.provenance,
      }),
    ],
  ])("rejects observed evidence with %s", (_, mutate) => {
    const mutation = mutate(fixture.pattern);
    writePattern(fixture, {
      ...fixture.pattern,
      capability: "descriptive",
      evidenceStatus: "observed",
      oracle: undefined,
      ...mutation,
    });
    expect(rejectionReason(fixture)).toBe(
      mutation.sources.length === 0 ? "schema-invalid" : "evidence-invalid",
    );
  });

  it("rejects corroborated roles supported by only one group each", () => {
    writePattern(fixture, {
      ...fixture.pattern,
      roles: [
        { id: "spec", description: "A specification artifact" },
        { id: "gate", description: "A blocking gate" },
      ],
      provenance: [
        fixture.pattern.provenance[0],
        { ...fixture.pattern.provenance[1], observedRole: "gate" },
      ],
      oracle: {
        ...fixture.pattern.oracle!,
        injection: {
          ...fixture.pattern.oracle!.injection,
          targetRole: "spec",
        },
      },
    });
    expect(rejectionReason(fixture)).toBe("role-evidence-invalid");
  });

  it("rejects only the invalid file and continues loading other patterns", () => {
    writePattern(fixture);
    writePattern(fixture, { schemaVersion: 2 }, "broken.json");

    const result = loadCatalog(fixture.catalogDir, fixture.sourceRoot);

    expect(result.loaded).toHaveLength(1);
    expect(result.rejected).toEqual([
      expect.objectContaining({ file: "broken.json", reason: "schema-invalid" }),
    ]);
  });
});
