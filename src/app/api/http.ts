import { NextRequest, NextResponse } from "next/server";

import { createSession } from "@/services/workflow-store";

const sessionCookie = "uptake-session";

export function sessionIdFor(request: NextRequest): string {
  return request.cookies.get(sessionCookie)?.value ?? createSession();
}

export function jsonWithSession(
  request: NextRequest,
  sessionId: string,
  body: unknown,
  status = 200,
): NextResponse {
  const response = NextResponse.json(body, { status });
  if (request.cookies.get(sessionCookie) === undefined) {
    response.cookies.set(sessionCookie, sessionId, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return response;
}

export function withSession(
  request: NextRequest,
  body: unknown,
  status = 200,
): { response: NextResponse; sessionId: string } {
  const sessionId = sessionIdFor(request);
  const response = jsonWithSession(request, sessionId, body, status);
  return { response, sessionId };
}

export async function readJson(
  request: NextRequest,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function statusCode(status: string): number {
  if (status === "workflow-not-found" || status === "pattern-not-found") {
    return 404;
  }
  if (
    status === "invalid-request" ||
    status === "generation-blocked" ||
    status === "target-ineligible" ||
    status === "not-prepared" ||
    status === "not-verified" ||
    status === "not-approved"
  ) {
    return 400;
  }
  return 200;
}
