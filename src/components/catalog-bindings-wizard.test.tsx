import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BindingsView,
  CatalogView,
  bindingsComplete,
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
