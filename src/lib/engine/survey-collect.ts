import { execFileSync } from "node:child_process";

import { revisionPattern } from "@/lib/catalog/load";
import { resolveRepositoryRoot } from "@/lib/provenance/resolve";
import type { CompiledSurveyRules } from "@/types/survey";

export type SignalFile = {
  path: string;
  ruleId: string;
  content: string;
  truncated: boolean;
};

export type SkippedSignal = {
  path: string;
  ruleId: string;
  reason: "budget-exhausted" | "unreadable";
};

export type CollectResult =
  | {
      ok: true;
      revision: string;
      files: SignalFile[];
      skipped: SkippedSignal[];
    }
  | {
      ok: false;
      reason: "repository-unresolved" | "revision-unpinnable";
      detail: string;
    }
  | {
      ok: false;
      reason: "no-signal";
      detail: string;
      revision: string;
      skipped: SkippedSignal[];
    };

type AssignedPath = { path: string; ruleId: string };

function gitOutput(
  repositoryRoot: string,
  args: string[],
): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function roundRobin(assignments: AssignedPath[]): AssignedPath[] {
  const ruleIds = [...new Set(assignments.map(({ ruleId }) => ruleId))];
  const queues = ruleIds.map((ruleId) =>
    assignments.filter((assignment) => assignment.ruleId === ruleId),
  );
  const ordered: AssignedPath[] = [];

  for (let index = 0; ordered.length < assignments.length; index += 1) {
    for (const queue of queues) {
      const assignment = queue[index];
      if (assignment !== undefined) {
        ordered.push(assignment);
      }
    }
  }

  return ordered;
}

export function collectSignalFiles(
  repository: string,
  rules: CompiledSurveyRules,
  sourceRoot?: string,
): CollectResult {
  const repositoryRoot = resolveRepositoryRoot(repository, sourceRoot);
  if (repositoryRoot === undefined) {
    return {
      ok: false,
      reason: "repository-unresolved",
      detail: `Could not resolve repository ${repository}.`,
    };
  }

  const revision = gitOutput(repositoryRoot, ["rev-parse", "HEAD"])?.trim();
  if (revision === undefined || !revisionPattern.test(revision)) {
    return {
      ok: false,
      reason: "revision-unpinnable",
      detail: `Could not pin repository ${repository} to a commit revision.`,
    };
  }

  const tree = gitOutput(repositoryRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    revision,
  ]);
  if (tree === undefined) {
    return {
      ok: false,
      reason: "revision-unpinnable",
      detail: `Could not inspect repository ${repository} at ${revision}.`,
    };
  }

  const assignments: AssignedPath[] = [];
  const paths = tree === "" ? [] : tree.trimEnd().split("\n");
  for (const path of paths) {
    if (rules.exclude.some((pattern) => pattern.test(path))) {
      continue;
    }
    const rule = rules.rules.find(({ include }) =>
      include.some((pattern) => pattern.test(path)),
    );
    if (rule !== undefined) {
      assignments.push({ path, ruleId: rule.id });
    }
  }
  assignments.sort(
    (left, right) =>
      compareText(left.ruleId, right.ruleId) ||
      compareText(left.path, right.path),
  );

  const files: SignalFile[] = [];
  const skipped: SkippedSignal[] = [];
  let collectedChars = 0;
  for (const assignment of roundRobin(assignments)) {
    const source = gitOutput(repositoryRoot, [
      "show",
      `${revision}:${assignment.path}`,
    ]);
    if (source === undefined) {
      skipped.push({ ...assignment, reason: "unreadable" });
      continue;
    }

    const truncated = source.length > rules.budget.perFileChars;
    const content = truncated
      ? source.slice(0, rules.budget.perFileChars)
      : source;
    if (collectedChars + content.length > rules.budget.totalChars) {
      skipped.push({ ...assignment, reason: "budget-exhausted" });
      continue;
    }

    files.push({ ...assignment, content, truncated });
    collectedChars += content.length;
  }

  if (files.length === 0) {
    return {
      ok: false,
      reason: "no-signal",
      detail: `No signal file could be collected from ${repository} at ${revision}.`,
      revision,
      skipped,
    };
  }

  return { ok: true, revision, files, skipped };
}
