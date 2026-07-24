import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { applyWorkflow } from "@/services/workflow-store";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  const sessionId = sessionIdFor(request);
  const { workflowId } = await context.params;
  const result = applyWorkflow(sessionId, workflowId);
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
