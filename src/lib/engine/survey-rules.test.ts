import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadSurveyRules,
  SurveyRulesError,
} from "@/lib/engine/survey-rules";

const temporaryDirectories: string[] = [];

function writeRules(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "uptake-survey-rules-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "rules.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function validRules() {
  return {
    schemaVersion: 1,
    budget: { perFileChars: 12, totalChars: 24 },
    exclude: ["vendor/"],
    rules: [
      { id: "second-rule", include: ["^second/"] },
      { id: "first-rule", include: ["^first/"] },
    ],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe("loadSurveyRules", () => {
  it("compiles valid patterns while preserving rule order", () => {
    const result = loadSurveyRules(writeRules(validRules()));

    expect(result.rules.map(({ id }) => id)).toEqual([
      "second-rule",
      "first-rule",
    ]);
    expect(result.exclude[0].test("vendor/file.ts")).toBe(true);
    expect(result.rules[1].include[0].test("first/file.ts")).toBe(true);
  });

  it("loads the bundled eight-category rule set by default", () => {
    const result = loadSurveyRules();

    expect(result.rules.map(({ id }) => id)).toEqual([
      "agent-instructions",
      "agent-config",
      "ci",
      "hooks",
      "task-runner",
      "design-docs",
      "test-config",
      "automation",
    ]);
    const byId = new Map(result.rules.map((rule) => [rule.id, rule.include]));
    expect(
      byId.get("agent-instructions")?.some((pattern) =>
        pattern.test("contributing.RST"),
      ),
    ).toBe(true);
    expect(
      byId
        .get("design-docs")
        ?.some((pattern) => pattern.test("doc/contributing.rst")),
    ).toBe(true);
    expect(
      byId
        .get("automation")
        ?.some((pattern) => pattern.test("scripts/execute.py")),
    ).toBe(true);
  });

  it.each([
    ["missing file", "/path/that/does/not/exist.json", "read"],
    [
      "invalid JSON",
      () => {
        const path = writeRules(validRules());
        writeFileSync(path, "{");
        return path;
      },
      "JSON",
    ],
  ])("rejects a %s with an identifiable message", (_, pathValue, message) => {
    const path = typeof pathValue === "function" ? pathValue() : pathValue;
    expect(() => loadSurveyRules(path)).toThrowError(
      expect.objectContaining({
        name: "SurveyRulesError",
        message: expect.stringContaining(message),
      }),
    );
  });

  it.each([
    ["unsupported schema", { schemaVersion: 2 }, "schemaVersion"],
    ["unknown top-level key", { extra: true }, "top-level"],
    [
      "non-positive per-file budget",
      { budget: { perFileChars: 0, totalChars: 24 } },
      "perFileChars",
    ],
    [
      "non-integer total budget",
      { budget: { perFileChars: 12, totalChars: 24.5 } },
      "totalChars",
    ],
    [
      "per-file budget above total",
      { budget: { perFileChars: 25, totalChars: 24 } },
      "perFileChars",
    ],
    ["empty rules", { rules: [] }, "rules"],
    [
      "invalid rule id",
      { rules: [{ id: "Bad_ID", include: ["x"] }] },
      "Bad_ID",
    ],
    [
      "duplicate rule id",
      {
        rules: [
          { id: "same", include: ["x"] },
          { id: "same", include: ["y"] },
        ],
      },
      "same",
    ],
    [
      "empty include",
      { rules: [{ id: "first-rule", include: [] }] },
      "first-rule",
    ],
    [
      "empty include pattern",
      { rules: [{ id: "first-rule", include: [""] }] },
      "first-rule",
    ],
    ["invalid exclude regex", { exclude: ["["] }, "exclude[0]"],
    [
      "invalid include regex",
      { rules: [{ id: "first-rule", include: ["["] }] },
      "first-rule",
    ],
  ])("rejects %s", (_, patch, message) => {
    const rules = validRules();
    const value = { ...rules, ...patch };

    expect(() => loadSurveyRules(writeRules(value))).toThrowError(
      expect.objectContaining({
        name: "SurveyRulesError",
        message: expect.stringContaining(message),
      }),
    );
  });

  it("uses a dedicated error type", () => {
    expect(() => loadSurveyRules("/missing/survey-rules.json")).toThrow(
      SurveyRulesError,
    );
  });
});
