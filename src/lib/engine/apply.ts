import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { GeneratedFile } from "@/lib/engine/instantiate";
import { hashGenerated } from "@/lib/engine/verify";

export type ApprovalRecord = {
  patternId: string;
  targetRepoRoot: string;
  contentHash: string;
  targetBaseHash: string;
  frozenArgv: string[];
};

export type ApplyResult =
  | { status: "completed"; written: string[] }
  | {
      status: "diff-mismatch" | "apply-failed" | "base-changed";
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

function baseEntries(root: string, directory = root): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (directory === root && name === ".git") {
      continue;
    }
    const absolutePath = resolve(directory, name);
    const path = relative(root, absolutePath);
    const stats = lstatSync(absolutePath);
    if (stats.isDirectory()) {
      entries.push(`directory:${path}`);
      entries.push(...baseEntries(root, absolutePath));
    } else if (stats.isSymbolicLink()) {
      entries.push(`symlink:${path}:${readlinkSync(absolutePath)}`);
    } else if (stats.isFile()) {
      const content = readFileSync(absolutePath);
      entries.push(`file:${path}:${content.length}:${content.toString("base64")}`);
    }
  }
  return entries;
}

export function hashTargetBase(targetRepoRoot: string): string {
  const root = resolve(targetRepoRoot);
  return createHash("sha256")
    .update(baseEntries(root).join("\n"))
    .digest("hex");
}

export function applyGenerated(
  approval: ApprovalRecord,
  files: GeneratedFile[],
  targetRepoRoot: string,
): ApplyResult {
  const root = resolve(targetRepoRoot);
  if (
    approval === undefined ||
    approval.targetRepoRoot !== targetRepoRoot ||
    approval.patternId.length === 0 ||
    approval.frozenArgv.length === 0 ||
    hashGenerated(files) !== approval.contentHash
  ) {
    return {
      status: "diff-mismatch",
      detail: "generated files do not match the verified approval",
    };
  }

  if (hashTargetBase(root) !== approval.targetBaseHash) {
    return {
      status: "base-changed",
      detail: "target repository changed after approval",
    };
  }

  const destinations = files.map((file) => ({
    ...file,
    destination: resolve(root, file.path),
  }));
  const uniqueDestinations = new Set(
    destinations.map(({ destination }) => destination),
  );
  if (
    uniqueDestinations.size !== destinations.length ||
    destinations.some(
      ({ destination }) => !inside(root, destination) || existsSync(destination),
    )
  ) {
    return {
      status: "apply-failed",
      detail: "generated paths must be new files inside the target repository",
    };
  }

  const written: string[] = [];
  const attemptedDestinations: string[] = [];
  const createdDirectories = new Set<string>();
  try {
    for (const file of destinations) {
      let directory = dirname(file.destination);
      const missing: string[] = [];
      while (inside(root, directory) && !existsSync(directory)) {
        missing.push(directory);
        directory = dirname(directory);
      }
      mkdirSync(dirname(file.destination), { recursive: true });
      for (const created of missing) {
        createdDirectories.add(created);
      }
      attemptedDestinations.push(file.destination);
      writeFileSync(file.destination, file.content, "utf8");
      written.push(file.path);
    }
    return { status: "completed", written };
  } catch (error) {
    for (const destination of attemptedDestinations) {
      rmSync(destination, { force: true });
    }
    for (const directory of [...createdDirectories].sort(
      (left, right) => right.length - left.length,
    )) {
      try {
        rmdirSync(directory);
      } catch {
        // A non-empty directory was not created solely by this apply attempt.
      }
    }
    return {
      status: "apply-failed",
      detail: error instanceof Error ? error.message : "file apply failed",
    };
  }
}
