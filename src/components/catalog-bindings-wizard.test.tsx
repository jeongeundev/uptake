import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApplyResultView,
  BindingsView,
  CatalogView,
  PreparedView,
  VerifyResultView,
  approveAndApply,
  bindingsComplete,
  postWorkflowAction,
  type CatalogResponse,
} from "@/components/catalog-bindings-wizard";

const pattern = {
  schemaVersion: 1 as const,
  patternId: "spec-gate",
  name: "Spec gate",
  capability: "generative" as const,
  evidenceStatus: "corroborated" as const,
  intent: "Keep declarations and changes aligned.",
  roles: [{ id: "gate", description: "Blocking gate" }],
  bindingPoints: [],
  sources: [
    {
      id: "seed",
      repository: "github.com/example/seed",
      revision: "0123456789012345678901234567890123456789",
      stack: "php/pest",
      isTargetStack: false,
      independenceGroup: "seed",
      independenceNote: "Independent fixture.",
    },
  ],
  provenance: [
    { sourceId: "seed", path: "tests/SpecGate.php", observedRole: "gate" },
  ],
  oracle: {
    violation: "Missing declaration",
    gateTestId: "spec-gate",
    injection: {
      operation: "replace" as const,
      targetRole: "gate",
      marker: "MARKER",
      replacement: "VIOLATION",
    },
    expect: "red" as const,
  },
  tradeoffs: "Adds maintenance cost and reflects survivor-biased sources.",
};

function catalogFixture(): CatalogResponse {
  return {
    loaded: [
      { pattern, generationEnabled: true },
      {
        pattern: {
          ...pattern,
          patternId: "observed-gate",
          evidenceStatus: "observed",
        },
        generationEnabled: false,
      },
      {
        pattern: {
          ...pattern,
          patternId: "descriptive-practice",
          capability: "descriptive",
          oracle: undefined,
        },
        generationEnabled: false,
      },
    ],
    rejected: [
      {
        file: "rejected.json",
        reason: "provenance-unresolved",
        detail: "source revision does not resolve",
      },
    ],
  };
}

