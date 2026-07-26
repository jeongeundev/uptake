import { describe, expect, it } from "vitest";

import { createStubProposer } from "@/services/proposer-stub";
import type { AuthoringRequest, Evidence, Source } from "@/types/authoring";

import { contrastEvidence } from "./abstract";
import type { ExtractResult } from "./extract";

const roles = [
  { id: "blocking-gate", description: "Blocking gate." },
  { id: "spec-artifact", description: "Specification artifact." },
  { id: "spec-check", description: "Specification-bound check." },
];

function sources(secondGroup = "group-two"): Source[] {
  return [
    {
      id: "source-one",
      repository: "github.com/example/one",
      revision: "a".repeat(40),
      stack: "php/pest",
      isTargetStack: false,
      independenceGroup: "group-one",
      independenceNote: "User classified source one.",
    },
    {
      id: "source-two",
      repository: "github.com/example/two",
      revision: "b".repeat(40),
      stack: "typescript/vitest",
      isTargetStack: true,
      independenceGroup: secondGroup,
      independenceNote: "User classified source two.",
    },
  ];
}

function evidence(roleIds = roles.map(({ id }) => id)): Evidence[] {
  return roleIds.flatMap((roleId) => [
    {
      sourceId: "source-one",
      path: `${roleId}-one.md`,
      roleId,
      content: `${roleId} in source one`,
    },
    {
      sourceId: "source-two",
      path: `${roleId}-two.md`,
      roleId,
      content: `${roleId} in source two`,
    },
  ]);
}

function request(
  overrides: Partial<AuthoringRequest> = {},
): AuthoringRequest {
  return {
    patternId: "authored-pattern",
    name: "Authored pattern",
    intent: "Keep specification and verification connected.",
    capability: "generative",
    evidenceStatus: "corroborated",
    sources: sources().map(
      ({
        id,
        repository,
        stack,
        isTargetStack,
        independenceGroup,
        independenceNote,
      }) => ({
        id,
        repository,
        stack,
        isTargetStack,
        independenceGroup,
        independenceNote,
      }),
    ),
    ...overrides,
  };
}

function extracted(
  sourceValues = sources(),
  evidenceValues = evidence(),
): Extract<ExtractResult, { ok: true }> {
  return {
    ok: true,
    sources: sourceValues,
    evidence: evidenceValues,
    discarded: [],
    targetStackFacts: [],
  };
}

function proposer() {
  return createStubProposer({
    contrast: {
      roles,
      bindingPoints: [
        {
          id: "checker",
          description: "Observed checker choice.",
          kind: "checker",
        },
      ],
    },
    narrative: {
      violation: "unused until oracle authoring",
      tradeoffs: "Observed in successful repositories; causality is unknown.",
    },
  });
}

