import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, isAbsolute, join, posix } from "node:path";

import { resolveProvenance } from "@/lib/provenance/resolve";
import type { Pattern } from "@/types/pattern";

export type LoadedPattern = {
  pattern: Pattern;
  generationEnabled: boolean;
};

export type RejectedPattern = {
  file: string;
  reason: string;
  detail?: string;
};

export type CatalogLoadResult = {
  loaded: LoadedPattern[];
  rejected: RejectedPattern[];
};

type ValidationResult =
  | { ok: true; pattern: Pattern }
  | { ok: false; reason: string; detail?: string };

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const revisionPattern = /^[0-9a-f]{40}$/i;
const bindingKinds = new Set([
  "spec-format",
  "checker",
  "gate-location",
  "naming",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isId(value: unknown): value is string {
  return isNonEmptyString(value) && idPattern.test(value);
}

function isRelativePosixPath(value: unknown): value is string {
  if (
    !isNonEmptyString(value) ||
    isAbsolute(value) ||
    value.includes("\\") ||
    posix.normalize(value) !== value
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

function hasUniqueIds(values: { id: string }[]): boolean {
  return new Set(values.map(({ id }) => id)).size === values.length;
}

function parsePattern(value: unknown, filename: string): ValidationResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        "schemaVersion",
        "patternId",
        "name",
        "capability",
        "evidenceStatus",
        "intent",
        "roles",
        "bindingPoints",
        "sources",
        "provenance",
        "tradeoffs",
      ],
      ["oracle"],
    ) ||
    value.schemaVersion !== 1 ||
    !isId(value.patternId) ||
    basename(filename, extname(filename)) !== value.patternId ||
    !isNonEmptyString(value.name) ||
    (value.capability !== "generative" &&
      value.capability !== "descriptive") ||
    (value.evidenceStatus !== "observed" &&
      value.evidenceStatus !== "corroborated") ||
    !isNonEmptyString(value.intent) ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.bindingPoints) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.provenance) ||
    !isNonEmptyString(value.tradeoffs)
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  const roles = value.roles;
  if (
    roles.length === 0 ||
    !roles.every(
      (role) =>
        isRecord(role) &&
        hasOnlyKeys(role, ["id", "description"]) &&
        isId(role.id) &&
        isNonEmptyString(role.description),
    ) ||
    !hasUniqueIds(roles)
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  const bindingPoints = value.bindingPoints;
  if (
    !bindingPoints.every(
      (binding) =>
        isRecord(binding) &&
        hasOnlyKeys(binding, ["id", "description", "kind"]) &&
        isId(binding.id) &&
        isNonEmptyString(binding.description) &&
        typeof binding.kind === "string" &&
        bindingKinds.has(binding.kind),
    ) ||
    !hasUniqueIds(bindingPoints)
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  const sources = value.sources;
  if (
    sources.length === 0 ||
    !sources.every(
      (source) =>
        isRecord(source) &&
        hasOnlyKeys(source, [
          "id",
          "repository",
          "revision",
          "stack",
          "isTargetStack",
          "independenceGroup",
          "independenceNote",
        ]) &&
        isId(source.id) &&
        isRelativePosixPath(source.repository) &&
        typeof source.revision === "string" &&
        revisionPattern.test(source.revision) &&
        isNonEmptyString(source.stack) &&
        typeof source.isTargetStack === "boolean" &&
        isId(source.independenceGroup) &&
        isNonEmptyString(source.independenceNote),
    ) ||
    !hasUniqueIds(sources)
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  const provenance = value.provenance;
  if (
    provenance.length === 0 ||
    !provenance.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, ["sourceId", "path", "observedRole"]) &&
        isId(item.sourceId) &&
        isRelativePosixPath(item.path) &&
        isId(item.observedRole),
    )
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  const oracle = value.oracle;
  const injection =
    isRecord(oracle) && isRecord(oracle.injection)
      ? oracle.injection
      : undefined;
  if (
    (value.capability === "generative" && oracle === undefined) ||
    (value.capability === "descriptive" && oracle !== undefined)
  ) {
    return { ok: false, reason: "schema-invalid" };
  }
  if (
    oracle !== undefined &&
    (!isRecord(oracle) ||
      !hasOnlyKeys(oracle, [
        "violation",
        "gateTestId",
        "injection",
        "expect",
      ]) ||
      !isNonEmptyString(oracle.violation) ||
      !isId(oracle.gateTestId) ||
      oracle.expect !== "red" ||
      injection === undefined ||
      !hasOnlyKeys(injection, [
        "operation",
        "targetRole",
        "marker",
        "replacement",
      ]) ||
      injection.operation !== "replace" ||
      !isId(injection.targetRole) ||
      !isNonEmptyString(injection.marker) ||
      typeof injection.replacement !== "string" ||
      !roles.some((role) => role.id === injection.targetRole))
  ) {
    return { ok: false, reason: "schema-invalid" };
  }

  return { ok: true, pattern: value as Pattern };
}

function validateReferences(pattern: Pattern): ValidationResult {
  const sourceIds = new Set(pattern.sources.map(({ id }) => id));
  const roleIds = new Set(pattern.roles.map(({ id }) => id));
  const referencedSources = new Set(
    pattern.provenance.map(({ sourceId }) => sourceId),
  );
  const referencedRoles = new Set(
    pattern.provenance.map(({ observedRole }) => observedRole),
  );
  if (
    pattern.provenance.some(
      ({ sourceId, observedRole }) =>
        !sourceIds.has(sourceId) || !roleIds.has(observedRole),
    ) ||
    pattern.sources.some(({ id }) => !referencedSources.has(id)) ||
    pattern.roles.some(({ id }) => !referencedRoles.has(id))
  ) {
    return { ok: false, reason: "reference-invalid" };
  }
  return { ok: true, pattern };
}

function validateEvidence(pattern: Pattern): ValidationResult {
  const groups = new Set(
    pattern.sources.map(({ independenceGroup }) => independenceGroup),
  );
  if (
    (pattern.evidenceStatus === "observed" && groups.size !== 1) ||
    (pattern.evidenceStatus === "corroborated" &&
      (groups.size < 2 ||
        !pattern.sources.some(({ isTargetStack }) => !isTargetStack)))
  ) {
    return { ok: false, reason: "evidence-invalid" };
  }

  if (pattern.evidenceStatus === "corroborated") {
    const sourceById = new Map(
      pattern.sources.map((source) => [source.id, source]),
    );
    for (const role of pattern.roles) {
      const roleGroups = new Set(
        pattern.provenance
          .filter(({ observedRole }) => observedRole === role.id)
          .map(({ sourceId }) => sourceById.get(sourceId)?.independenceGroup),
      );
      if (roleGroups.size < 2) {
        return { ok: false, reason: "role-evidence-invalid" };
      }
    }
  }
  return { ok: true, pattern };
}

function validateProvenance(
  pattern: Pattern,
  sourceRoot: string,
): ValidationResult {
  const sourceById = new Map(
    pattern.sources.map((source) => [source.id, source]),
  );
  for (const provenance of pattern.provenance) {
    const source = sourceById.get(provenance.sourceId);
    if (
      source === undefined ||
      !resolveProvenance(source, provenance, sourceRoot).ok
    ) {
      return { ok: false, reason: "provenance-unresolved" };
    }
  }
  return { ok: true, pattern };
}

export function loadCatalog(
  catalogDir: string,
  sourceRoot = process.env.UPTAKE_SOURCE_ROOT ?? "./.uptake/sources",
): CatalogLoadResult {
  const result: CatalogLoadResult = { loaded: [], rejected: [] };
  let files: string[];
  try {
    files = readdirSync(catalogDir)
      .filter((file) => extname(file) === ".json")
      .sort();
  } catch {
    return {
      loaded: [],
      rejected: [{ file: catalogDir, reason: "catalog-unreadable" }],
    };
  }

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(catalogDir, file), "utf8"));
    } catch {
      result.rejected.push({ file, reason: "schema-invalid" });
      continue;
    }

    const parsedPattern = parsePattern(parsed, file);
    if (!parsedPattern.ok) {
      result.rejected.push({ file, reason: parsedPattern.reason });
      continue;
    }
    const validations = [
      validateReferences(parsedPattern.pattern),
      validateEvidence(parsedPattern.pattern),
      validateProvenance(parsedPattern.pattern, sourceRoot),
    ];
    const rejection = validations.find((validation) => !validation.ok);
    if (rejection && !rejection.ok) {
      result.rejected.push({ file, reason: rejection.reason });
      continue;
    }
    result.loaded.push({
      pattern: parsedPattern.pattern,
      generationEnabled:
        parsedPattern.pattern.capability === "generative" &&
        parsedPattern.pattern.evidenceStatus === "corroborated",
    });
  }
  return result;
}