describe("catalog and bindings UI", () => {
  it("shows every pattern but enables only generative corroborated patterns (AC-3)", () => {
    const markup = renderToStaticMarkup(
      <CatalogView
        catalog={catalogFixture()}
        selectedPatternId={null}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Spec gate");
    expect(markup).toContain("observed-gate");
    expect(markup).toContain("descriptive-practice");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain(
      "Generation requires a generative, corroborated pattern.",
    );
  });

  it("renders tradeoffs, local provenance, and rejected provenance details", () => {
    const markup = renderToStaticMarkup(
      <CatalogView
        catalog={catalogFixture()}
        selectedPatternId={null}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Adds maintenance cost");
    expect(markup).toContain("github.com/example/seed");
    expect(markup).toContain("0123456789012345678901234567890123456789");
    expect(markup).toContain("tests/SpecGate.php");
    expect(markup).toContain("rejected.json");
    expect(markup).toContain("provenance-unresolved");
    expect(markup).toContain("source revision does not resolve");
    expect(markup).not.toContain('href="tests/SpecGate.php"');
  });

  it("shows detected evidence and blocks unresolved empty values (AC-4)", () => {
    const bindings = [
      {
        bindingId: "checker",
        kind: "checker" as const,
        status: "detected" as const,
        value: "vitest",
        evidence: [{ path: "package.json" }],
      },
      {
        bindingId: "spec-format",
        kind: "spec-format" as const,
        status: "binding-unresolved" as const,
      },
    ];
    const markup = renderToStaticMarkup(
      <BindingsView
        bindings={bindings}
        values={{}}
        saving={false}
        onChange={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(markup).toContain("vitest");
    expect(markup).toContain("detected");
    expect(markup).toContain("package.json");
    expect(markup).toContain("binding-unresolved");
    expect(markup).toContain('name="spec-format"');
    expect(markup).toContain('disabled=""');
    expect(bindingsComplete(bindings, {})).toBe(false);
    expect(bindingsComplete(bindings, { "spec-format": "markdown" })).toBe(
      true,
    );
  });
});

describe("verify and apply UI", () => {
  const prepared = {
    status: "prepared" as const,
    frozenArgv: ["node", "vitest.mjs", "run", "generated/spec-gate.test.ts"],
    cwd: "temporary workspace outside the target repository" as const,
    timeoutMs: 30_000,
    files: [
      {
        operation: "add" as const,
        path: "generated/spec-gate.test.ts",
        role: "spec-check",
        content: "VERIFIED FILE CONTENT",
      },
    ],
  };

  it("shows frozen argv, cwd, and timeout before the execute control (AC-12)", () => {
    const markup = renderToStaticMarkup(
      <PreparedView prepared={prepared} executing={false} onExecute={() => undefined} />,
    );

    for (const argument of prepared.frozenArgv) {
      expect(markup).toContain(argument);
    }
    expect(markup).toContain(prepared.cwd);
    expect(markup).toContain("30000 ms");
    expect(markup.indexOf("30000 ms")).toBeLessThan(
      markup.indexOf("이식 실행"),
    );
    expect(markup).not.toContain(prepared.files[0].content);
    expect(markup).not.toContain("승인 및 적용");
  });

  it("posts no client argv, files, or approval boolean", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const status = String(input).endsWith("/approve")
        ? "approved"
        : "awaiting-approval";
      return new Response(JSON.stringify({ status }));
    };

    await postWorkflowAction("workflow-1", "prepare", request);
    await postWorkflowAction("workflow-1", "execute", request);
    await approveAndApply("workflow-1", request);

    expect(calls.map(([url]) => String(url))).toEqual([
      "/api/workflows/workflow-1/prepare",
      "/api/workflows/workflow-1/execute",
      "/api/workflows/workflow-1/approve",
      "/api/workflows/workflow-1/apply",
    ]);
    expect(calls.every(([, init]) => init?.method === "POST")).toBe(true);
    expect(calls.every(([, init]) => init?.body === undefined)).toBe(true);
  });

  it("does not request apply when server approval is absent (AC-10)", async () => {
    const urls: string[] = [];
    const request = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ status: "not-verified", detail: "verification required" }),
      );
    };

    expect(await approveAndApply("workflow-1", request)).toEqual({
      status: "not-verified",
      detail: "verification required",
    });
    expect(urls).toEqual(["/api/workflows/workflow-1/approve"]);
  });

  it.each([
    ["positive-failed", "준수 상태의 게이트가 통과하지 못했습니다."],
    ["injection-failed", "판별 위반을 생성물에 심지 못했습니다."],
    ["gate-error", "게이트가 판정 가능한 결과를 만들지 못했습니다."],
    ["negative-not-caught", "게이트가 심은 위반을 잡지 못했습니다."],
    ["timeout", "게이트 실행이 제한 시간을 초과했습니다."],
  ] as const)("renders %s as a blocking result with its detail", (status, copy) => {
    const markup = renderToStaticMarkup(
      <VerifyResultView
        files={prepared.files}
        applying={false}
        onApproveAndApply={() => undefined}
        result={{ status, detail: `${status} detail` }}
      />,
    );

    expect(markup).toContain("text-red-400");
    expect(markup).toContain(copy);
    expect(markup).toContain(`${status} detail`);
    expect(markup).not.toContain("승인 및 적용");
    expect(markup).not.toContain(prepared.files[0].content);
  });

  it("shows only the verified add-only diff and approval control on success (AC-9/10)", () => {
    const markup = renderToStaticMarkup(
      <VerifyResultView
        files={prepared.files}
        applying={false}
        onApproveAndApply={() => undefined}
        result={{
          status: "awaiting-approval",
          contentHash: "verified-hash",
          frozenArgv: prepared.frozenArgv,
          positiveLog: "/tmp/positive.json",
          negativeLog: "/tmp/negative.json",
        }}
      />,
    );

    expect(markup).toContain("text-green-400");
    expect(markup).toContain("양성 green과 음성 red가 확인되었습니다.");
    expect(markup).toContain("add");
    expect(markup).toContain(prepared.files[0].path);
    expect(markup).toContain(prepared.files[0].role);
    expect(markup).toContain(prepared.files[0].content);
    expect(markup).toContain("승인 및 적용");
  });

  it("shows completed files and exact apply rejection details", () => {
    const completed = renderToStaticMarkup(
      <ApplyResultView result={{ status: "completed", written: ["generated/spec-gate.test.ts"] }} />,
    );
    const rejected = renderToStaticMarkup(
      <ApplyResultView result={{ status: "diff-mismatch", detail: "verified content changed" }} />,
    );

    expect(completed).toContain("generated/spec-gate.test.ts");
    expect(rejected).toContain("diff-mismatch");
    expect(rejected).toContain("verified content changed");
  });
});
