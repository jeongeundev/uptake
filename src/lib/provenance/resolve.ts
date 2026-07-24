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

export function resolveProvenance(
  source: Source,
  provenance: Provenance,
  sourceRoot = process.env.UPTAKE_SOURCE_ROOT ?? "./.uptake/sources",
): ResolveResult {
  const absoluteRoot = resolve(sourceRoot);
  const repositoryPath = resolve(absoluteRoot, source.repository);

  if (!isInside(absoluteRoot, repositoryPath)) {
    return unresolved;
  }

  try {
    if (!statSync(repositoryPath).isDirectory()) {
      return unresolved;
    }

    const realRoot = realpathSync(absoluteRoot);
    const realRepository = realpathSync(repositoryPath);
    if (!isInside(realRoot, realRepository)) {
      return unresolved;
    }

    const content = execFileSync(
      "git",
      ["show", `${source.revision}:${provenance.path}`],
      {
        cwd: realRepository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return { ok: true, content };
  } catch {
    return unresolved;
  }
}
