import { readFileSync } from "node:fs";

import type { SurveyProposer } from "@/services/proposer";
import {
  AnthropicProposerConfigurationError,
  createAnthropicProposerFromEnv,
} from "@/services/proposer-anthropic";
import {
  createStubSurveyProposer,
  type StubSurveyScript,
} from "@/services/proposer-stub";

let testProposer: SurveyProposer | undefined;

export function configuredSurveyProposer(): SurveyProposer {
  if (testProposer !== undefined) return testProposer;
  if (process.env.UPTAKE_PROPOSER === "stub") {
    const scriptPath = process.env.UPTAKE_PROPOSER_STUB_SCRIPT;
    if (scriptPath === undefined) {
      throw new AnthropicProposerConfigurationError(
        "UPTAKE_PROPOSER_STUB_SCRIPT is required for the stub proposer",
      );
    }
    const script = JSON.parse(
      readFileSync(scriptPath, "utf8"),
    ) as StubSurveyScript;
    return createStubSurveyProposer(script);
  }
  return createAnthropicProposerFromEnv();
}

export function __setSurveyProposerForTests(
  proposer: SurveyProposer | undefined,
): void {
  testProposer = proposer;
}
