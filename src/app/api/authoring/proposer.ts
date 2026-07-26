import { readFileSync } from "node:fs";

import type { Proposer } from "@/services/proposer";
import { createAnthropicProposerFromEnv } from "@/services/proposer-anthropic";
import {
  createStubProposer,
  type StubProposerScript,
} from "@/services/proposer-stub";

let testProposer: Proposer | undefined;

export function configuredAuthoringProposer(): Proposer {
  if (testProposer !== undefined) return testProposer;
  if (process.env.UPTAKE_PROPOSER === "stub") {
    const scriptPath = process.env.UPTAKE_PROPOSER_STUB_SCRIPT;
    if (scriptPath === undefined) {
      throw new Error(
        "UPTAKE_PROPOSER_STUB_SCRIPT is required for the stub proposer",
      );
    }
    const script = JSON.parse(
      readFileSync(scriptPath, "utf8"),
    ) as StubProposerScript;
    return createStubProposer(script);
  }
  return createAnthropicProposerFromEnv();
}

export function __setAuthoringProposerForTests(
  proposer: Proposer | undefined,
): void {
  testProposer = proposer;
}
