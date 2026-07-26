import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { draftAnchorOracle } from "@/lib/engine/oracle-draft";
import type { Pattern } from "@/types/pattern";

const seed = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;
const draft: Pattern = { ...seed, oracle: undefined };

describe("draftAnchorOracle", () => {
  it("attaches the deterministic seed execution contract to an anchor draft", () => {
    const result = draftAnchorOracle(draft, "관찰된 위반 서술");

    expect(result).toEqual({
      ok: true,
      pattern: {
        ...draft,
        oracle: {
          ...seed.oracle,
          violation: "관찰된 위반 서술",
        },
      },
    });
  });

  it("rejects a non-anchor role shape", () => {
    const result = draftAnchorOracle(
      {
        ...draft,
        roles: draft.roles.filter(({ id }) => id !== "blocking-gate"),
      },
      "관찰된 위반 서술",
    );

    expect(result).toMatchObject({ ok: false, reason: "not-anchor-shape" });
  });

  it("does not attach an oracle to a descriptive draft", () => {
    const result = draftAnchorOracle(
      { ...draft, capability: "descriptive" },
      "관찰된 위반 서술",
    );

    expect(result).toMatchObject({ ok: false, reason: "not-anchor-shape" });
  });

  it("uses a descriptive default when the proposed violation is blank", () => {
    const result = draftAnchorOracle(draft, "  ");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pattern.oracle?.violation).toBe(
        "선언 목록이 비어 있는데도 게이트가 통과하는 상태.",
      );
    }
  });
});
