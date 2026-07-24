import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { withSession } from "@/app/api/http";

describe("API session response", () => {
  it("reuses an existing session without replacing its cookie", () => {
    const request = new NextRequest("http://localhost/api/test", {
      headers: { cookie: "uptake-session=existing-session" },
    });
    const { response, sessionId } = withSession(request, { status: "ok" });
    expect(sessionId).toBe("existing-session");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
