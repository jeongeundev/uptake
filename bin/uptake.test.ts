import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This exercises bin/uptake.ts's own wiring (argv -> runCli -> console/exit),
// in-process via mocked process.exit — distinct from step 7's integration
// test, which spawns `npx tsx bin/uptake.ts` as a real subprocess.
class ProcessExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

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
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitCalled(code ?? 0);
  }) as never);

  process.argv = ["node", "uptake", ...args];

  try {
    await import("./uptake");
  } catch (error) {
    if (error instanceof ProcessExitCalled) {
      return { code: error.code, stdout, stderr };
    }
    throw error;
  }
  throw new Error("expected bin/uptake.ts to call process.exit");
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
