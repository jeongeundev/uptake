import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadCatalog } from "@/lib/catalog/load";
import type { Pattern } from "@/types/pattern";

const catalogDir = join(process.cwd(), "catalog");
const sourceRoot = join(process.cwd(), ".uptake", "sources");
const patternPath = join(catalogDir, "spec-change-declaration-gate.json");

function readPattern(): Pattern {
  return JSON.parse(readFileSync(patternPath, "utf8")) as Pattern;
}

describe("spec-change-declaration-gate seed pattern", () => {
  it("serializes the curated structure and fixed oracle contract", () => {
    const pattern = readPattern();
    const sourceById = new Map(
      pattern.sources.map((source) => [source.id, source]),
    );

    expect(pattern).toMatchObject({
      schemaVersion: 1,
      patternId: "spec-change-declaration-gate",
      capability: "generative",
      evidenceStatus: "corroborated",
      oracle: {
        gateTestId: "declared-change-present",
        injection: {
          operation: "replace",
          targetRole: "spec-artifact",
          marker:
            '/* @uptake:marker:begin */ "seed-change" /* @uptake:marker:end */',
          replacement: "",
        },
        expect: "red",
      },
    });
    expect(pattern.roles.map(({ id }) => id)).toEqual([
      "spec-artifact",
      "spec-check",
      "blocking-gate",
    ]);
    expect(pattern.bindingPoints.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "spec-format", kind: "spec-format" },
      { id: "checker", kind: "checker" },
      { id: "gate-location", kind: "gate-location" },
      { id: "naming", kind: "naming" },
    ]);

    const referencedSources = new Set(
      pattern.provenance.map(({ sourceId }) => sourceId),
    );
    const referencedRoles = new Set(
      pattern.provenance.map(({ observedRole }) => observedRole),
    );
    expect(referencedSources).toEqual(
      new Set(pattern.sources.map(({ id }) => id)),
    );
    expect(referencedRoles).toEqual(new Set(pattern.roles.map(({ id }) => id)));

    for (const role of pattern.roles) {
      const groups = new Set(
        pattern.provenance
          .filter(({ observedRole }) => observedRole === role.id)
          .map(({ sourceId }) => sourceById.get(sourceId)?.independenceGroup),
      );
      expect(groups).toEqual(new Set(["lablup-backendai", "pytest-dev"]));
    }

    expect(pattern.tradeoffs).toContain("생존자 편향");
    expect(pattern.tradeoffs).toContain("towncrier");
  });

  const repositoriesPresent = [
    "github.com/lablup/backend.ai",
    "github.com/pytest-dev/pytest",
  ].every((repository) => existsSync(join(sourceRoot, repository)));
  const loadTest = repositoriesPresent ? it : it.skip;

  loadTest("loads with generation enabled when curated sources exist", () => {
    const result = loadCatalog(catalogDir, sourceRoot);

    expect(result.rejected).toEqual([]);
    expect(result.loaded).toEqual([
      { pattern: readPattern(), generationEnabled: true },
    ]);
  });
});
