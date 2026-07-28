import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { methodPath } from "@/workflow/paths";
import { runCli } from "@/workflow/cli";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-cli-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runCli", () => {
  it("exits 2 with the command list when no command is given", () => {
    const outcome = runCli([], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("exits 2 with the command list for an unknown command", () => {
    const outcome = runCli(["nonexistent"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("does not know about verify or apply as commands", () => {
    expect(runCli(["verify"], root).exitCode).toBe(2);
    expect(runCli(["apply"], root).exitCode).toBe(2);
  });

  it("runs init and exits 0, creating METHOD.md", () => {
    const outcome = runCli(["init"], root);

    expect(outcome.exitCode).toBe(0);
    expect(existsSync(methodPath(root))).toBe(true);
  });

  it("runs init a second time and still exits 0 without recreating", () => {
    runCli(["init"], root);
    const second = runCli(["init"], root);

    expect(second.exitCode).toBe(0);
    expect(second.stdout.join("\n")).toContain("Already initialized");
  });
});
