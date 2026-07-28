#!/usr/bin/env node
import type { CliOutcome } from "@/workflow/cli";
import { runCli } from "@/workflow/cli";

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function computeOutcome(): CliOutcome {
  try {
    return runCli(process.argv.slice(2));
  } catch (error) {
    return { exitCode: 3, stdout: [], stderr: [errorMessage(error)] };
  }
}

const outcome = computeOutcome();
for (const line of outcome.stdout) {
  console.log(line);
}
for (const line of outcome.stderr) {
  console.error(line);
}
process.exit(outcome.exitCode);
