// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveAndRegisterDraft,
  default as AuthoringWizard,
  DraftReview,
  RegistrationButton,
  RegistrationResultView,
  type DraftedResponse,
} from "@/components/authoring-wizard";
import type { AuthoringRequest } from "@/types/authoring";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

const authoringRequest: AuthoringRequest = {
  patternId: "observed-loop",
  name: "Observed loop",
  intent: "Observe a loop",
  capability: "descriptive",
  evidenceStatus: "observed",
  sources: [
    {
      id: "source-1",
      repository: "example/one",
      stack: "php/pest",
      isTargetStack: false,
      independenceGroup: "group-one",
      independenceNote: "Independent maintainer.",
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function fillValidRequest(): void {
  fireEvent.change(screen.getByLabelText("patternId"), {
    target: { value: "observed-loop" },
  });
  fireEvent.change(screen.getByLabelText("name"), {
    target: { value: "Observed loop" },
  });
  fireEvent.change(screen.getByLabelText("intent"), {
    target: { value: "Observe a loop" },
  });
  fireEvent.change(screen.getByLabelText("repository"), {
    target: { value: "example/one" },
  });
  fireEvent.change(screen.getByLabelText("stack"), {
    target: { value: "php/pest" },
  });
  fireEvent.change(screen.getByLabelText("independenceGroup"), {
    target: { value: "group-one" },
  });
  fireEvent.change(screen.getByLabelText("independenceNote"), {
    target: { value: "Independent maintainer." },
  });
  fireEvent.change(screen.getByLabelText("isTargetStack"), {
    target: { value: "false" },
  });
}

async function createDraftThroughWizard(
  request: ReturnType<typeof vi.fn>,
): Promise<void> {
  vi.stubGlobal("fetch", request);
  render(<AuthoringWizard />);
  fillValidRequest();
  fireEvent.click(screen.getByRole("button", { name: "초안 생성" }));
  await screen.findByLabelText("저작 초안 검토");
}

describe("AuthoringWizard", () => {
  it("creates, reviews, approves, and registers a draft through fetch-backed controls", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/approve")) return jsonResponse({ status: "approved" });
      if (url.endsWith("/register")) {
        return jsonResponse({
          status: "registered",
          path: "catalog/observed-loop.json",
        });
      }
      return jsonResponse(draft);
    });

    await createDraftThroughWizard(request);

    expect(screen.getByText("Checks the specification.")).toBeTruthy();
    expect(screen.getByText(/tests\/spec\.php/)).toBeTruthy();
    expect(screen.getByText(/distinct 2/)).toBeTruthy();
    expect(screen.getByText(/missing\.md/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "초안 승인" }));
    await screen.findByRole("button", { name: "서버 승인 완료" });
    fireEvent.click(screen.getByRole("button", { name: "카탈로그 등재" }));
    await screen.findByText("카탈로그에 등재되었습니다.");

    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/authoring/drafts",
      "/api/authoring/drafts/draft-1/approve",
      "/api/authoring/drafts/draft-1/register",
    ]);
    expect(
      request.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([
      { request: authoringRequest },
      { request: authoringRequest },
    ]);
  });

  it("removes stale review and registration controls when any request input or source list changes", async () => {
    const request = vi.fn(async () => jsonResponse(draft));
    await createDraftThroughWizard(request);

    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Changed name" },
    });
    expect(screen.queryByLabelText("저작 초안 검토")).toBeNull();
    expect(screen.queryByRole("button", { name: "카탈로그 등재" })).toBeNull();
    expect(request.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/authoring/drafts",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "초안 생성" }));
    await screen.findByLabelText("저작 초안 검토");
    fireEvent.click(screen.getByRole("button", { name: "소스 추가" }));
    expect(screen.queryByLabelText("저작 초안 검토")).toBeNull();
    expect(screen.queryByRole("button", { name: "카탈로그 등재" })).toBeNull();
  });

  it("sends the current authoring request when approving a draft", async () => {
    const request = vi.fn(
      async (input: RequestInfo | URL) =>
        jsonResponse(
          String(input).endsWith("/approve")
            ? { status: "approved" }
            : draft,
        ),
    );
    await createDraftThroughWizard(request);

    fireEvent.click(screen.getByRole("button", { name: "초안 승인" }));
    await screen.findByRole("button", { name: "서버 승인 완료" });

    const approveCall = request.mock.calls.find(([input]) =>
      String(input).endsWith("/approve"),
    );
    expect(JSON.parse(String(approveCall?.[1]?.body))).toEqual({
      request: authoringRequest,
    });
  });

  it("shows stale input as an error and never as successful registration", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/approve")) return jsonResponse({ status: "approved" });
      if (url.endsWith("/register")) {
        return jsonResponse({
          status: "stale-input",
          detail: "fingerprint mismatch",
        });
      }
      return jsonResponse(draft);
    });
    await createDraftThroughWizard(request);

    fireEvent.click(screen.getByRole("button", { name: "초안 승인" }));
    await screen.findByRole("button", { name: "서버 승인 완료" });
    fireEvent.click(screen.getByRole("button", { name: "카탈로그 등재" }));

    await screen.findByText("stale-input");
    expect(
      screen.getByText(
        "입력이 바뀌어 이전 초안이 무효가 되었습니다. 새 초안을 생성하세요.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("카탈로그에 등재되었습니다."),
    ).toBeNull();
  });

  it("keeps the draft visible until reject succeeds, then removes its controls", async () => {
    let finishReject: ((response: Response) => void) | undefined;
    const request = vi.fn(
      (input: RequestInfo | URL): Promise<Response> => {
        if (String(input).endsWith("/reject")) {
          return new Promise((resolve) => {
            finishReject = resolve;
          });
        }
        return Promise.resolve(jsonResponse(draft));
      },
    );
    await createDraftThroughWizard(request);

    fireEvent.click(screen.getByRole("button", { name: "초안 거부" }));
    expect(screen.getByLabelText("저작 초안 검토")).toBeTruthy();
    expect(finishReject).toBeTypeOf("function");

    finishReject?.(jsonResponse({ status: "rejected" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("저작 초안 검토")).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "초안 승인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "카탈로그 등재" })).toBeNull();
  });

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

    await expect(
      approveAndRegisterDraft("draft-1", authoringRequest, request),
    ).resolves.toEqual({
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
