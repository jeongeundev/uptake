// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SurveyWizard from "@/components/survey-wizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

const surveyed = {
  status: "surveyed",
  surveyId: "survey-1",
  repository: "github.com/example/project",
  revision: "a".repeat(40),
  candidates: [
    {
      id: "spec-gate",
      name: "Spec gate",
      intent: "Keep implementation aligned with declared changes.",
      discipline: "A pre-edit hook rejects source changes without a spec.",
      tradeoffs: "Every source change needs a matching declaration.",
      evidence: ["AGENTS.md", "scripts/hooks/tdd-guard.sh"],
      confidence: "high",
    },
  ],
  collected: [],
  skipped: [],
  discardedEvidence: [],
  discardedCandidates: [],
  proposer: { providerId: "stub", modelId: "deterministic" },
};

const authoringRequest = {
  patternId: "spec-gate",
  name: "Spec gate",
  intent: "Keep implementation aligned with declared changes.",
  capability: "descriptive",
  evidenceStatus: "observed",
  sources: [
    {
      id: "source-1",
      repository: surveyed.repository,
      stack: "typescript/vitest",
      isTargetStack: true,
      independenceGroup: surveyed.repository,
      independenceNote: "Single repository observation.",
    },
  ],
};

const adopted = {
  status: "drafted",
  draftId: "draft-1",
  authoringRequest,
  pattern: {
    schemaVersion: 1,
    ...authoringRequest,
    roles: [
      {
        id: "observed-discipline",
        description: "A pre-edit hook rejects source changes without a spec.",
      },
    ],
    bindingPoints: [],
    sources: [
      {
        ...authoringRequest.sources[0],
        revision: surveyed.revision,
      },
    ],
    provenance: [
      {
        sourceId: "source-1",
        path: "scripts/hooks/tdd-guard.sh",
        observedRole: "observed-discipline",
      },
    ],
    tradeoffs: "Every source change needs a matching declaration.",
  },
  discarded: [],
  targetStackFacts: [
    {
      sourceId: "source-1",
      vitestObserved: true,
      evidencePaths: ["package.json"],
    },
  ],
};

async function surveyThroughWizard(
  request: ReturnType<typeof vi.fn>,
  response = surveyed,
): Promise<void> {
  vi.stubGlobal("fetch", request);
  render(<SurveyWizard />);
  fireEvent.change(screen.getByLabelText("저장소 식별자"), {
    target: { value: response.repository },
  });
  fireEvent.click(screen.getByRole("button", { name: "조사" }));
  await screen.findByLabelText("SURVEY 조사 결과");
}

describe("SurveyWizard", () => {
  it("renders surveyed candidates, every evidence path, revision, and visible limitations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(surveyed)));
    render(<SurveyWizard />);

    fireEvent.change(screen.getByLabelText("저장소 식별자"), {
      target: { value: surveyed.repository },
    });
    fireEvent.click(screen.getByRole("button", { name: "조사" }));

    expect(await screen.findByText("Spec gate")).toBeTruthy();
    expect(screen.getByText("AGENTS.md")).toBeTruthy();
    expect(screen.getByText("scripts/hooks/tdd-guard.sh")).toBeTruthy();
    expect(screen.getByText(surveyed.revision)).toBeTruthy();
    expect(
      screen.getByText(/만든 규율과 템플릿에서 상속된 규율을 구분하지 않습니다/),
    ).toBeTruthy();
    expect(
      screen.getByText(/이 저장소가 실제로 이렇게 한다.*까지만 주장/),
    ).toBeTruthy();
    expect(screen.getByText(/confidence는 판단 보조/)).toBeTruthy();
  });

  it("shows discarded evidence, discarded candidates, and skipped files with reasons", async () => {
    const withDiscards = {
      ...surveyed,
      discardedEvidence: [
        {
          candidateId: "spec-gate",
          path: "invented.md",
          reason: "not-collected",
        },
      ],
      discardedCandidates: [
        {
          candidateId: "empty-candidate",
          reason: "no-evidence",
          detail: "Candidate has no evidence from collected files.",
        },
      ],
      skipped: [
        {
          path: "docs/large.md",
          ruleId: "documentation",
          reason: "budget-exhausted",
        },
      ],
    };
    const request = vi.fn(async () => jsonResponse(withDiscards));

    await surveyThroughWizard(request, withDiscards);

    expect(screen.getByText(/spec-gate · invented\.md/)).toBeTruthy();
    expect(screen.getByText("not-collected")).toBeTruthy();
    expect(screen.getByText(/empty-candidate · no-evidence/)).toBeTruthy();
    expect(
      screen.getByText("Candidate has no evidence from collected files."),
    ).toBeTruthy();
    expect(screen.getByText(/documentation · docs\/large\.md/)).toBeTruthy();
    expect(screen.getByText("budget-exhausted")).toBeTruthy();
  });

  it("adopts the selected candidate and renders the server-assembled draft", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(String(input).endsWith("/adopt") ? adopted : surveyed),
    );
    await surveyThroughWizard(request);

    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "선택 후보 채택" }));

    expect(await screen.findByLabelText("SURVEY 채택 초안")).toBeTruthy();
    expect(screen.getByText(/spec-gate · Spec gate/)).toBeTruthy();
    expect(
      screen.getByText(/source-1 · scripts\/hooks\/tdd-guard\.sh/),
    ).toBeTruthy();
    expect(screen.getByText(/source-1 ·.*vitest가 관찰됨/)).toBeTruthy();
    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/survey",
      "/api/survey/survey-1/candidates/spec-gate/adopt",
    ]);
  });

  it("shows registration rejection as failure and never as success", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/adopt")) return jsonResponse(adopted);
      if (url.endsWith("/approve")) {
        return jsonResponse({ status: "approved" });
      }
      if (url.endsWith("/register")) {
        return jsonResponse({
          status: "register-rejected",
          detail: "pattern-exists: spec-gate already exists",
        });
      }
      return jsonResponse(surveyed);
    });
    await surveyThroughWizard(request);
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "선택 후보 채택" }));
    await screen.findByLabelText("SURVEY 채택 초안");

    expect(
      (screen.getByRole("button", {
        name: "카탈로그 등재",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "초안 승인" }));
    await screen.findByRole("button", { name: "서버 승인 완료" });
    fireEvent.click(screen.getByRole("button", { name: "카탈로그 등재" }));

    expect(
      await screen.findByText("카탈로그 등재에 실패했습니다."),
    ).toBeTruthy();
    expect(screen.getByText(/pattern-exists/)).toBeTruthy();
    expect(screen.getByText("기존 패턴은 변경되지 않았습니다.")).toBeTruthy();
    expect(screen.queryByText("카탈로그에 등재되었습니다.")).toBeNull();
  });
});
