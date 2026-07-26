import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  readJson,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { configuredSurveyProposer } from "@/app/api/survey/proposer";
import {
  AnthropicProposerConfigurationError,
  AnthropicProposerResponseError,
} from "@/services/proposer-anthropic";
import { runSurvey } from "@/services/survey-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = sessionIdFor(request);
  const body = await readJson(request);
  if (
    body === undefined ||
    Object.keys(body).length !== 1 ||
    typeof body.repository !== "string" ||
    body.repository.trim().length === 0
  ) {
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: "invalid survey request" },
      400,
    );
  }

  let proposer;
  try {
    proposer = configuredSurveyProposer();
  } catch (error) {
    if (!(error instanceof AnthropicProposerConfigurationError)) throw error;
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: error.message },
      400,
    );
  }
  let result;
  try {
    result = await runSurvey(sessionId, body.repository, proposer);
  } catch (error) {
    if (!(error instanceof AnthropicProposerResponseError)) throw error;
    return jsonWithSession(
      request,
      sessionId,
      { status: "proposer-response-error", detail: error.message },
      502,
    );
  }
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
