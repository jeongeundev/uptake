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
  it("exits 2 with the command list when no command is given", async () => {
    const outcome = await runCli([], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("exits 2 with the command list for an unknown command", async () => {
    const outcome = await runCli(["nonexistent"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("does not know about apply as a command", async () => {
    const outcome = await runCli(["apply"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("exits 2 with a usage message when verify is missing --target", async () => {
    const outcome = await runCli(["verify"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain(
      "uptake verify --target <absolute path>",
    );
  });

  it("exits 2 when verify's --target is not an absolute path", async () => {
    const outcome = await runCli(["verify", "--target", "relative/path"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("absolute path");
  });

  it("runs init and exits 0, creating METHOD.md", async () => {
    const outcome = await runCli(["init"], root);

    expect(outcome.exitCode).toBe(0);
    expect(existsSync(methodPath(root))).toBe(true);
  });

  it("runs init a second time and still exits 0 without recreating", async () => {
    await runCli(["init"], root);
    const second = await runCli(["init"], root);

    expect(second.exitCode).toBe(0);
    expect(second.stdout.join("\n")).toContain("Already initialized");
  });

  it("exits 2 with a usage message when survey is missing its repository argument", async () => {
    const outcome = await runCli(["survey"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("uptake survey <repository>");
  });

  it("exits 2 with a usage message when author is missing --candidate", async () => {
    const outcome = await runCli(["author"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("uptake author --candidate <id>");
  });

  it("exits 2 with a usage message when author's --candidate has no value", async () => {
    const outcome = await runCli(["author", "--candidate"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("uptake author --candidate <id>");
  });

  it("exits 2 when author is run without a prior survey", async () => {
    const outcome = await runCli(["author", "--candidate", "some-id"], root);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("uptake survey");
  });
});
