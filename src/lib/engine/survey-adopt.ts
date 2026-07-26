import { isId } from "@/lib/catalog/load";
import {
  extractFromCandidates,
  type ExtractResult,
} from "@/lib/engine/extract";
import { resolveProvenance } from "@/lib/provenance/resolve";
import type { FileCandidate } from "@/services/proposer";
import type {
  AuthoringRequest,
  DiscardedCandidate,
  TargetStackFact,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";
import type { SurveyCandidate } from "@/types/survey";

export const SURVEY_ROLE_ID = "observed-practice";
const INDEPENDENCE_NOTE =
  "Observed in one repository; no independent comparison has been made.";

export type AdoptResult =
  | {
      ok: true;
      request: AuthoringRequest;
      pattern: Pattern;
      discarded: DiscardedCandidate[];
      targetStackFacts: TargetStackFact[];
    }
  | {
      ok: false;
      reason:
        | "source-id-underivable"
        | "revision-moved"
        | "extract-failed"
        | "assembly-invalid";
      detail: string;
    };

function deriveSourceId(repository: string): string | undefined {
  const sourceId = repository
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isId(sourceId) ? sourceId : undefined;
}

function extractionFailure(
  result: Exclude<ExtractResult, { ok: true }>,
): AdoptResult {
  return {
    ok: false,
    reason: "extract-failed",
    detail: result.detail,
  };
}

function isAssemblyValid(pattern: Pattern): boolean {
  if (pattern.sources.length === 0 || pattern.provenance.length === 0) {
    return false;
  }
  const sourceIds = new Set(pattern.sources.map(({ id }) => id));
  const roleIds = new Set(pattern.roles.map(({ id }) => id));
  const referencedSources = new Set(
    pattern.provenance.map(({ sourceId }) => sourceId),
  );
  const referencedRoles = new Set(
    pattern.provenance.map(({ observedRole }) => observedRole),
  );
  return (
    pattern.provenance.every(
      ({ sourceId, observedRole }) =>
        sourceIds.has(sourceId) && roleIds.has(observedRole),
    ) &&
    pattern.sources.every(({ id }) => referencedSources.has(id)) &&
    pattern.roles.every(({ id }) => referencedRoles.has(id)) &&
    new Set(
      pattern.sources.map(({ independenceGroup }) => independenceGroup),
    ).size === 1
  );
}

export async function adoptSurveyCandidate(
  input: {
    repository: string;
    revision: string;
    candidate: SurveyCandidate;
  },
  sourceRoot?: string,
): Promise<AdoptResult> {
  const sourceId = deriveSourceId(input.repository);
  if (sourceId === undefined) {
    return {
      ok: false,
      reason: "source-id-underivable",
      detail: `Could not derive a valid source id from ${input.repository}.`,
    };
  }

  const initialRequest: AuthoringRequest = {
    patternId: input.candidate.id,
    name: input.candidate.name,
    intent: input.candidate.intent,
    capability: "descriptive",
    evidenceStatus: "observed",
    sources: [
      {
        id: sourceId,
        repository: input.repository,
        stack: "unspecified",
        isTargetStack: false,
        independenceGroup: input.repository,
        independenceNote: INDEPENDENCE_NOTE,
      },
    ],
  };
  const candidates: FileCandidate[] = input.candidate.evidence.map((path) => ({
    sourceId,
    path,
    roleId: SURVEY_ROLE_ID,
    rationale: "Selected SURVEY evidence.",
  }));
  const extracted = await extractFromCandidates(
    initialRequest,
    candidates,
    sourceRoot,
  );
  if (!extracted.ok) {
    return extractionFailure(extracted);
  }
  const source = extracted.sources[0];
  if (source.revision !== input.revision) {
    return {
      ok: false,
      reason: "revision-moved",
      detail: `Repository revision moved from ${input.revision} to ${source.revision}.`,
    };
  }

  const targetStackFact = extracted.targetStackFacts[0];
  const packageJson = resolveProvenance(
    source,
    {
      sourceId,
      path: "package.json",
      observedRole: "target-stack-observation",
    },
    sourceRoot,
  );
  const stack = targetStackFact.vitestObserved
    ? "js/ts+vitest"
    : packageJson.ok
      ? "js/ts"
      : "unspecified";
  const adoptedSource = {
    ...source,
    stack,
    isTargetStack: targetStackFact.vitestObserved,
  };
  const request: AuthoringRequest = {
    ...initialRequest,
    sources: [
      {
        id: adoptedSource.id,
        repository: adoptedSource.repository,
        stack: adoptedSource.stack,
        isTargetStack: adoptedSource.isTargetStack,
        independenceGroup: adoptedSource.independenceGroup,
        independenceNote: adoptedSource.independenceNote,
      },
    ],
  };
  const pattern: Pattern = {
    schemaVersion: 1,
    patternId: input.candidate.id,
    name: input.candidate.name,
    capability: "descriptive",
    evidenceStatus: "observed",
    intent: input.candidate.intent,
    roles: [
      {
        id: SURVEY_ROLE_ID,
        description: input.candidate.discipline,
      },
    ],
    bindingPoints: [],
    sources: [adoptedSource],
    provenance: extracted.evidence
      .map(({ sourceId: evidenceSourceId, path }) => ({
        sourceId: evidenceSourceId,
        path,
        observedRole: SURVEY_ROLE_ID,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    tradeoffs: input.candidate.tradeoffs,
  };

  if (!isAssemblyValid(pattern)) {
    return {
      ok: false,
      reason: "assembly-invalid",
      detail: "The assembled SURVEY pattern contains an invalid reference.",
    };
  }

  return {
    ok: true,
    request,
    pattern,
    discarded: extracted.discarded,
    targetStackFacts: extracted.targetStackFacts,
  };
}
