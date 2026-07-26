import type { Proposer } from "@/services/proposer";

let testProposer: Proposer | undefined;

export function configuredAuthoringProposer(): Proposer | undefined {
  return testProposer;
}

export function __setAuthoringProposerForTests(
  proposer: Proposer | undefined,
): void {
  testProposer = proposer;
}
