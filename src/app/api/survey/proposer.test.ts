import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __setSurveyProposerForTests,
  configuredSurveyProposer,
} from "@/app/api/survey/proposer";
import { createAnthropicProposerFromEnv } from "@/services/proposer-anthropic";
import { createStubSurveyProposer } from "@/services/proposer-stub";

vi.mock("@/services/proposer-anthropic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/proposer-anthropic")>();
  return { ...actual, createAnthropicProposerFromEnv: vi.fn() };
});

afterEach(() => {
  __setSurveyProposerForTests(undefined);
  vi.mocked(createAnthropicProposerFromEnv).mockReset();
});

describe("survey proposer selection", () => {
  it("uses an explicitly injected proposer", () => {
    const proposer = createStubSurveyProposer({ candidates: [] });
    __setSurveyProposerForTests(proposer);
    expect(configuredSurveyProposer()).toBe(proposer);
  });

  it("uses the Anthropic proposer by default", () => {
    const proposer = createStubSurveyProposer({ candidates: [] });
    vi.mocked(createAnthropicProposerFromEnv).mockReturnValue(proposer);

    expect(configuredSurveyProposer()).toBe(proposer);
    expect(createAnthropicProposerFromEnv).toHaveBeenCalledOnce();
  });
});
