import { runInit } from "@/workflow/steps/init";

export type CliOutcome = {
  exitCode: 0 | 1 | 2 | 3;
  stdout: string[];
  stderr: string[];
};

const KNOWN_COMMANDS = ["init"] as const;
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

function runKnownCommand(command: KnownCommand, root?: string): CliOutcome {
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

  return { exitCode: 2, stdout: [], stderr: usageLines() };
}

export function runCli(argv: string[], root?: string): CliOutcome {
  const [command] = argv;

  if (!isKnownCommand(command)) {
    return { exitCode: 2, stdout: [], stderr: usageLines() };
  }

  return runKnownCommand(command, root);
}
