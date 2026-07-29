import { execFileSync } from "node:child_process";

import {
  isId,
  isRelativePosixPath,
  revisionPattern,
} from "@/lib/catalog/load";
import { hasVitest } from "@/lib/engine/detect";
import {
  resolveProvenance,
  resolveRepositoryRoot,
} from "@/lib/provenance/resolve";
import {
  ANCHOR_ROLE_IDS,
  type FileCandidate,
  type Proposer,
} from "@/services/proposer";
import type {
  AuthoringRequest,
  DiscardedCandidate,
  Evidence,
  Source,
  TargetStackFact,
} from "@/types/authoring";

export type ExtractResult =
  | {
      ok: true;
      sources: Source[];
      evidence: Evidence[];
      discarded: DiscardedCandidate[];
      targetStackFacts: TargetStackFact[];
    }
  | {
      ok: false;
      reason: "source-unresolved" | "revision-unresolvable";
      detail: string;
    }
  | {
      ok: false;
      reason: "no-evidence";
      detail: string;
      discarded: DiscardedCandidate[];
    };

type ResolvedSource = {
  source: Source;
  files: string[];
};

export class GitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitUnavailableError";
  }
}

// git exiting non-zero is an answer about the repository (unknown revision,
// missing path) and stays a gate result. Failing to start git at all — or
// losing it to a signal — is an infrastructure error and must not be counted
// as one (ADR-008): it would surface as revision-unresolvable, which tells the
// user to fix their clone.
function gitAnswered(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function gitOutput(repositoryRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (gitAnswered(error)) return undefined;
    throw new GitUnavailableError(
      `git could not be run in ${repositoryRoot}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function observeTargetStack(
  source: Source,
  sourceRoot: string | undefined,
): TargetStackFact {
  const packageJson = resolveProvenance(
    source,
    {
      sourceId: source.id,
      path: "package.json",
      observedRole: "target-stack-observation",
    },
    sourceRoot,
  );
  if (packageJson.ok) {
    try {
      const parsed: unknown = JSON.parse(packageJson.content);
      const record =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      const vitestObserved = hasVitest(record);
      return {
        sourceId: source.id,
        vitestObserved,
        evidencePaths: vitestObserved ? ["package.json"] : [],
      };
    } catch {
      // An unreadable package manifest is not target-stack evidence.
    }
  }
  return {
    sourceId: source.id,
    vitestObserved: false,
    evidencePaths: [],
  };
}

function resolveSources(
  request: AuthoringRequest,
  sourceRoot?: string,
): ExtractResult | ResolvedSource[] {
  const resolvedSources: ResolvedSource[] = [];
  for (const sourceSpec of request.sources) {
    const repositoryRoot = resolveRepositoryRoot(
      sourceSpec.repository,
      sourceRoot,
    );
    if (repositoryRoot === undefined) {
      return {
        ok: false,
        reason: "source-unresolved",
        detail: `Could not resolve source ${sourceSpec.id}.`,
      };
    }
    const pinnedRevision = sourceSpec.revision;
    const revision =
      pinnedRevision ?? gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
    const files =
      revision === undefined
        ? undefined
        : gitOutput(repositoryRoot, [
            "ls-tree",
            "-r",
            "--name-only",
            revision,
          ]);
    if (
      revision === undefined ||
      !revisionPattern.test(revision) ||
      files === undefined
    ) {
      if (pinnedRevision !== undefined) {
        return {
          ok: false,
          reason: "revision-unresolvable",
          detail: `Could not resolve pinned revision ${pinnedRevision} for source ${sourceSpec.id}.`,
        };
      }
      return {
        ok: false,
        reason: "source-unresolved",
        detail: `Could not pin and inspect source ${sourceSpec.id}.`,
      };
    }
    resolvedSources.push({
      source: { ...sourceSpec, revision },
      files: files === "" ? [] : files.split("\n").sort(),
    });
  }
  return resolvedSources;
}

function extractResolvedCandidates(
  request: AuthoringRequest,
  resolvedSources: ResolvedSource[],
  candidates: FileCandidate[],
  sourceRoot?: string,
): ExtractResult {
  const sourceOrder = new Map(
    request.sources.map((source, index) => [source.id, index]),
  );
  candidates.sort(
    (left, right) =>
      (sourceOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER) ||
      left.path.localeCompare(right.path) ||
      left.roleId.localeCompare(right.roleId),
  );

  const sourceById = new Map(
    resolvedSources.map(({ source }) => [source.id, source]),
  );
  const anchorRoles = new Set<string>(ANCHOR_ROLE_IDS);
  const accepted = new Set<string>();
  const evidence: Evidence[] = [];
  const discarded: DiscardedCandidate[] = [];

  for (const candidate of candidates) {
    const source = sourceById.get(candidate.sourceId);
    let reason: DiscardedCandidate["reason"] | undefined;
    if (source === undefined || !isRelativePosixPath(candidate.path)) {
      reason = "path-invalid";
    } else if (
      !isId(candidate.roleId) ||
      (request.capability === "generative" &&
        !anchorRoles.has(candidate.roleId))
    ) {
      reason = "role-not-allowed";
    }

    const key = `${candidate.sourceId}\0${candidate.path}\0${candidate.roleId}`;
    if (reason === undefined && accepted.has(key)) {
      reason = "duplicate";
    }
    const resolved =
      reason === undefined && source !== undefined
        ? resolveProvenance(
            source,
            {
              sourceId: candidate.sourceId,
              path: candidate.path,
              observedRole: candidate.roleId,
            },
            sourceRoot,
          )
        : undefined;
    if (reason === undefined && resolved !== undefined && !resolved.ok) {
      reason = "provenance-unresolved";
    }

    if (reason !== undefined) {
      discarded.push({
        sourceId: candidate.sourceId,
        path: candidate.path,
        reason,
      });
    } else if (resolved?.ok) {
      accepted.add(key);
      evidence.push({
        sourceId: candidate.sourceId,
        path: candidate.path,
        roleId: candidate.roleId,
        content: resolved.content,
      });
    }
  }

  if (evidence.length === 0) {
    const reasons = [...new Set(discarded.map((candidate) => candidate.reason))]
      .sort()
      .join(", ");
    return {
      ok: false,
      reason: "no-evidence",
      detail: `No proposed file candidate resolved to evidence. Discarded reasons: ${reasons}.`,
      discarded,
    };
  }

  return {
    ok: true,
    sources: resolvedSources.map(({ source }) => source),
    evidence,
    discarded,
    targetStackFacts: resolvedSources.map(({ source }) =>
      observeTargetStack(source, sourceRoot),
    ),
  };
}

export async function extractFromCandidates(
  request: AuthoringRequest,
  candidates: FileCandidate[],
  sourceRoot?: string,
): Promise<ExtractResult> {
  const resolvedSources = resolveSources(request, sourceRoot);
  if (!Array.isArray(resolvedSources)) {
    return resolvedSources;
  }
  return extractResolvedCandidates(
    request,
    resolvedSources,
    candidates,
    sourceRoot,
  );
}

export async function extractEvidence(
  request: AuthoringRequest,
  proposer: Proposer,
  sourceRoot?: string,
): Promise<ExtractResult> {
  const resolvedSources = resolveSources(request, sourceRoot);
  if (!Array.isArray(resolvedSources)) {
    return resolvedSources;
  }

  const proposals: FileCandidate[] = [];
  for (const { source, files } of resolvedSources) {
    proposals.push(
      ...(await proposer.proposeFileCandidates({
        intent: request.intent,
        sourceId: source.id,
        repository: source.repository,
        revision: source.revision,
        files,
        // Empty means unrestricted roles for descriptive authoring.
        roleIds:
          request.capability === "generative" ? ANCHOR_ROLE_IDS : [],
      })),
    );
  }

  return extractResolvedCandidates(
    request,
    resolvedSources,
    proposals,
    sourceRoot,
  );
}
