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
import { AnthropicProposerConfigurationError } from "@/services/proposer-anthropic";

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
  let proposer;
  try {
    proposer = configuredAuthoringProposer();
  } catch (error) {
    if (!(error instanceof AnthropicProposerConfigurationError)) {
      throw error;
    }
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: error.message },
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
