import { isAbsolute } from "node:path";
import { createInterface } from "node:readline/promises";

import type { ApprovalPrompt } from "@/workflow/steps/apply";
import { runApplyCommand } from "@/workflow/steps/apply";
import { runAuthorCommand } from "@/workflow/steps/author";
import { runInit } from "@/workflow/steps/init";
import { runSurveyCommand } from "@/workflow/steps/survey";
import { runVerifyCommand } from "@/workflow/steps/verify";

export type CliOutcome = {
  exitCode: 0 | 1 | 2 | 3;
  stdout: string[];
  stderr: string[];
};

const KNOWN_COMMANDS = [
  "init",
  "survey",
  "author",
  "verify",
  "apply",
] as const;
type KnownCommand = (typeof KNOWN_COMMANDS)[number];

function isKnownCommand(value: string | undefined): value is KnownCommand {
  return (
    value !== undefined && (KNOWN_COMMANDS as readonly string[]).includes(value)
  );
}

function usageLines(): string[] {
  return [
    "Usage: uptake <command>",
    "",
    "Available commands:",
    ...KNOWN_COMMANDS.map((command) => `  ${command}`),
  ];
}

function parseCandidateFlag(args: string[]): string | undefined {
  const index = args.indexOf("--candidate");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value === undefined || value === "" ? undefined : value;
}

function parseTargetFlag(args: string[]): string | undefined {
  const index = args.indexOf("--target");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value === undefined || value === "" ? undefined : value;
}

// The prompt is deliberately kept out of `runApplyCommand` (steps/apply.ts):
// that function only knows the `ApprovalPrompt` port, while the TTY check
// and readline wiring are a CLI-surface concern (AGENTS.md 'CLI의 승인은
// apply 안에서 ... 대화형으로 받고').
export const promptForApproval: ApprovalPrompt = async (summary) => {
  const lines = [
    `About to apply pattern "${summary.patternId}" to ${summary.targetRepoRoot}.`,
    `Gate test: ${summary.gateTestId}`,
    `Verified command: ${summary.frozenArgv.join(" ")}`,
    "",
    "Resolved bindings:",
    ...summary.bindings.map((binding) =>
      binding.status === "binding-unresolved"
        ? `  ${binding.bindingId}: (unresolved)`
        : `  ${binding.bindingId}: ${binding.value}`,
    ),
    "",
    "Files to write:",
    ...summary.files.flatMap((file) => [
      `  --- ${file.path} (${file.role}) ---`,
      file.content,
    ]),
  ];
  for (const line of lines) {
    console.log(line);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question("Apply these changes? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

async function runKnownCommand(
  command: KnownCommand,
  args: string[],
  root?: string,
): Promise<CliOutcome> {
  if (command === "init") {
    const result = runInit(root);
    if (result.ok) {
      const message = result.created
        ? `Created ${result.path}`
        : `Already initialized: ${result.path}`;
      return { exitCode: 0, stdout: [message], stderr: [] };
    }
    return {
      exitCode: 3,
      stdout: [],
      stderr: [`init failed (${result.reason}): ${result.detail}`],
    };
  }

  if (command === "survey") {
    const [repository] = args;
    if (repository === undefined) {
      return {
        exitCode: 2,
        stdout: [],
        stderr: ["Usage: uptake survey <repository>"],
      };
    }
    const result = await runSurveyCommand(repository, root);
    const lines = result.message.split("\n");
    return result.exitCode === 0
      ? { exitCode: 0, stdout: lines, stderr: [] }
      : { exitCode: result.exitCode, stdout: [], stderr: lines };
  }

  if (command === "author") {
    const candidateId = parseCandidateFlag(args);
    if (candidateId === undefined) {
      return {
        exitCode: 2,
        stdout: [],
        stderr: ["Usage: uptake author --candidate <id>"],
      };
    }
    const result = await runAuthorCommand(candidateId, root);
    const lines = result.message.split("\n");
    return result.exitCode === 0
      ? { exitCode: 0, stdout: lines, stderr: [] }
      : { exitCode: result.exitCode, stdout: [], stderr: lines };
  }

  if (command === "verify") {
    const target = parseTargetFlag(args);
    if (target === undefined) {
      return {
        exitCode: 2,
        stdout: [],
        stderr: ["Usage: uptake verify --target <absolute path>"],
      };
    }
    if (!isAbsolute(target)) {
      return {
        exitCode: 2,
        stdout: [],
        stderr: [`--target must be an absolute path: ${target}`],
      };
    }
    const result = await runVerifyCommand(target, root);
    const lines = result.message.split("\n");
    return result.exitCode === 0
      ? { exitCode: 0, stdout: lines, stderr: [] }
      : { exitCode: result.exitCode, stdout: [], stderr: lines };
  }

  // command === "apply": approval must come from a real interactive
  // terminal (ADR-022) — an environment that cannot answer the prompt must
  // not silently proceed, so this checks stdin before calling
  // runApplyCommand at all, never invoking it in a non-TTY environment.
  if (process.stdin.isTTY !== true) {
    return {
      exitCode: 2,
      stdout: [],
      stderr: [
        "apply requires interactive approval, but stdin is not a TTY. Run it from an interactive terminal.",
      ],
    };
  }
  const result = await runApplyCommand({ confirm: promptForApproval, root });
  const lines = result.message.split("\n");
  return result.exitCode === 0
    ? { exitCode: 0, stdout: lines, stderr: [] }
    : { exitCode: result.exitCode, stdout: [], stderr: lines };
}

export async function runCli(argv: string[], root?: string): Promise<CliOutcome> {
  const [command, ...args] = argv;

  if (!isKnownCommand(command)) {
    return { exitCode: 2, stdout: [], stderr: usageLines() };
  }

  return runKnownCommand(command, args, root);
}
