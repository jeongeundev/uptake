import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { statusCode, withSession } from "@/app/api/http";

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

describe("authoring HTTP status mapping", () => {
  it("maps missing drafts to 404 and rejected transitions to 400", () => {
    expect(statusCode("draft-not-found")).toBe(404);
    expect(statusCode("not-approved")).toBe(400);
    expect(statusCode("self-verify-failed")).toBe(400);
    expect(statusCode("register-rejected")).toBe(400);
  });
});

describe("survey HTTP status mapping", () => {
  it("distinguishes missing state, invalid inputs, and server rule errors", () => {
    expect(statusCode("survey-not-found")).toBe(404);
    expect(statusCode("candidate-not-found")).toBe(404);
    expect(statusCode("repository-unresolved")).toBe(400);
    expect(statusCode("adoption-failed")).toBe(400);
    expect(statusCode("survey-rules-error")).toBe(500);
  });
});