describe("contrastEvidence", () => {
  it("assembles a corroborated anchor draft from two user-defined groups", async () => {
    const result = await contrastEvidence(request(), extracted(), proposer());

    expect(result).toMatchObject({
      ok: true,
      draft: {
        capability: "generative",
        evidenceStatus: "corroborated",
        roles,
        tradeoffs:
          "Observed in successful repositories; causality is unknown.",
      },
      corroboration: {
        independenceGroups: ["group-one", "group-two"],
        nonTargetStackSourceIds: ["source-one"],
        perRole: roles.map(({ id }) => ({
          roleId: id,
          independenceGroups: ["group-one", "group-two"],
        })),
        demoted: [],
      },
    });
    if (result.ok) {
      expect(result.draft).not.toHaveProperty("oracle");
      expect(result.draft.provenance).toHaveLength(6);
    }
  });

  it("demotes a descriptive role supported by one group into a binding", async () => {
    const descriptiveRoles = [
      { id: "shared-role", description: "Shared practice." },
      { id: "local-role", description: "Repository-specific practice." },
    ];
    const result = await contrastEvidence(
      request({ capability: "descriptive" }),
      extracted(sources(), [
        ...evidence(["shared-role"]),
        {
          sourceId: "source-one",
          path: "local.md",
          roleId: "local-role",
          content: "local",
        },
      ]),
      createStubProposer({
        contrast: { roles: descriptiveRoles, bindingPoints: [] },
        narrative: { violation: "", tradeoffs: "Observed tradeoff." },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      draft: {
        roles: [{ id: "shared-role" }],
        bindingPoints: [{ id: "local-role", kind: "naming" }],
      },
      corroboration: {
        demoted: [
          {
            roleId: "local-role",
            reason: "single-independence-group",
          },
        ],
      },
    });
  });

  it("fails rather than changing a generative draft to descriptive after demotion", async () => {
    const sparse = evidence().filter(
      ({ sourceId, roleId }) =>
        roleId !== "blocking-gate" || sourceId === "source-one",
    );
    const result = await contrastEvidence(
      request(),
      extracted(sources(), sparse),
      proposer(),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "role-evidence-insufficient",
      corroboration: {
        demoted: [
          {
            roleId: "blocking-gate",
            reason: "single-independence-group",
          },
        ],
      },
    });
  });

  it("ignores non-anchor proposer roles in generative authoring", async () => {
    const scripted = createStubProposer({
      contrast: {
        roles: [
          ...roles,
          { id: "invented-role", description: "Unsupported role." },
        ],
        bindingPoints: [],
      },
      narrative: { violation: "", tradeoffs: "Observed tradeoff." },
    });
    const result = await contrastEvidence(request(), extracted(), scripted);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.roles.map(({ id }) => id)).toEqual([
        "blocking-gate",
        "spec-artifact",
        "spec-check",
      ]);
    }
  });

  it("uses the user's independence groups without inferring them", async () => {
    const sameGroupSources = sources("group-one");
    const first = await contrastEvidence(
      request({
        sources: sameGroupSources.map(
          ({
            id,
            repository,
            stack,
            isTargetStack,
            independenceGroup,
            independenceNote,
          }) => ({
            id,
            repository,
            stack,
            isTargetStack,
            independenceGroup,
            independenceNote,
          }),
        ),
      }),
      extracted(sameGroupSources),
      proposer(),
    );
    const second = await contrastEvidence(request(), extracted(), proposer());

    expect(first).toMatchObject({
      ok: false,
      reason: "role-evidence-insufficient",
      corroboration: { independenceGroups: ["group-one"] },
    });
    expect(second).toMatchObject({
      ok: true,
      corroboration: {
        independenceGroups: ["group-one", "group-two"],
      },
    });
  });

  it("does not demote roles for observed authoring", async () => {
    const observedSources = [sources()[0]];
    const observedEvidence = evidence().filter(
      ({ sourceId }) => sourceId === "source-one",
    );
    const result = await contrastEvidence(
      request({
        evidenceStatus: "observed",
        sources: request().sources.slice(0, 1),
      }),
      extracted(observedSources, observedEvidence),
      proposer(),
    );

    expect(result).toMatchObject({
      ok: true,
      draft: { evidenceStatus: "observed", roles },
      corroboration: { demoted: [] },
    });
  });

  it("reports missing anchor evidence before assembling a draft", async () => {
    const result = await contrastEvidence(
      request(),
      extracted(sources(), evidence(["spec-artifact", "spec-check"])),
      proposer(),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "anchor-role-missing",
    });
  });

  it("rejects an orphan source before catalog writing", async () => {
    const orphan = {
      ...sources()[1],
      id: "source-three",
      repository: "github.com/example/three",
    };
    const result = await contrastEvidence(
      request({ evidenceStatus: "observed" }),
      extracted([...sources(), orphan]),
      proposer(),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "reference-invalid",
    });
  });

  it("returns no-roles when descriptive proposals have no evidenced role", async () => {
    const result = await contrastEvidence(
      request({ capability: "descriptive" }),
      extracted(),
      createStubProposer({
        contrast: {
          roles: [{ id: "unseen-role", description: "No evidence." }],
          bindingPoints: [],
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "no-roles" });
  });
});
