import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { methodPath, templatesDir, uptakeDir } from "@/workflow/paths";

export type InitResult =
  | { ok: true; created: boolean; path: string }
  | { ok: false; reason: "template-unreadable" | "write-failed"; detail: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runInit(root?: string): InitResult {
  const path = methodPath(root);

  if (existsSync(path)) {
    return { ok: true, created: false, path };
  }

  let template: string;
  try {
    template = readFileSync(join(templatesDir(), "METHOD.md"), "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: "template-unreadable",
      detail: errorMessage(error),
    };
  }

  try {
    mkdirSync(uptakeDir(root), { recursive: true });
    writeFileSync(path, template, "utf8");
  } catch (error) {
    return { ok: false, reason: "write-failed", detail: errorMessage(error) };
  }

  return { ok: true, created: true, path };
}
