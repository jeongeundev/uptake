import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { hasAnchorRoleShape } from "@/lib/engine/anchor-shape";
import type { Pattern } from "@/types/pattern";

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;

describe("hasAnchorRoleShape", () => {
  it("requires exactly the three anchor roles", () => {
    expect(hasAnchorRoleShape(pattern)).toBe(true);
    expect(
      hasAnchorRoleShape({
        ...pattern,
        roles: pattern.roles.slice(0, 2),
      }),
    ).toBe(false);
  });
});
