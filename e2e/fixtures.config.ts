import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

type FixtureState = {
  root: string;
  catalogDir: string;
  sourceRoot: string;
  targetRoot: string;
  authoringTargetRoot: string;
  proposerStubScript: string;
  unresolvedProposerStubScript: string;
};

const sourceFiles = [
  { path: "changes/12359.feature.md", role: "spec-artifact" },
  { path: ".github/workflows/timeline-check.yml", role: "spec-check" },
  { path: "gates/blocking-gate.py", role: "blocking-gate" },
] as const;

function commitRepository(root: string): string {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Uptake E2E",
      "-c",
      "user.email=uptake-e2e@example.test",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function createPythonSource(
  sourceRoot: string,
  repository: string,
  sourceNumber: number,
): string {
  const root = resolve(sourceRoot, repository);
  for (const file of sourceFiles) {
    const path = resolve(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# python source ${sourceNumber}: ${file.role}\n`);
  }
  return commitRepository(root);
}

export function createE2EFixtures(): FixtureState {
  const root = mkdtempSync(resolve(tmpdir(), "uptake-e2e-"));
  const sourceRoot = resolve(root, "sources");
  const catalogDir = resolve(root, "catalog");
  const targetRoot = resolve(root, "target-js-vitest");
  const authoringTargetRoot = resolve(root, "authoring-target-js-vitest");
  const proposerStubScript = resolve(root, "proposer-stub.json");
  const unresolvedProposerStubScript = resolve(
    root,
    "proposer-stub-unresolved.json",
  );
  const sources = [
    {
      id: "python-one",
      repository: "fixtures/python-one",
      independenceGroup: "python-one",
    },
    {
      id: "python-two",
      repository: "fixtures/python-two",
      independenceGroup: "python-two",
    },
  ];
  const revisions = new Map(
    sources.map((source, index) => [
      source.id,
      createPythonSource(sourceRoot, source.repository, index + 1),
    ]),
  );
  const pattern = JSON.parse(
    readFileSync(
      resolve("catalog/spec-change-declaration-gate.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const fixturePattern = {
    ...pattern,
    sources: sources.map((source) => ({
      ...source,
      revision: revisions.get(source.id),
      stack: "python/pytest",
      isTargetStack: false,
      independenceNote: "Independent runtime Python E2E fixture.",
    })),
    provenance: sources.flatMap((source) =>
      sourceFiles.map((file) => ({
        sourceId: source.id,
        path: file.path,
        observedRole: file.role,
      })),
    ),
  };
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(
    resolve(catalogDir, "spec-change-declaration-gate.json"),
    JSON.stringify(fixturePattern),
  );

  for (const target of [targetRoot, authoringTargetRoot]) {
    mkdirSync(target);
    writeFileSync(
      resolve(target, "package.json"),
      JSON.stringify({
        name: "uptake-e2e-target",
        private: true,
        devDependencies: { vitest: "^3.2.4" },
      }),
    );
    commitRepository(target);
  }

  writeFileSync(
    proposerStubScript,
    JSON.stringify({
      metadata: { providerId: "stub", modelId: "authoring-e2e" },
      fileCandidates: sources.flatMap((source) => [
        ...sourceFiles.map((file) => ({
          sourceId:
            source.id === "python-one" ? "source-1" : "source-2",
          path: file.path,
          roleId: file.role,
          rationale: "Deterministic E2E evidence.",
        })),
        {
          sourceId:
            source.id === "python-one" ? "source-1" : "source-2",
          path: "missing/provenance.md",
          roleId: "spec-artifact",
          rationale: "Unresolved candidate for AC-C9.",
        },
      ]),
      contrast: {
        roles: sourceFiles.map((file) => ({
          id: file.role,
          description: `Observed ${file.role} role.`,
        })),
        bindingPoints: [
          {
            id: "spec-format",
            description: "Specification file format.",
            kind: "spec-format",
          },
          {
            id: "checker",
            description: "Verification runner.",
            kind: "checker",
          },
          {
            id: "gate-location",
            description: "Blocking gate location.",
            kind: "gate-location",
          },
          {
            id: "naming",
            description: "Specification naming convention.",
            kind: "naming",
          },
        ],
      },
      narrative: {
        violation: "A material change lacks its declaration.",
        tradeoffs:
          "Observed in successful repositories; survivorship bias remains.",
      },
    }),
  );
  writeFileSync(
    unresolvedProposerStubScript,
    JSON.stringify({
      metadata: {
        providerId: "stub",
        modelId: "authoring-e2e-unresolved",
      },
      fileCandidates: [
        {
          sourceId: "source-1",
          path: "missing/provenance.md",
          roleId: "method",
          rationale: "Unresolved-only candidate for AC-C9.",
        },
      ],
    }),
  );

  return {
    root,
    catalogDir,
    sourceRoot,
    targetRoot,
    authoringTargetRoot,
    proposerStubScript,
    unresolvedProposerStubScript,
  };
}
