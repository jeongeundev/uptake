import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { GET as getCatalog } from "@/app/api/catalog/route";
import { POST as createWorkflow } from "@/app/api/workflows/route";

describe("workflow route boundary", () => {
  it("creates a strict HttpOnly session cookie on the first request", async () => {
    const response = await getCatalog(
      new NextRequest("http://localhost/api/catalog"),
    );
    expect(response.headers.get("set-cookie")).toMatch(
      /^uptake-session=[^;]+; Path=\/; HttpOnly; SameSite=strict/i,
    );
  });

  it("returns a stable JSON error for untrusted workflow payloads", async () => {
    const response = await createWorkflow(
      new NextRequest("http://localhost/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          patternId: "spec-change-declaration-gate",
          targetRepoRoot: "/tmp/target",
          generated: [{ path: "forged.ts", content: "forged" }],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid-request",
      detail: "patternId and targetRepoRoot are the only accepted fields",
    });
  });
});
