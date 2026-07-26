import { hasAnchorRoleShape } from "@/lib/engine/anchor-shape";
import type { Pattern } from "@/types/pattern";

const DEFAULT_VIOLATION =
  "선언 목록이 비어 있는데도 게이트가 통과하는 상태.";

const ANCHOR_ORACLE_EXECUTION = {
  gateTestId: "declared-change-present",
  injection: {
    operation: "replace" as const,
    targetRole: "spec-artifact",
    marker:
      '/* @uptake:marker:begin */ "seed-change" /* @uptake:marker:end */',
    replacement: "",
  },
  expect: "red" as const,
};

export function draftAnchorOracle(
  pattern: Pattern,
  violation: string,
):
  | { ok: true; pattern: Pattern }
  | { ok: false; reason: "not-anchor-shape"; detail: string } {
  if (
    pattern.capability !== "generative" ||
    !hasAnchorRoleShape(pattern)
  ) {
    return {
      ok: false,
      reason: "not-anchor-shape",
      detail: "a generative draft with the exact anchor role shape is required",
    };
  }

  return {
    ok: true,
    pattern: {
      ...pattern,
      oracle: {
        violation: violation.trim().length > 0 ? violation : DEFAULT_VIOLATION,
        ...ANCHOR_ORACLE_EXECUTION,
      },
    },
  };
}
