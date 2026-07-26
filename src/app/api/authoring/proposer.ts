import type { Proposer } from "@/services/proposer";
import { createAnthropicProposerFromEnv } from "@/services/proposer-anthropic";

let testProposer: Proposer | undefined;

export function configuredAuthoringProposer(): Proposer {
  return testProposer ?? createAnthropicProposerFromEnv();
}

export function __setAuthoringProposerForTests(
  proposer: Proposer | undefined,
): void {
  testProposer = proposer;
}
