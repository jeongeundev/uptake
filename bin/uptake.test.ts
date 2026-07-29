import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This exercises bin/uptake.ts's own wiring (argv -> runCli -> console/exit),
// in-process via mocked process.exit — distinct from step 7's integration
// test, which spawns `npx tsx bin/uptake.ts` as a real subprocess.
//
// bin/uptake.ts awaits runCli before calling process.exit, and since the
// file compiles to CommonJS (no package.json "type": "module"), that await
// cannot be a top-level await — it runs inside a fire-and-forget async
// function. That means process.exit is called after the module's own
// synchronous body (and thus the dynamic import() below) has already
// settled, so this helper waits on process.exit itself rather than on
// import() rejecting.
let root: string;
let previousArgv: string[];
let previousCwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-bin-"));
  previousArgv = process.argv;
  previousCwd = process.cwd();
  process.chdir(root);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(previousCwd);
  process.argv = previousArgv;
  rmSync(root, { recursive: true, force: true });
  vi.doUnmock("@/workflow/cli");
  vi.restoreAllMocks();
});

async function runBin(
  args: string[],
): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    stdout.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    stderr.push(line);
  });

  let resolveExit: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    resolveExit(code ?? 0);
    return undefined as never;
  }) as never);

  process.argv = ["node", "uptake", ...args];

  await import("./uptake");
  const code = await exited;
  return { code, stdout, stderr };
}

describe("bin/uptake.ts", () => {
  it("runs init and exits 0", async () => {
    const outcome = await runBin(["init"]);

    expect(outcome.code).toBe(0);
    expect(outcome.stdout.join("\n")).toContain("Created");
  });

  it("exits 2 with the command list for an unknown command", async () => {
    const outcome = await runBin(["nonexistent"]);

    expect(outcome.code).toBe(2);
    expect(outcome.stderr.join("\n")).toContain("init");
  });

  it("exits 3 and reports the error when runCli throws unexpectedly", async () => {
    vi.doMock("@/workflow/cli", () => ({
      runCli: () => {
        throw new Error("unexpected failure");
      },
    }));

    const outcome = await runBin(["init"]);

    expect(outcome.code).toBe(3);
    expect(outcome.stderr.join("\n")).toContain("unexpected failure");
  });
});
