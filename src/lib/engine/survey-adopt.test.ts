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

import type { SurveyCandidate } from "@/types/survey";

import {
  adoptSurveyCandidate,
  SURVEY_ROLE_ID,
} from "./survey-adopt";

const fixtureRoots: string[] = [];
const repository = "github.com/pytest-dev/pytest";

function createSourceRoot(files: Record<string, string>): {
  sourceRoot: string;
  repositoryRoot: string;
  revision: string;
} {
  const sourceRoot = mkdtempSync(join(tmpdir(), "uptake-survey-adopt-"));
  fixtureRoots.push(sourceRoot);
  const repositoryRoot = join(sourceRoot, repository);
  mkdirSync(repositoryRoot, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(repositoryRoot, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
  commit(repositoryRoot, "fixture");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  return { sourceRoot, repositoryRoot, revision };
}

function commit(repositoryRoot: string, message: string): void {
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
      message,
    ],
    { cwd: repositoryRoot },
  );
}

function candidate(
  evidence = ["docs/method.md", "scripts/check.ts"],
): SurveyCandidate {
  return {
    id: "documented-discipline",
    name: "Documented discipline",
    intent: "Keep repository instructions inspectable.",
    discipline:
      "Committed documentation and a check record the repository discipline.",
    tradeoffs: "The documentation and check must be maintained.",
    evidence,
    confidence: "high",
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("adoptSurveyCandidate", () => {
  it("assembles one observed descriptive role from exactly the selected evidence", async () => {
    const fixture = createSourceRoot({
      "docs/method.md": "method\n",
      "scripts/check.ts": "check\n",
      "package.json": JSON.stringify({
        devDependencies: { vitest: "3.2.4" },
      }),
    });

    const result = await adoptSurveyCandidate(
      {
        repository,
        revision: fixture.revision,
        candidate: candidate(),
      },
      fixture.sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        patternId: "documented-discipline",
        capability: "descriptive",
        evidenceStatus: "observed",
        sources: [
          {
            id: "github-com-pytest-dev-pytest",
            repository,
            stack: "js/ts+vitest",
            isTargetStack: true,
            independenceGroup: "github-com-pytest-dev-pytest",
          },
        ],
      },
      pattern: {
        schemaVersion: 1,
        capability: "descriptive",
        evidenceStatus: "observed",
        roles: [
          {
            id: SURVEY_ROLE_ID,
            description:
              "Committed documentation and a check record the repository discipline.",
          },
        ],
        bindingPoints: [],
      },
      discarded: [],
      targetStackFacts: [
        {
          sourceId: "github-com-pytest-dev-pytest",
          vitestObserved: true,
          evidencePaths: ["package.json"],
        },
      ],
    });
    if (result.ok) {
      expect(result.pattern).not.toHaveProperty("oracle");
      expect(result.pattern.provenance.map(({ path }) => path)).toEqual(
        [...candidate().evidence].sort(),
      );
      expect(
        result.pattern.provenance.every(
          ({ observedRole }) => observedRole === SURVEY_ROLE_ID,
        ),
      ).toBe(true);
    }
  });

  it("adopts successfully when HEAD moves after SURVEY pinned its revision", async () => {
    const fixture = createSourceRoot({
      "docs/method.md": "method\n",
      "scripts/check.ts": "check\n",
    });
    writeFileSync(join(fixture.repositoryRoot, "later.md"), "later\n");
    commit(fixture.repositoryRoot, "later");

    const result = await adoptSurveyCandidate(
      {
        repository,
        revision: fixture.revision,
        candidate: candidate(),
      },
      fixture.sourceRoot,
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.pattern.sources[0].revision).toBe(fixture.revision);
    }
  });

  it("reports revision-unresolvable when the pinned revision cannot be resolved", async () => {
    const fixture = createSourceRoot({
      "docs/method.md": "method\n",
      "scripts/check.ts": "check\n",
    });

    await expect(
      adoptSurveyCandidate(
        {
          repository,
          revision: "0".repeat(40),
          candidate: candidate(),
        },
        fixture.sourceRoot,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "revision-unresolvable",
    });
  });

  it("rejects a repository identifier with no derivable source id", async () => {
    await expect(
      adoptSurveyCandidate({
        repository: "///",
        revision: "0".repeat(40),
        candidate: candidate(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "source-id-underivable",
    });
  });

  it.each([
    {
      name: "package without vitest",
      files: {
        "docs/method.md": "method\n",
        "scripts/check.ts": "check\n",
        "package.json": JSON.stringify({ scripts: { test: "node test.js" } }),
      },
      stack: "js/ts",
    },
    {
      name: "no package manifest",
      files: {
        "docs/method.md": "method\n",
        "scripts/check.ts": "check\n",
      },
      stack: "unspecified",
    },
  ])("labels $name without inventing target-stack evidence", async ({
    files,
    stack,
  }) => {
    const fixture = createSourceRoot(files);

    const result = await adoptSurveyCandidate(
      {
        repository,
        revision: fixture.revision,
        candidate: candidate(),
      },
      fixture.sourceRoot,
    );

    expect(result).toMatchObject({
      ok: true,
      pattern: {
        sources: [{ stack, isTargetStack: false }],
      },
      targetStackFacts: [{ vitestObserved: false, evidencePaths: [] }],
    });
  });

  it("preserves unresolved evidence and fails when none resolves", async () => {
    const fixture = createSourceRoot({ "docs/method.md": "method\n" });

    const partial = await adoptSurveyCandidate(
      {
        repository,
        revision: fixture.revision,
        candidate: candidate(["docs/method.md", "missing.md"]),
      },
      fixture.sourceRoot,
    );
    expect(partial).toMatchObject({
      ok: true,
      pattern: { provenance: [{ path: "docs/method.md" }] },
      discarded: [
        { path: "missing.md", reason: "provenance-unresolved" },
      ],
    });

    await expect(
      adoptSurveyCandidate(
        {
          repository,
          revision: fixture.revision,
          candidate: candidate(["missing.md"]),
        },
        fixture.sourceRoot,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "provenance-unresolvable",
      detail: expect.stringContaining("provenance-unresolved"),
    });
  });

  it("returns identical patterns for identical inputs", async () => {
    const fixture = createSourceRoot({
      "docs/method.md": "method\n",
      "scripts/check.ts": "check\n",
    });
    const input = {
      repository,
      revision: fixture.revision,
      candidate: candidate(),
    };

    const first = await adoptSurveyCandidate(input, fixture.sourceRoot);
    const second = await adoptSurveyCandidate(input, fixture.sourceRoot);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.pattern).toEqual(first.pattern);
      expect(second.request).toEqual(first.request);
    }
  });
});
