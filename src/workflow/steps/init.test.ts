import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { methodPath, templatesDir } from "@/workflow/paths";
import { runInit } from "@/workflow/steps/init";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-init-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runInit", () => {
  it("creates .uptake/METHOD.md on first run", () => {
    const result = runInit(root);

    expect(result).toEqual({
      ok: true,
      created: true,
      path: methodPath(root),
    });
    expect(existsSync(methodPath(root))).toBe(true);
  });

  it("copies the packaged template verbatim", () => {
    runInit(root);

    const written = readFileSync(methodPath(root), "utf8");
    const source = readFileSync(join(templatesDir(), "METHOD.md"), "utf8");
    expect(written).toBe(source);
  });

  it("is idempotent and preserves user edits on a second run", () => {
    runInit(root);
    writeFileSync(methodPath(root), "# edited by user\n", "utf8");

    const second = runInit(root);

    expect(second).toEqual({
      ok: true,
      created: false,
      path: methodPath(root),
    });
    expect(readFileSync(methodPath(root), "utf8")).toBe("# edited by user\n");
  });

  it("does not create or modify .gitignore", () => {
    runInit(root);

    expect(existsSync(join(root, ".gitignore"))).toBe(false);
  });
});
