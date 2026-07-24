import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export type GateOutcome =
  | {
      kind: "ran";
      perTest: Record<string, "passed" | "failed">;
      logPath: string;
    }
  | { kind: "error"; detail: string; logPath: string };

export const DEFAULT_GATE_TIMEOUT_MS = 30_000;

const inheritedEnvironment = [
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
] as const;

type VitestJsonReport = {
  testResults?: {
    assertionResults?: {
      fullName?: unknown;
      status?: unknown;
    }[];
  }[];
};

function gateEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: "1", NODE_ENV: "test" };
  for (const name of inheritedEnvironment) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  return env;
}

function parseReporter(stdout: string): Record<string, "passed" | "failed"> {
  const report = JSON.parse(stdout) as VitestJsonReport;
  if (!Array.isArray(report.testResults)) {
    throw new Error("reporter JSON has no testResults");
  }

  const perTest: Record<string, "passed" | "failed"> = {};
  for (const testFile of report.testResults) {
    if (!Array.isArray(testFile.assertionResults)) {
      throw new Error("reporter JSON has no assertionResults");
    }
    for (const test of testFile.assertionResults) {
      if (
        typeof test.fullName !== "string" ||
        (test.status !== "passed" && test.status !== "failed")
      ) {
        throw new Error("reporter JSON contains an invalid test result");
      }
      if (Object.hasOwn(perTest, test.fullName)) {
        throw new Error(
          `reporter JSON contains duplicate test id: ${test.fullName}`,
        );
      }
      perTest[test.fullName] = test.status;
    }
  }

  if (Object.keys(perTest).length === 0) {
    throw new Error("reporter JSON contains no test results");
  }
  return perTest;
}

export async function runGate(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<GateOutcome> {
  const logDirectory = await mkdtemp(resolve(tmpdir(), "uptake-gate-log-"));
  const logPath = resolve(logDirectory, "gate.log");
  const log = createWriteStream(logPath, { encoding: "utf8" });

  if (argv.length === 0) {
    log.end("spawn error: argv must contain an executable\n");
    return { kind: "error", detail: "spawn error: empty argv", logPath };
  }

  return new Promise((finish) => {
    let stdout = "";
    let timedOut = false;
    let spawnError: Error | undefined;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: gateEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      log.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log.write(chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      spawnError = error;
      log.write(`spawn error: ${error.message}\n`);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      log.write(`timeout after ${timeoutMs}ms\n`);
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      log.end(() => {
        if (timedOut) {
          finish({
            kind: "error",
            detail: `timeout after ${timeoutMs}ms`,
            logPath,
          });
          return;
        }
        if (spawnError !== undefined) {
          finish({
            kind: "error",
            detail: `spawn error: ${spawnError.message}`,
            logPath,
          });
          return;
        }
        if (signal !== null) {
          finish({
            kind: "error",
            detail: `process terminated by signal ${signal}`,
            logPath,
          });
          return;
        }

        try {
          finish({ kind: "ran", perTest: parseReporter(stdout), logPath });
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "reporter parse failed";
          finish({ kind: "error", detail, logPath });
        }
      });
    });
  });
}
