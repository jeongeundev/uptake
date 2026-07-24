import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  readJson,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { mergeWorkflowBindings } from "@/services/workflow-store";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  const sessionId = sessionIdFor(request);
  const body = await readJson(request);
  if (
    body === undefined ||
    Object.keys(body).length !== 1 ||
    typeof body.values !== "object" ||
    body.values === null ||
    Array.isArray(body.values) ||
    !Object.values(body.values).every(
      (value) => typeof value === "string",
    )
  ) {
    return jsonWithSession(
      request,
      sessionId,
      { status: "invalid-request", detail: "values must be a string map" },
      400,
    );
  }
  const { workflowId } = await context.params;
  const result = mergeWorkflowBindings(
    sessionId,
    workflowId,
    body.values as Record<string, string>,
  );
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
