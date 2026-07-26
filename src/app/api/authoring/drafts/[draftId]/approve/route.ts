import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { approveAuthoringDraft } from "@/services/authoring-store";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ draftId: string }> },
) {
  const sessionId = sessionIdFor(request);
  const { draftId } = await context.params;
  const result = approveAuthoringDraft(sessionId, draftId);
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
