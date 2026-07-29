import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { AdoptResult } from "@/lib/engine/survey-adopt";
import type { SurveyResult } from "@/lib/engine/survey";
import { runDir } from "@/workflow/paths";

export class WorkflowArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowArtifactError";
  }
}

type SurveySucceeded = Extract<SurveyResult, { ok: true }>;
type SurveyPartialFailure = Extract<
  SurveyResult,
  { ok: false; reason: "no-signal" | "no-candidate" }
>;
type SurveyEarlyFailure = Extract<
  SurveyResult,
  { ok: false; reason: "repository-unresolved" | "revision-unpinnable" }
>;

export type SurveyArtifact =
  | ({ status: "surveyed" } & Omit<SurveySucceeded, "ok">)
  | ({ status: SurveyPartialFailure["reason"] } & Omit<
      SurveyPartialFailure,
      "ok" | "reason"
    >)
  | ({ status: SurveyEarlyFailure["reason"] } & Omit<
      SurveyEarlyFailure,
      "ok" | "reason"
    >);

type AdoptSucceeded = Extract<AdoptResult, { ok: true }>;
type AdoptFailure = Extract<AdoptResult, { ok: false }>;

export type AuthoringArtifact =
  | {
      status: "drafted";
      candidateId: string;
      pattern: AdoptSucceeded["pattern"];
      discarded: AdoptSucceeded["discarded"];
      targetStackFacts: AdoptSucceeded["targetStackFacts"];
    }
  | {
      status: AdoptFailure["reason"];
      candidateId: string;
      detail: AdoptFailure["detail"];
      discarded?: AdoptFailure["discarded"];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

const SURVEY_STATUSES: ReadonlySet<string> = new Set([
  "surveyed",
  "no-signal",
  "no-candidate",
  "repository-unresolved",
  "revision-unpinnable",
]);

function isSurveyArtifactShape(value: unknown): value is SurveyArtifact {
  if (
    !isRecord(value) ||
    !isString(value.status) ||
    !SURVEY_STATUSES.has(value.status)
  ) {
    return false;
  }

  if (value.status === "surveyed") {
    return (
      isString(value.repository) &&
      isString(value.revision) &&
      Array.isArray(value.collected) &&
      Array.isArray(value.skipped) &&
      Array.isArray(value.candidates) &&
      Array.isArray(value.discardedEvidence) &&
      Array.isArray(value.discardedCandidates)
    );
  }

  if (value.status === "no-signal" || value.status === "no-candidate") {
    return (
      isString(value.detail) &&
      isString(value.repository) &&
      isString(value.revision) &&
      Array.isArray(value.collected) &&
      Array.isArray(value.skipped) &&
      Array.isArray(value.discardedEvidence) &&
      Array.isArray(value.discardedCandidates)
    );
  }

  return isString(value.detail);
}

const AUTHORING_STATUSES: ReadonlySet<string> = new Set([
  "drafted",
  "source-id-underivable",
  "revision-unresolvable",
  "provenance-unresolvable",
  "extract-failed",
  "assembly-invalid",
]);

function isAuthoringArtifactShape(value: unknown): value is AuthoringArtifact {
  if (
    !isRecord(value) ||
    !isString(value.status) ||
    !AUTHORING_STATUSES.has(value.status) ||
    !isString(value.candidateId)
  ) {
    return false;
  }

  if (value.status === "drafted") {
    return (
      isRecord(value.pattern) &&
      Array.isArray(value.discarded) &&
      Array.isArray(value.targetStackFacts)
    );
  }

  return (
    isString(value.detail) &&
    (value.discarded === undefined || Array.isArray(value.discarded))
  );
}

function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function readJsonArtifact<T>(
  path: string,
  isShape: (value: unknown) => value is T,
): T | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new WorkflowArtifactError(
      `failed to read ${path}: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkflowArtifactError(`${path} is not valid JSON`);
  }

  if (!isShape(parsed)) {
    throw new WorkflowArtifactError(
      `${path} does not match a known artifact shape`,
    );
  }
  return parsed;
}

function surveyArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "survey.json");
}

function authoringArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "authoring.json");
}

export function writeSurveyArtifact(
  runId: string,
  artifact: SurveyArtifact,
  root?: string,
): void {
  writeJsonAtomic(surveyArtifactPath(runId, root), artifact);
}

export function readSurveyArtifact(
  runId: string,
  root?: string,
): SurveyArtifact | undefined {
  return readJsonArtifact(surveyArtifactPath(runId, root), isSurveyArtifactShape);
}

export function writeAuthoringArtifact(
  runId: string,
  artifact: AuthoringArtifact,
  root?: string,
): void {
  writeJsonAtomic(authoringArtifactPath(runId, root), artifact);
}

export function readAuthoringArtifact(
  runId: string,
  root?: string,
): AuthoringArtifact | undefined {
  return readJsonArtifact(
    authoringArtifactPath(runId, root),
    isAuthoringArtifactShape,
  );
}
