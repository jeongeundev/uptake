import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createStubProposer } from "@/services/proposer-stub";
import type { AuthoringRequest } from "@/types/authoring";

import { extractEvidence } from "./extract";

const fixtureRoots: string[] = [];

function createSourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "uptake-extract-"));
  fixtureRoots.push(root);
  return root;
}

function createRepository(
  sourceRoot: string,
  repository: string,
  files: Record<string, string>,
): void {
  const repositoryRoot = join(sourceRoot, repository);
  mkdirSync(repositoryRoot, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(repositoryRoot, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "."], { cwd: repositoryRoot });
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
    { cwd: repositoryRoot },
  );
}

function request(repository = "github.com/example/source"): AuthoringRequest {
  return {
    patternId: "authored-pattern",
    name: "Authored pattern",
    intent: "Keep specification and verification connected.",
    capability: "generative",
    evidenceStatus: "observed",
    sources: [
      {
        id: "source-one",
        repository,
        stack: "php/pest",
        isTargetStack: false,
        independenceGroup: "group-one",
        independenceNote: "Independent fixture.",
      },
    ],
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("extractEvidence", () => {
  it("pins HEAD and accepts only evidence resolved at that revision", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "method.md": "observed method\n",
      "package.json": JSON.stringify({ devDependencies: { vitest: "3.2.4" } }),
    });
    const proposer = createStubProposer({
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "spec-artifact",
          rationale: "The file records the specification.",
        },
      ],
    });

    const result = await extractEvidence(request(), proposer, sourceRoot);

    expect(result).toMatchObject({
      ok: true,
      evidence: [
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "spec-artifact",
          content: "observed method\n",
        },
      ],
      discarded: [],
      targetStackFacts: [
        {
          sourceId: "source-one",
          vitestObserved: true,
          evidencePaths: ["package.json"],
        },
      ],
    });
    if (result.ok) {
      expect(result.sources[0].revision).toMatch(/^[0-9a-f]{40}$/);
      expect(result.sources[0].isTargetStack).toBe(false);
      expect(proposer.calls.fileCandidates[0].files).toEqual([
        "method.md",
        "package.json",
      ]);
    }
  });

  it("discards a proposed path that does not exist at the pinned revision", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "method.md": "observed method\n",
    });
    const proposer = createStubProposer({
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "spec-artifact",
          rationale: "Real evidence.",
        },
        {
          sourceId: "source-one",
          path: "invented.md",
          roleId: "spec-check",
          rationale: "Hallucinated evidence.",
        },
      ],
    });

    const result = await extractEvidence(request(), proposer, sourceRoot);

    expect(result).toMatchObject({
      ok: true,
      evidence: [{ path: "method.md" }],
      discarded: [
        {
          sourceId: "source-one",
          path: "invented.md",
          reason: "provenance-unresolved",
        },
      ],
    });
  });

  it("reports provenance-unresolved when every proposed path is discarded", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "method.md": "observed method\n",
    });
    const proposer = createStubProposer({
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "invented.md",
          roleId: "spec-artifact",
          rationale: "Hallucinated evidence.",
        },
      ],
    });

    await expect(
      extractEvidence(request(), proposer, sourceRoot),
    ).resolves.toMatchObject({
      ok: false,
      reason: "no-evidence",
      detail: expect.stringContaining("provenance-unresolved"),
    });
  });

  it("discards parent and absolute paths before provenance resolution", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "method.md": "observed method\n",
    });
    const proposer = createStubProposer({
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "spec-artifact",
          rationale: "Real evidence.",
        },
        {
          sourceId: "source-one",
          path: "../etc/passwd",
          roleId: "spec-check",
          rationale: "Escapes the repository.",
        },
        {
          sourceId: "source-one",
          path: "/etc/passwd",
          roleId: "spec-check",
          rationale: "Absolute path.",
        },
      ],
    });

    const result = await extractEvidence(request(), proposer, sourceRoot);

    expect(result).toMatchObject({
      ok: true,
      evidence: [{ path: "method.md" }],
      discarded: [
        { path: "../etc/passwd", reason: "path-invalid" },
        { path: "/etc/passwd", reason: "path-invalid" },
      ],
    });
  });

  it("discards non-anchor roles during generative authoring", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "method.md": "observed method\n",
    });
    const proposer = createStubProposer({
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "spec-artifact",
          rationale: "Allowed role.",
        },
        {
          sourceId: "source-one",
          path: "method.md",
          roleId: "review-custom",
          rationale: "Unsupported generative role.",
        },
      ],
    });

    const result = await extractEvidence(request(), proposer, sourceRoot);

    expect(result).toMatchObject({
      ok: true,
      evidence: [{ roleId: "spec-artifact" }],
      discarded: [
        {
          path: "method.md",
          reason: "role-not-allowed",
        },
      ],
    });
  });

  it("fails immediately when a repository identifier escapes the source root", async () => {
    const sourceRoot = createSourceRoot();
    const proposer = createStubProposer({});

    await expect(
      extractEvidence(request("../outside"), proposer, sourceRoot),
    ).resolves.toMatchObject({
      ok: false,
      reason: "source-unresolved",
    });
    expect(proposer.calls.fileCandidates).toHaveLength(0);
  });

  it("returns the same sorted result for the same pinned input", async () => {
    const sourceRoot = createSourceRoot();
    createRepository(sourceRoot, "github.com/example/source", {
      "z-gate.md": "gate\n",
      "a-spec.md": "spec\n",
    });
    const script = {
      fileCandidates: [
        {
          sourceId: "source-one",
          path: "z-gate.md",
          roleId: "blocking-gate",
          rationale: "Gate evidence.",
        },
        {
          sourceId: "source-one",
          path: "a-spec.md",
          roleId: "spec-artifact",
          rationale: "Spec evidence.",
        },
      ],
    };

    const first = await extractEvidence(
      request(),
      createStubProposer(script),
      sourceRoot,
    );
    const second = await extractEvidence(
      request(),
      createStubProposer(script),
      sourceRoot,
    );

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      ok: true,
      evidence: [{ path: "a-spec.md" }, { path: "z-gate.md" }],
    });
  });
});
