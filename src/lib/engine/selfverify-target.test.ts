import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { materializeSelfVerifyTarget } from "@/lib/engine/selfverify-target";

describe("materializeSelfVerifyTarget", () => {
  it("disposes only the root created by the call", async () => {
    const target = await materializeSelfVerifyTarget();

    expect(existsSync(target.root)).toBe(true);
    await target.dispose();
    expect(existsSync(target.root)).toBe(false);
  });
});
