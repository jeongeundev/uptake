import { describe, expect, it } from "vitest";

import {
  createStubProposer,
  createStubSurveyProposer,
} from "@/services/proposer-stub";
import type {
  ContrastRequest,
  FileCandidateRequest,
  NarrativeRequest,
  SurveyRequest,
} from "@/services/proposer";
import type { SurveyCandidate } from "@/types/survey";

const fileRequest: FileCandidateRequest = {
  intent: "keep specs aligned",
  sourceId: "source-a",
  repository: "github.com/example/source-a",
  revision: "a".repeat(40),
  files: ["spec.md"],
  roleIds: ["spec-artifact"],
};

const contrastRequest: ContrastRequest = {
  intent: "keep specs aligned",
  roleIds: ["spec-artifact"],
  evidence: [],
};

const narrativeRequest: NarrativeRequest = {
  intent: "keep specs aligned",
  capability: "generative",
  roles: [],
  bindingPoints: [],
  sources: [],
};

describe("createStubProposer", () => {
  it("returns scripted adversarial candidates and records calls", async () => {
    const candidate = {
      sourceId: "source-a",
      path: "does-not-exist.md",
      roleId: "outside-anchor",
      rationale: "adversarial fixture",
    };
    const proposer = createStubProposer({ fileCandidates: [candidate] });

    await expect(proposer.proposeFileCandidates(fileRequest)).resolves.toEqual([
      candidate,
    ]);
    expect(proposer.calls.fileCandidates).toEqual([fileRequest]);
  });

  it("uses request-aware scripts for contrast and narrative", async () => {
    const proposer = createStubProposer({
      contrast: (request) => ({
        roles: [{ id: request.roleIds[0], description: request.intent }],
        bindingPoints: [],
      }),
      narrative: (request) => ({
        violation: request.capability,
        tradeoffs: request.intent,
      }),
    });

    await expect(proposer.proposeContrast(contrastRequest)).resolves.toEqual({
      roles: [
        { id: "spec-artifact", description: "keep specs aligned" },
      ],
      bindingPoints: [],
    });
    await expect(proposer.proposeNarrative(narrativeRequest)).resolves.toEqual({
      violation: "generative",
      tradeoffs: "keep specs aligned",
    });
    expect(proposer.calls.contrast).toEqual([contrastRequest]);
    expect(proposer.calls.narrative).toEqual([narrativeRequest]);
  });

  it("returns empty proposals for unspecified responses", async () => {
    const proposer = createStubProposer({});

    await expect(proposer.proposeFileCandidates(fileRequest)).resolves.toEqual(
      [],
    );
    await expect(proposer.proposeContrast(contrastRequest)).resolves.toEqual({
      roles: [],
      bindingPoints: [],
    });
    await expect(proposer.proposeNarrative(narrativeRequest)).resolves.toEqual({
      violation: "",
      tradeoffs: "",
    });
  });
});

describe("createStubSurveyProposer", () => {
  it("returns scripted candidates unchanged and records calls", async () => {
    const request: SurveyRequest = {
      repository: "github.com/example/source-a",
      revision: "a".repeat(40),
      files: [
        {
          path: "CONTRIBUTING.md",
          ruleId: "docs",
          content: "Run tests before submitting.",
        },
      ],
    };
    const candidates: SurveyCandidate[] = [
      {
        id: "test-before-submit",
        name: "Test before submit",
        intent: "Keep submitted changes verified.",
        discipline:
          "Contributors run the test suite before submitting changes.",
        tradeoffs: "Submission takes longer.",
        evidence: ["CONTRIBUTING.md"],
        confidence: "high",
      },
    ];
    const proposer = createStubSurveyProposer({ candidates });

    await expect(proposer.proposeSurveyCandidates(request)).resolves.toBe(
      candidates,
    );
    expect(proposer.calls).toEqual([request]);
  });

  it("passes adversarial candidates through without correction", async () => {
    const adversarial = [
      {
        id: "unverified",
        name: "Unverified",
        intent: "Exercise the deterministic gate.",
        discipline: "No discipline is established.",
        tradeoffs: "Unknown.",
        evidence: ["does-not-exist.md"],
        confidence: "certain",
      },
      {
        id: "empty-evidence",
        name: "Empty evidence",
        intent: "Exercise empty evidence handling.",
        discipline: "No evidence is supplied.",
        tradeoffs: "No claim can be verified.",
        evidence: [],
        confidence: "low",
      },
    ] as unknown as SurveyCandidate[];
    const proposer = createStubSurveyProposer({ candidates: adversarial });

    await expect(
      proposer.proposeSurveyCandidates({
        repository: "github.com/example/source-a",
        revision: "a".repeat(40),
        files: [],
      }),
    ).resolves.toBe(adversarial);
  });
});
