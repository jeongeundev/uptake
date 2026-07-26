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

  it("generates the same artifacts for a new pattern id with the anchor role shape", () => {
    const renamedPattern = {
      ...pattern,
      patternId: "authored-change-declaration-gate",
    };

    const result = instantiate(renamedPattern, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files.map(({ path, role }) => ({ path, role }))).toEqual([
      {
        path: "uptake-gate/declared-changes.ts",
        role: "spec-artifact",
      },
      { path: "uptake-gate/spec-gate.test.ts", role: "spec-check" },
    ]);
    expect(result.injection).toEqual({
      operation: "replace",
      path: "uptake-gate/declared-changes.ts",
      marker: pattern.oracle?.injection.marker,
      replacement: pattern.oracle?.injection.replacement,
    });
  });

  it("rejects an anchor role shape missing a role", () => {
    const missingRolePattern = {
      ...pattern,
      roles: pattern.roles.filter(({ id }) => id !== "blocking-gate"),
    };

    expect(instantiate(missingRolePattern, bindings)).toMatchObject({
      ok: false,
      reason: "generation-failed",
    });
  });

  it("rejects an anchor role shape with an extra role", () => {
    const extraRolePattern = {
      ...pattern,
      roles: [
        ...pattern.roles,
        { id: "extra-role", description: "앵커 템플릿 범위 밖 역할" },
      ],
    };

    expect(instantiate(extraRolePattern, bindings)).toMatchObject({
      ok: false,
      reason: "generation-failed",
    });
  });

  it("rejects an oracle that targets a non-artifact role", () => {
    if (pattern.oracle === undefined) {
      throw new Error("seed pattern must have an oracle");
    }
    const wrongTargetPattern = {
      ...pattern,
      oracle: {
        ...pattern.oracle,
        injection: {
          ...pattern.oracle.injection,
          targetRole: "spec-check",
        },
      },
    };

    expect(instantiate(wrongTargetPattern, bindings)).toMatchObject({
      ok: false,
      reason: "generation-failed",
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
