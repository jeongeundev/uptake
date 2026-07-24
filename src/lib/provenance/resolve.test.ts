import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Provenance, Source } from "@/types/pattern";

import { resolveProvenance } from "./resolve";

function createSourceRepository(sourceRoot: string): {
  repository: string;
  revision: string;
} {
  const repository = "github.com/example/source";
  const repositoryPath = join(sourceRoot, repository);
  mkdirSync(repositoryPath, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repositoryPath });
  writeFileSync(join(repositoryPath, "method.md"), "observed method\n");
  execFileSync("git", ["add", "method.md"], { cwd: repositoryPath });
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
    { cwd: repositoryPath },
  );

  return {
    repository,
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryPath,
      encoding: "utf8",
    }).trim(),
  };
}

function source(repository: string, revision: string): Source {
  return {
    id: "source",
    repository,
    revision,
    stack: "php/pest",
    isTargetStack: false,
    independenceGroup: "group-one",
    independenceNote: "independent fixture",
  };
}

const provenance: Provenance = {
  sourceId: "source",
  path: "method.md",
  observedRole: "spec",
};

describe("resolveProvenance", () => {
  it("reads a file from a fixed revision with git show", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-source-"));
    const repository = createSourceRepository(sourceRoot);

    expect(
      resolveProvenance(
        source(repository.repository, repository.revision),
        provenance,
        sourceRoot,
      ),
    ).toEqual({ ok: true, content: "observed method\n" });
  });

  it("rejects a missing revision", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-source-"));
    const repository = createSourceRepository(sourceRoot);

    expect(
      resolveProvenance(
        source(repository.repository, "0".repeat(40)),
        provenance,
        sourceRoot,
      ),
    ).toEqual({ ok: false, reason: "provenance-unresolved" });
  });

  it("rejects a missing path at the fixed revision", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-source-"));
    const repository = createSourceRepository(sourceRoot);

    expect(
      resolveProvenance(
        source(repository.repository, repository.revision),
        { ...provenance, path: "missing.md" },
        sourceRoot,
      ),
    ).toEqual({ ok: false, reason: "provenance-unresolved" });
  });

  it("rejects a repository identifier that escapes the source root", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-source-"));

    expect(
      resolveProvenance(
        source("../outside", "0".repeat(40)),
        provenance,
        sourceRoot,
      ),
    ).toEqual({ ok: false, reason: "provenance-unresolved" });
  });
});
