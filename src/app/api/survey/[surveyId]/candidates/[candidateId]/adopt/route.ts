import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { adoptCandidate } from "@/services/survey-service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ surveyId: string; candidateId: string }>;
  },
) {
  const sessionId = sessionIdFor(request);
  const { surveyId, candidateId } = await context.params;
  const result = await adoptCandidate(sessionId, surveyId, candidateId);
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
