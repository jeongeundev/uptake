import { runAuthorCommand } from "@/workflow/steps/author";
import { runInit } from "@/workflow/steps/init";
import { runSurveyCommand } from "@/workflow/steps/survey";

export type CliOutcome = {
  exitCode: 0 | 1 | 2 | 3;
  stdout: string[];
  stderr: string[];
};

const KNOWN_COMMANDS = ["init", "survey", "author"] as const;
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

export async function runCli(argv: string[], root?: string): Promise<CliOutcome> {
  const [command, ...args] = argv;

  if (!isKnownCommand(command)) {
    return { exitCode: 2, stdout: [], stderr: usageLines() };
  }

  return runKnownCommand(command, args, root);
}
