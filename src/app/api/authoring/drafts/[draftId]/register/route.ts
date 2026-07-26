import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  readJson,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import {
  isAuthoringRequest,
  registerAuthoringDraft,
} from "@/services/authoring-store";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ draftId: string }> },
) {
  const sessionId = sessionIdFor(request);
  const { draftId } = await context.params;
  const body = await readJson(request);
  if (
    body === undefined ||
    Object.keys(body).length !== 1 ||
    !isAuthoringRequest(body.request)
  ) {
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: "invalid authoring request" },
      400,
    );
  }
  const result = registerAuthoringDraft(sessionId, draftId, body.request);
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
