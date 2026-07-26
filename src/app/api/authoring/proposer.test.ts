import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __setAuthoringProposerForTests,
  configuredAuthoringProposer,
} from "@/app/api/authoring/proposer";
import { createAnthropicProposerFromEnv } from "@/services/proposer-anthropic";
import { createStubProposer } from "@/services/proposer-stub";

vi.mock("@/services/proposer-anthropic", () => ({
  createAnthropicProposerFromEnv: vi.fn(),
}));

afterEach(() => {
  __setAuthoringProposerForTests(undefined);
  vi.mocked(createAnthropicProposerFromEnv).mockReset();
});

describe("authoring proposer selection", () => {
  it("selects the production Anthropic proposer when there is no override", () => {
    const proposer = createStubProposer({
      metadata: { providerId: "anthropic", modelId: "configured-model" },
    });
    vi.mocked(createAnthropicProposerFromEnv).mockReturnValue(proposer);

    expect(configuredAuthoringProposer()).toBe(proposer);
    expect(createAnthropicProposerFromEnv).toHaveBeenCalledOnce();
  });

  it("prefers explicit test injection without creating a production adapter", () => {
    const proposer = createStubProposer({});
    __setAuthoringProposerForTests(proposer);

    expect(configuredAuthoringProposer()).toBe(proposer);
    expect(createAnthropicProposerFromEnv).not.toHaveBeenCalled();
  });
});
