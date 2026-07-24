import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import type { Pattern } from "@/types/pattern";

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;
const bindings = detectBindings(
  pattern,
  resolve("tests/fixtures/target-vitest"),
);

function withMarker(marker: string): Pattern {
  if (pattern.oracle === undefined) {
    throw new Error("seed pattern must have an oracle");
  }
  return {
    ...pattern,
    oracle: {
      ...pattern.oracle,
      injection: { ...pattern.oracle.injection, marker },
    },
  };
}

describe("instantiate", () => {
  it("generates the gate and binds the pattern oracle to its artifact", () => {
    const result = instantiate(pattern, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok || pattern.oracle === undefined) {
      return;
    }

    expect(result.files).toHaveLength(2);
    const artifact = result.files.find(({ role }) => role === "spec-artifact");
    expect(artifact?.path).toBe("uptake-gate/declared-changes.ts");
    expect(artifact?.content.split(pattern.oracle.injection.marker)).toHaveLength(
      2,
    );
    expect(result.gateTestId).toBe("declared-change-present");
    expect(result.injection).toEqual({
      operation: "replace",
      path: artifact?.path,
      marker: pattern.oracle.injection.marker,
      replacement: pattern.oracle.injection.replacement,
    });
  });

  it("is deterministic for the same pattern and bindings", () => {
    expect(instantiate(pattern, bindings)).toEqual(
      instantiate(pattern, bindings),
    );
  });

  it("takes the marker from the pattern oracle", () => {
    const changedPattern = withMarker('"different-seed-change"');
    const result = instantiate(changedPattern, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok || changedPattern.oracle === undefined) {
      return;
    }
    const artifact = result.files.find(({ role }) => role === "spec-artifact");
    expect(artifact?.content).toContain(
      changedPattern.oracle.injection.marker,
    );
    expect(result.injection.marker).toBe(
      changedPattern.oracle.injection.marker,
    );
  });

  it.each([
    ["observed", { evidenceStatus: "observed" as const }],
    ["descriptive", { capability: "descriptive" as const }],
    [
      "observed and descriptive",
      {
        evidenceStatus: "observed" as const,
        capability: "descriptive" as const,
      },
    ],
  ])("blocks %s patterns", (_name, overrides) => {
    expect(instantiate({ ...pattern, ...overrides }, bindings)).toMatchObject({
      ok: false,
      reason: "generation-blocked",
    });
  });

  it("blocks a target without a resolved vitest checker", () => {
    const unresolvedBindings = detectBindings(
      pattern,
      resolve("tests/fixtures/target-no-runner"),
    );

    expect(instantiate(pattern, unresolvedBindings)).toMatchObject({
      ok: false,
      reason: "generation-blocked",
    });
  });

  it.each([
    ["zero", ""],
    ["multiple", "spec-artifact"],
  ])("rejects a marker that appears %s times in the artifact", (_name, marker) => {
    expect(instantiate(withMarker(marker), bindings)).toMatchObject({
      ok: false,
      reason: "injection-failed",
    });
  });
});
