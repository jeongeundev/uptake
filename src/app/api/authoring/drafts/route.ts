import { type NextRequest } from "next/server";

import { configuredAuthoringProposer } from "@/app/api/authoring/proposer";
import {
  jsonWithSession,
  readJson,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import {
  createAuthoringDraft,
  isAuthoringRequest,
} from "@/services/authoring-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = sessionIdFor(request);
  const body = await readJson(request);
  if (!isAuthoringRequest(body)) {
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: "invalid authoring request" },
      400,
    );
  }
  const proposer = configuredAuthoringProposer();
  if (proposer === undefined) {
    return jsonWithSession(
      request,
      sessionId,
      {
        status: "invalid-request",
        detail: "authoring proposer adapter is not configured",
      },
      400,
    );
  }
  const result = await createAuthoringDraft(sessionId, body, proposer);
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
