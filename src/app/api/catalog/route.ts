import { type NextRequest } from "next/server";

import { jsonWithSession, sessionIdFor } from "@/app/api/http";
import { getCatalog } from "@/services/workflow-store";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const sessionId = sessionIdFor(request);
  return jsonWithSession(request, sessionId, getCatalog());
}
