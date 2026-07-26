import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isId } from "@/lib/catalog/load";
import type {
  CompiledSurveyRules,
  SurveyBudget,
  SurveyRule,
  SurveyRuleSet,
} from "@/types/survey";

export class SurveyRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurveyRulesError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function parseBudget(value: unknown): SurveyBudget {
  if (!isRecord(value) || !hasExactKeys(value, ["perFileChars", "totalChars"])) {
    throw new SurveyRulesError(
      "budget must contain exactly perFileChars and totalChars",
    );
  }
  if (!isPositiveInteger(value.perFileChars)) {
    throw new SurveyRulesError("budget.perFileChars must be a positive integer");
  }
  if (!isPositiveInteger(value.totalChars)) {
    throw new SurveyRulesError("budget.totalChars must be a positive integer");
  }
  if (value.perFileChars > value.totalChars) {
    throw new SurveyRulesError(
      "budget.perFileChars must not exceed budget.totalChars",
    );
  }
  return {
    perFileChars: value.perFileChars,
    totalChars: value.totalChars,
  };
}

function parseStringPatterns(value: unknown, location: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((pattern) => typeof pattern === "string" && pattern.length > 0)
  ) {
    throw new SurveyRulesError(`${location} must be a non-empty string array`);
  }
  return value;
}

function parseRules(value: unknown): SurveyRule[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SurveyRulesError("rules must be a non-empty array");
  }

  const rules = value.map((rule, index) => {
    if (!isRecord(rule) || !hasExactKeys(rule, ["id", "include"])) {
      throw new SurveyRulesError(
        `rules[${index}] must contain exactly id and include`,
      );
    }
    if (!isId(rule.id)) {
      throw new SurveyRulesError(
        `rules[${index}].id "${String(rule.id)}" is invalid`,
      );
    }
    return {
      id: rule.id,
      include: parseStringPatterns(rule.include, `rule "${rule.id}" include`),
    };
  });

  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new SurveyRulesError(`duplicate rule id "${rule.id}"`);
    }
    seen.add(rule.id);
  }
  return rules;
}

function parseRuleSet(value: unknown): SurveyRuleSet {
  if (!isRecord(value)) {
    throw new SurveyRulesError("rule set must be a JSON object");
  }
  if (!hasExactKeys(value, ["schemaVersion", "budget", "exclude", "rules"])) {
    throw new SurveyRulesError(
      "top-level keys must be exactly schemaVersion, budget, exclude, and rules",
    );
  }
  if (value.schemaVersion !== 1) {
    throw new SurveyRulesError("schemaVersion must be 1");
  }
  if (!Array.isArray(value.exclude)) {
    throw new SurveyRulesError("exclude must be a string array");
  }
  if (
    !value.exclude.every(
      (pattern) => typeof pattern === "string" && pattern.length > 0,
    )
  ) {
    throw new SurveyRulesError("exclude entries must be non-empty strings");
  }
  return {
    schemaVersion: 1,
    budget: parseBudget(value.budget),
    exclude: value.exclude,
    rules: parseRules(value.rules),
  };
}

function compilePattern(pattern: string, location: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SurveyRulesError(
      `invalid regular expression at ${location}: ${pattern} (${detail})`,
    );
  }
}

export function loadSurveyRules(rulesPath?: string): CompiledSurveyRules {
  const path =
    rulesPath ??
    process.env.UPTAKE_SURVEY_RULES ??
    resolve("survey-rules.json");

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SurveyRulesError(`failed to read survey rules at ${path}: ${detail}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SurveyRulesError(
      `failed to parse survey rules JSON at ${path}: ${detail}`,
    );
  }

  const ruleSet = parseRuleSet(value);
  return {
    budget: ruleSet.budget,
    exclude: ruleSet.exclude.map((pattern, index) =>
      compilePattern(pattern, `exclude[${index}]`),
    ),
    rules: ruleSet.rules.map((rule) => ({
      id: rule.id,
      include: rule.include.map((pattern, index) =>
        compilePattern(pattern, `rule "${rule.id}" include[${index}]`),
      ),
    })),
  };
}
