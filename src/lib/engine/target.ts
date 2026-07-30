import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function targetEligibility(targetRepoRoot: string): string | undefined {
  if (!isAbsolute(targetRepoRoot)) {
    return "target path must be absolute";
  }
  try {
    accessSync(targetRepoRoot, constants.R_OK);
    JSON.parse(readFileSync(resolve(targetRepoRoot, "package.json"), "utf8"));
  } catch {
    return "target must contain a readable package.json";
  }
  try {
    const worktree = execFileSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: targetRepoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (worktree !== "true") {
      return "target must be a Git worktree";
    }
  } catch {
    return "target must be a Git worktree";
  }
  return undefined;
}
