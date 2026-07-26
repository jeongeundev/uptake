import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { Provenance, Source } from "@/types/pattern";

export type ResolveResult =
  | { ok: true; content: string }
  | { ok: false; reason: "provenance-unresolved" };

const unresolved: ResolveResult = {
  ok: false,
  reason: "provenance-unresolved",
};

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

export function resolveRepositoryRoot(
  repository: string,
  sourceRoot = process.env.UPTAKE_SOURCE_ROOT ?? "./.uptake/sources",
): string | undefined {
  const absoluteRoot = resolve(sourceRoot);
  const repositoryPath = resolve(absoluteRoot, repository);

  if (!isInside(absoluteRoot, repositoryPath)) {
    return undefined;
  }

  try {
    if (!statSync(repositoryPath).isDirectory()) {
      return undefined;
    }

    const realRoot = realpathSync(absoluteRoot);
    const realRepository = realpathSync(repositoryPath);
    return isInside(realRoot, realRepository) ? realRepository : undefined;
  } catch {
    return undefined;
  }
}

export function resolveProvenance(
  source: Source,
  provenance: Provenance,
  sourceRoot = process.env.UPTAKE_SOURCE_ROOT ?? "./.uptake/sources",
): ResolveResult {
  const repositoryRoot = resolveRepositoryRoot(source.repository, sourceRoot);
  if (repositoryRoot === undefined) {
    return unresolved;
  }

  try {
    const content = execFileSync(
      "git",
      ["show", `${source.revision}:${provenance.path}`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return { ok: true, content };
  } catch {
    return unresolved;
  }
}
