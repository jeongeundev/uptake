import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { targetEligibility } from "@/lib/engine/target";

const temporaryRoots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(resolve(tmpdir(), "uptake-target-"));
  temporaryRoots.push(root);
  return root;
}

function gitRepo(): string {
  const root = tempDir();
  writeFileSync(resolve(root, "package.json"), "{}\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake Test",
      "-c",
      "user.email=uptake@example.test",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("targetEligibility", () => {
  it("is eligible for an absolute path with a readable package.json inside a Git worktree", () => {
    const root = gitRepo();
    expect(targetEligibility(root)).toBeUndefined();
  });

  it("rejects a relative path", () => {
    expect(targetEligibility("relative/path")).toBe(
      "target path must be absolute",
    );
  });

  it("rejects a target without a readable package.json", () => {
    const root = tempDir();
    expect(targetEligibility(root)).toBe(
      "target must contain a readable package.json",
    );
  });

  it("rejects a target that is not a Git worktree", () => {
    const root = tempDir();
    writeFileSync(resolve(root, "package.json"), "{}\n", "utf8");
    expect(targetEligibility(root)).toBe("target must be a Git worktree");
  });
});
