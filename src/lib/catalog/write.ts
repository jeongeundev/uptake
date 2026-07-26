import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  loadCatalog,
  validatePatternValue,
} from "@/lib/catalog/load";
import type { Pattern } from "@/types/pattern";

export type RegisterResult =
  | { ok: true; path: string }
  | {
      ok: false;
      reason:
        | "pattern-exists"
        | "pre-write-rejected"
        | "post-write-rejected"
        | "write-failed";
      detail: string;
    };

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

export function registerPattern(
  pattern: Pattern,
  catalogDir: string,
  sourceRoot?: string,
): RegisterResult {
  const filename = `${pattern.patternId}.json`;
  const preWrite = validatePatternValue(pattern, filename, sourceRoot);
  if (!preWrite.ok) {
    return {
      ok: false,
      reason: "pre-write-rejected",
      detail: preWrite.reason,
    };
  }

  const root = resolve(catalogDir);
  const destination = resolve(root, filename);
  if (!inside(root, destination)) {
    return {
      ok: false,
      reason: "write-failed",
      detail: "pattern path escapes the catalog directory",
    };
  }
  if (existsSync(destination)) {
    return {
      ok: false,
      reason: "pattern-exists",
      detail: `${filename} already exists`,
    };
  }

  let stagingDir: string | undefined;
  try {
    mkdirSync(root, { recursive: true });
    // This directory does not end in .json, so loadCatalog ignores it while
    // the candidate is staged and the live catalog remains unchanged.
    stagingDir = mkdtempSync(resolve(root, ".staging-"));
    const stagedPath = resolve(stagingDir, filename);
    writeFileSync(stagedPath, JSON.stringify(pattern, null, 2), "utf8");

    const postWrite = loadCatalog(stagingDir, sourceRoot);
    if (postWrite.loaded.length !== 1 || postWrite.rejected.length !== 0) {
      return {
        ok: false,
        reason: "post-write-rejected",
        detail:
          postWrite.rejected[0]?.reason ??
          `expected one pattern, loaded ${postWrite.loaded.length}`,
      };
    }

    try {
      // A hard link is atomic on this filesystem and fails if destination
      // exists, closing the existence-check-to-move race without overwrite.
      linkSync(stagedPath, destination);
    } catch (error) {
      if (existsSync(destination)) {
        return {
          ok: false,
          reason: "pattern-exists",
          detail: `${filename} already exists`,
        };
      }
      throw error;
    }
    unlinkSync(stagedPath);
    return { ok: true, path: destination };
  } catch (error) {
    return {
      ok: false,
      reason: "write-failed",
      detail: error instanceof Error ? error.message : "catalog write failed",
    };
  } finally {
    if (stagingDir !== undefined) {
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch (error) {
        // Registration outcome is already determined; cleanup failure must not
        // roll back or overwrite a successfully linked catalog entry.
        console.error(
          `catalog staging cleanup failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }
}
