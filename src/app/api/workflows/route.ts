import { type NextRequest } from "next/server";

import {
  jsonWithSession,
  readJson,
  sessionIdFor,
  statusCode,
} from "@/app/api/http";
import { createWorkflow } from "@/services/workflow-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = sessionIdFor(request);
  const body = await readJson(request);
  if (
    body === undefined ||
    Object.keys(body).some(
      (key) => key !== "patternId" && key !== "targetRepoRoot",
    ) ||
    typeof body.patternId !== "string" ||
    typeof body.targetRepoRoot !== "string"
  ) {
    return jsonWithSession(
      request,
      sessionId,
      {
        status: "invalid-request",
        detail: "patternId and targetRepoRoot are the only accepted fields",
      },
      400,
    );
  }
  const result = createWorkflow(
    sessionId,
    body.patternId,
    body.targetRepoRoot,
  );
  return jsonWithSession(
    request,
    sessionId,
    result,
    statusCode(result.status),
  );
}
