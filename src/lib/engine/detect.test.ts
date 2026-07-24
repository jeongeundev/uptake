import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectBindings,
  mergeUserProvidedBindings,
} from "@/lib/engine/detect";
import type { Pattern } from "@/types/pattern";

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;

describe("detectBindings", () => {
  it("detects vitest bindings with evidence and leaves absent conventions unresolved", () => {
    const detections = detectBindings(
      pattern,
      resolve("tests/fixtures/target-vitest"),
    );

    expect(detections).toEqual([
      {
        bindingId: "spec-format",
        kind: "spec-format",
        status: "binding-unresolved",
      },
      {
        bindingId: "checker",
        kind: "checker",
        status: "detected",
        value: "vitest",
        evidence: [{ path: "package.json" }],
      },
      {
        bindingId: "gate-location",
        kind: "gate-location",
        status: "detected",
        value: "src/**/*.test.ts",
        evidence: [{ path: "vitest.config.ts" }],
      },
      {
        bindingId: "naming",
        kind: "naming",
        status: "binding-unresolved",
      },
    ]);
  });

  it("reports a missing runner and dependent gate location as unresolved", () => {
    const detections = detectBindings(
      pattern,
      resolve("tests/fixtures/target-no-runner"),
    );

    expect(detections.find(({ kind }) => kind === "checker")?.status).toBe(
      "binding-unresolved",
    );
    expect(
      detections.find(({ kind }) => kind === "gate-location")?.status,
    ).toBe("binding-unresolved");
  });

  it("detects an existing declaration format and naming convention", () => {
    const detections = detectBindings(
      pattern,
      resolve("tests/fixtures/target-with-convention"),
    );

    expect(detections.find(({ kind }) => kind === "spec-format")).toEqual({
      bindingId: "spec-format",
      kind: "spec-format",
      status: "detected",
      value: "markdown",
      evidence: [{ path: ".changeset/example-change.md" }],
    });
    expect(detections.find(({ kind }) => kind === "naming")).toEqual({
      bindingId: "naming",
      kind: "naming",
      status: "detected",
      value: ".changeset/*.md",
      evidence: [{ path: ".changeset/example-change.md" }],
    });
    expect(
      detections.find(({ kind }) => kind === "gate-location"),
    ).toEqual({
      bindingId: "gate-location",
      kind: "gate-location",
      status: "detected",
      value: "co-located test files",
      evidence: [{ path: "package.json" }],
    });
  });

  it("merges explicit user values without inventing evidence", () => {
    const detections = detectBindings(
      pattern,
      resolve("tests/fixtures/target-vitest"),
    );

    expect(
      mergeUserProvidedBindings(detections, {
        "spec-format": "markdown",
        naming: ".changeset/*.md",
      }),
    ).toContainEqual({
      bindingId: "spec-format",
      kind: "spec-format",
      status: "user-provided",
      value: "markdown",
    });
  });

  it("only accepts trimmed values for unresolved bindings", () => {
    const detections = detectBindings(
      pattern,
      resolve("tests/fixtures/target-vitest"),
    );

    const merged = mergeUserProvidedBindings(detections, {
      checker: "jest",
      "spec-format": "  markdown  ",
      naming: "   ",
      unknown: "value",
    });

    expect(merged.find(({ bindingId }) => bindingId === "checker")).toEqual(
      detections.find(({ bindingId }) => bindingId === "checker"),
    );
    expect(merged.find(({ bindingId }) => bindingId === "spec-format")).toEqual({
      bindingId: "spec-format",
      kind: "spec-format",
      status: "user-provided",
      value: "markdown",
    });
    expect(merged.find(({ bindingId }) => bindingId === "naming")?.status).toBe(
      "binding-unresolved",
    );
    expect(merged).toHaveLength(detections.length);
  });
});
