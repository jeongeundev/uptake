import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  approveAndRegisterDraft,
  DraftReview,
  RegistrationButton,
  RegistrationResultView,
  type DraftedResponse,
} from "@/components/authoring-wizard";

const draft: DraftedResponse = {
  status: "drafted",
  draftId: "draft-1",
  pattern: {
    schemaVersion: 1,
    patternId: "observed-loop",
    name: "Observed loop",
    capability: "descriptive",
    evidenceStatus: "corroborated",
    intent: "Observe a loop",
    roles: [{ id: "spec-check", description: "Checks the specification." }],
    bindingPoints: [
      { id: "checker", description: "Checker choice.", kind: "checker" },
    ],
    sources: [
      {
        id: "source-one",
        repository: "example/one",
        revision: "a".repeat(40),
        stack: "php/pest",
        isTargetStack: false,
        independenceGroup: "group-one",
        independenceNote: "Independent maintainer.",
      },
      {
        id: "source-two",
        repository: "example/two",
        revision: "b".repeat(40),
        stack: "typescript/vitest",
        isTargetStack: true,
        independenceGroup: "group-two",
        independenceNote: "Independent maintainer.",
      },
    ],
    provenance: [
      { sourceId: "source-one", path: "tests/spec.php", observedRole: "spec-check" },
      { sourceId: "source-two", path: "tests/spec.test.ts", observedRole: "spec-check" },
    ],
    tradeoffs: "Observed in successful repositories; causality is not established.",
  },
  corroboration: {
    independenceGroups: ["group-one", "group-two"],
    nonTargetStackSourceIds: ["source-one"],
    perRole: [
      { roleId: "spec-check", independenceGroups: ["group-one", "group-two"] },
    ],
    demoted: [
      { roleId: "blocking-gate", reason: "single-independence-group" },
    ],
  },
  targetStackFacts: [
    {
      sourceId: "source-two",
      vitestObserved: true,
      evidencePaths: ["package.json"],
    },
  ],
  discarded: [
    {
      sourceId: "source-one",
      path: "missing.md",
      reason: "provenance-unresolved",
    },
  ],
  selfVerify: { status: "skipped", reason: "descriptive" },
  proposer: { providerId: "stub", modelId: "deterministic" },
};

describe("AuthoringWizard", () => {
  it("shows the draft evidence, corroboration calculation, demotion, and discarded candidates", () => {
    const markup = renderToStaticMarkup(
      <DraftReview approved={false} draft={draft} onApprove={() => undefined} />,
    );

    expect(markup).toContain("Checks the specification.");
    expect(markup).toContain("tests/spec.php");
    expect(markup).toContain("group-one");
    expect(markup).toContain("group-two");
    expect(markup).toContain("입력한 independenceGroup을 센 결과");
    expect(markup).toContain("blocking-gate");
    expect(markup).toContain("single-independence-group");
    expect(markup).toContain("missing.md");
    expect(markup).toContain("provenance-unresolved");
    expect(markup).toContain("vitest가 관찰됨");
    expect(markup).toContain("package.json");
  });

  it("does not enable approval when self verification failed", () => {
    const failed: DraftedResponse = {
      ...draft,
      selfVerify: {
        status: "failed",
        detail: "negative-not-caught: violation remained green",
      },
    };
    const markup = renderToStaticMarkup(
      <DraftReview approved={false} draft={failed} onApprove={() => undefined} />,
    );

    expect(markup).toContain("text-red-400");
    expect(markup).toContain("negative-not-caught");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("text-green-400");
  });

  it("does not request registration until server approval succeeds", async () => {
    const calls: string[] = [];
    const request = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ status: "draft-not-found", detail: "not pending" }),
      );
    };

    await expect(approveAndRegisterDraft("draft-1", request)).resolves.toEqual({
      status: "draft-not-found",
      detail: "not pending",
    });
    expect(calls).toEqual(["/api/authoring/drafts/draft-1/approve"]);

    const markup = renderToStaticMarkup(
      <RegistrationButton
        approved={false}
        busy={false}
        onRegister={() => undefined}
      />,
    );
    expect(markup).toContain("disabled");
  });

  it("reports pattern collisions and says the existing pattern was unchanged", () => {
    const markup = renderToStaticMarkup(
      <RegistrationResultView
        result={{
          status: "register-rejected",
          detail: "pattern-exists: observed-loop already exists",
        }}
      />,
    );

    expect(markup).toContain("pattern-exists");
    expect(markup).toContain("기존 패턴은 변경되지 않았습니다.");
    expect(markup).toContain("text-red-400");
  });
});
