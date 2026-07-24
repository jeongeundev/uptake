import type { BindingDetection } from "@/lib/engine/detect";
import type { InstantiatedInjection, Pattern } from "@/types/pattern";

export type GeneratedFile = {
  path: string;
  content: string;
  role: string;
};

export type InstantiateResult =
  | {
      ok: true;
      files: GeneratedFile[];
      injection: InstantiatedInjection;
      gateTestId: string;
    }
  | {
      ok: false;
      reason:
        | "generation-failed"
        | "injection-failed"
        | "generation-blocked";
      detail: string;
    };

const supportedPatternId = "spec-change-declaration-gate";
const artifactPath = "uptake-gate/declared-changes.ts";
const gatePath = "uptake-gate/spec-gate.test.ts";

function markerOccurrences(content: string, marker: string): number {
  return marker.length === 0 ? 0 : content.split(marker).length - 1;
}

export function instantiate(
  pattern: Pattern,
  bindings: BindingDetection[],
): InstantiateResult {
  if (
    pattern.capability !== "generative" ||
    pattern.evidenceStatus !== "corroborated"
  ) {
    return {
      ok: false,
      reason: "generation-blocked",
      detail: "generation requires a generative, corroborated pattern",
    };
  }

  const checker = bindings.find(({ kind }) => kind === "checker");
  if (checker === undefined || checker.status === "binding-unresolved") {
    return {
      ok: false,
      reason: "generation-blocked",
      detail: "a resolved vitest checker binding is required",
    };
  }

  if (pattern.patternId !== supportedPatternId || pattern.oracle === undefined) {
    return {
      ok: false,
      reason: "generation-failed",
      detail: `no fixed template is available for pattern ${pattern.patternId}`,
    };
  }

  const { gateTestId, injection: injectionTemplate } = pattern.oracle;
  if (injectionTemplate.targetRole !== "spec-artifact") {
    return {
      ok: false,
      reason: "generation-failed",
      detail: `no generated file implements role ${injectionTemplate.targetRole}`,
    };
  }

  const artifact: GeneratedFile = {
    path: artifactPath,
    role: injectionTemplate.targetRole,
    content: `// 파생: patternId=${pattern.patternId}, role=spec-artifact
// 왜: 모든 실질 변경은 선언 목록에 기록되어야 하며, 게이트가 그 존재를 강제한다.
export const declaredChanges: string[] = [${injectionTemplate.marker}];
`,
  };
  const markerCount = markerOccurrences(
    artifact.content,
    injectionTemplate.marker,
  );
  if (markerCount !== 1) {
    return {
      ok: false,
      reason: "injection-failed",
      detail: `marker must appear exactly once in ${artifact.path}; found ${markerCount}`,
    };
  }

  const gate: GeneratedFile = {
    path: gatePath,
    role: "spec-check",
    content: `// 파생: patternId=${pattern.patternId}, role=spec-check
// 왜: 선언 목록이 비어 있으면 게이트가 변경 누락을 차단한다.
import { declaredChanges } from "./declared-changes";
test("${gateTestId}", () => {
  expect(declaredChanges.length).toBeGreaterThan(0);
});
`,
  };
  const injection: InstantiatedInjection = {
    operation: injectionTemplate.operation,
    path: artifact.path,
    marker: injectionTemplate.marker,
    replacement: injectionTemplate.replacement,
  };

  return {
    ok: true,
    files: [artifact, gate],
    injection,
    gateTestId,
  };
}
