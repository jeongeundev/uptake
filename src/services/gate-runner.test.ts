import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGate } from "@/services/gate-runner";

const vitestBin = resolve("node_modules/vitest/vitest.mjs");
const workspaces: string[] = [];

function makeWorkspace(): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "uptake-gate-runner-"));
  workspaces.push(workspace);
  return workspace;
}

function vitestArgv(...args: string[]): string[] {
  return [
    process.execPath,
    vitestBin,
    "run",
    "--globals",
    "--reporter=json",
    ...args,
  ];
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("runGate", () => {
  it("returns every reported test result and preserves complete output", async () => {
    const workspace = makeWorkspace();
    writeFileSync(
      resolve(workspace, "gate.test.js"),
      [
        'it("gate passes", () => { console.log("complete stdout"); expect(1).toBe(1); });',
        'it("gate fails", () => { console.error("complete stderr"); expect(1).toBe(2); });',
      ].join("\n"),
    );

    const outcome = await runGate(vitestArgv("gate.test.js"), workspace, 10_000);

    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") {
      return;
    }
    expect(outcome.perTest).toEqual({
      "gate passes": "passed",
      "gate fails": "failed",
    });
    const log = readFileSync(outcome.logPath, "utf8");
    expect(log).toContain('"fullName":"gate passes"');
    expect(log).toContain('"fullName":"gate fails"');
    expect(outcome.outputPreview).toContain('"fullName":"gate passes"');
    expect(outcome.outputTruncated).toBe(false);
  });

  it("reports a syntax error as error, never as a failed test", async () => {
    const workspace = makeWorkspace();
    writeFileSync(resolve(workspace, "gate.test.js"), "it(");

    const outcome = await runGate(vitestArgv("gate.test.js"), workspace, 10_000);

    expect(outcome).toMatchObject({ kind: "error" });
    expect(outcome).not.toHaveProperty("perTest");
  });

  it("reports a missing config as error, never as a failed test", async () => {
    const workspace = makeWorkspace();
    writeFileSync(
      resolve(workspace, "gate.test.js"),
      'it("would pass", () => expect(true).toBe(true));',
    );

    const outcome = await runGate(
      vitestArgv("--config", "missing.config.ts", "gate.test.js"),
      workspace,
      10_000,
    );

    expect(outcome).toMatchObject({ kind: "error" });
    expect(outcome).not.toHaveProperty("perTest");
  });

  it("terminates a timed out run and reports error", async () => {
    const workspace = makeWorkspace();
    writeFileSync(
      resolve(workspace, "gate.test.js"),
      'it("never finishes", () => { while (true) {} });',
    );

    const outcome = await runGate(vitestArgv("gate.test.js"), workspace, 100);

    expect(outcome).toMatchObject({ kind: "error" });
    if (outcome.kind === "error") {
      expect(outcome.detail).toContain("timeout");
    }
    expect(outcome).not.toHaveProperty("perTest");
  });

  it("passes argv literally without shell interpretation", async () => {
    const workspace = makeWorkspace();
    const markerPath = resolve(workspace, "shell-interpreted");
    const reporterScript = resolve(workspace, "reporter.mjs");
    writeFileSync(
      reporterScript,
      [
        'if (process.argv[2] !== "; touch shell-interpreted") process.exit(2);',
        'process.stderr.write("complete stderr\\n");',
        'console.log(JSON.stringify({ testResults: [{ assertionResults: [{ fullName: "literal argv", status: "passed" }] }] }));',
      ].join("\n"),
    );

    const outcome = await runGate(
      [process.execPath, reporterScript, "; touch shell-interpreted"],
      workspace,
      10_000,
    );

    expect(outcome).toMatchObject({
      kind: "ran",
      perTest: { "literal argv": "passed" },
    });
    expect(readFileSync(outcome.logPath, "utf8")).toContain("complete stderr");
    expect(() => readFileSync(markerPath)).toThrow();
  });

  it("limits the output preview while preserving the complete log", async () => {
    const workspace = makeWorkspace();
    const reporterScript = resolve(workspace, "large-reporter.mjs");
    writeFileSync(
      reporterScript,
      [
        'process.stderr.write("x".repeat(5000));',
        'console.log(JSON.stringify({ testResults: [{ assertionResults: [{ fullName: "large output", status: "passed" }] }] }));',
      ].join("\n"),
    );

    const outcome = await runGate(
      [process.execPath, reporterScript],
      workspace,
      10_000,
    );

    expect(outcome).toMatchObject({
      kind: "ran",
      outputTruncated: true,
    });
    expect(outcome.outputPreview).toHaveLength(4000);
    expect(readFileSync(outcome.logPath, "utf8").length).toBeGreaterThan(5000);
  });
});
