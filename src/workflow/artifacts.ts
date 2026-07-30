import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type { BindingDetection } from "@/lib/engine/detect";
import type { GeneratedFile } from "@/lib/engine/instantiate";
import type { AdoptResult } from "@/lib/engine/survey-adopt";
import type { SurveyResult } from "@/lib/engine/survey";
import type { InstantiatedInjection } from "@/types/pattern";
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

export type BindingsArtifact = {
  patternId: string;
  targetRepoRoot: string;
  bindings: BindingDetection[];
};

export type GeneratedArtifact = {
  patternId: string;
  files: GeneratedFile[];
  injection: InstantiatedInjection;
  gateTestId: string;
};

// tradeoffs/provenance are copied here by verify, which has already run
// validatePatternValue on the pattern (ADR-025). apply displays them without
// re-reading the pattern, so it takes on no new validation obligation.
export type PatternProvenance = {
  repository: string;
  revision: string;
  path: string;
};

export type VerifyArtifact =
  | {
      status: "verified";
      verificationId: string;
      patternId: string;
      targetRepoRoot: string;
      contentHash: string;
      bindingsHash: string;
      targetBaseHash: string;
      frozenArgv: string[];
      gateTestId: string;
      positivePreview: string;
      positiveTruncated: boolean;
      negativePreview: string;
      negativeTruncated: boolean;
      tradeoffs: string;
      provenance: PatternProvenance[];
    }
  | {
      status:
        | "pattern-invalid"
        | "target-ineligible"
        | "bindings-unresolved"
        | "generation-blocked"
        | "generation-failed"
        | "injection-failed"
        | "positive-failed"
        | "negative-not-caught"
        | "gate-error"
        | "timeout";
      detail: string;
      patternId?: string;
      targetRepoRoot: string;
      frozenArgv?: string[];
    };

export type ApplyArtifact =
  | {
      status: "applied";
      verificationId: string;
      targetRepoRoot: string;
      written: string[];
    }
  | {
      status:
        | "diff-mismatch"
        | "bindings-mismatch"
        | "base-changed"
        | "apply-failed";
      verificationId: string;
      targetRepoRoot: string;
      detail: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
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

function isBindingsArtifactShape(value: unknown): value is BindingsArtifact {
  return (
    isRecord(value) &&
    isString(value.patternId) &&
    isString(value.targetRepoRoot) &&
    Array.isArray(value.bindings)
  );
}

function isGeneratedArtifactShape(value: unknown): value is GeneratedArtifact {
  return (
    isRecord(value) &&
    isString(value.patternId) &&
    Array.isArray(value.files) &&
    isRecord(value.injection) &&
    isString(value.gateTestId)
  );
}

const VERIFY_STATUSES: ReadonlySet<string> = new Set([
  "verified",
  "pattern-invalid",
  "target-ineligible",
  "bindings-unresolved",
  "generation-blocked",
  "generation-failed",
  "injection-failed",
  "positive-failed",
  "negative-not-caught",
  "gate-error",
  "timeout",
]);

function isVerifyArtifactShape(value: unknown): value is VerifyArtifact {
  if (
    !isRecord(value) ||
    !isString(value.status) ||
    !VERIFY_STATUSES.has(value.status) ||
    !isString(value.targetRepoRoot)
  ) {
    return false;
  }

  if (value.status === "verified") {
    return (
      isString(value.verificationId) &&
      isString(value.patternId) &&
      isString(value.contentHash) &&
      isString(value.bindingsHash) &&
      isString(value.targetBaseHash) &&
      isStringArray(value.frozenArgv) &&
      isString(value.gateTestId) &&
      isString(value.positivePreview) &&
      isBoolean(value.positiveTruncated) &&
      isString(value.negativePreview) &&
      isBoolean(value.negativeTruncated) &&
      isString(value.tradeoffs) &&
      Array.isArray(value.provenance) &&
      value.provenance.every(
        (item) =>
          isRecord(item) &&
          isString(item.repository) &&
          isString(item.revision) &&
          isString(item.path),
      )
    );
  }

  return (
    isString(value.detail) &&
    (value.patternId === undefined || isString(value.patternId)) &&
    (value.frozenArgv === undefined || isStringArray(value.frozenArgv))
  );
}

const APPLY_STATUSES: ReadonlySet<string> = new Set([
  "applied",
  "diff-mismatch",
  "bindings-mismatch",
  "base-changed",
  "apply-failed",
]);

function isApplyArtifactShape(value: unknown): value is ApplyArtifact {
  if (
    !isRecord(value) ||
    !isString(value.status) ||
    !APPLY_STATUSES.has(value.status) ||
    !isString(value.verificationId) ||
    !isString(value.targetRepoRoot)
  ) {
    return false;
  }

  if (value.status === "applied") {
    return isStringArray(value.written);
  }

  return isString(value.detail);
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

function bindingsArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "bindings.json");
}

function generatedArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "generated.json");
}

function verifyArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "verify.json");
}

function applyArtifactPath(runId: string, root?: string): string {
  return join(runDir(runId, root), "apply.json");
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

export function writeBindingsArtifact(
  runId: string,
  artifact: BindingsArtifact,
  root?: string,
): void {
  writeJsonAtomic(bindingsArtifactPath(runId, root), artifact);
}

export function readBindingsArtifact(
  runId: string,
  root?: string,
): BindingsArtifact | undefined {
  return readJsonArtifact(
    bindingsArtifactPath(runId, root),
    isBindingsArtifactShape,
  );
}

export function writeGeneratedArtifact(
  runId: string,
  artifact: GeneratedArtifact,
  root?: string,
): void {
  writeJsonAtomic(generatedArtifactPath(runId, root), artifact);
}

export function readGeneratedArtifact(
  runId: string,
  root?: string,
): GeneratedArtifact | undefined {
  return readJsonArtifact(
    generatedArtifactPath(runId, root),
    isGeneratedArtifactShape,
  );
}

export function writeVerifyArtifact(
  runId: string,
  artifact: VerifyArtifact,
  root?: string,
): void {
  writeJsonAtomic(verifyArtifactPath(runId, root), artifact);
}

export function readVerifyArtifact(
  runId: string,
  root?: string,
): VerifyArtifact | undefined {
  return readJsonArtifact(
    verifyArtifactPath(runId, root),
    isVerifyArtifactShape,
  );
}

export function writeApplyArtifact(
  runId: string,
  artifact: ApplyArtifact,
  root?: string,
): void {
  writeJsonAtomic(applyArtifactPath(runId, root), artifact);
}

export function readApplyArtifact(
  runId: string,
  root?: string,
): ApplyArtifact | undefined {
  return readJsonArtifact(applyArtifactPath(runId, root), isApplyArtifactShape);
}

export function runLogPath(
  runId: string,
  name: "positive" | "negative",
  root?: string,
): string {
  return join(runDir(runId, root), "logs", `${name}.log`);
}

// gate-runner가 임시 디렉터리에 남긴 로그를 runs/<id>/logs/로 복사한다.
// 원본은 엔진의 임시 자원이므로 옮기거나 지우지 않는다. 원본을 읽을 수 없어도
// 던지지 않는다 — 로그 부재 때문에 검증 결과 기록 자체가 유실되면 안 된다.
export function writeRunLog(
  runId: string,
  name: "positive" | "negative",
  sourcePath: string,
  root?: string,
): void {
  const destination = runLogPath(runId, name, root);
  mkdirSync(dirname(destination), { recursive: true });
  try {
    copyFileSync(sourcePath, destination);
  } catch (error) {
    writeFileSync(
      destination,
      `failed to copy log from ${sourcePath}: ${errorMessage(error)}\n`,
      "utf8",
    );
  }
}
