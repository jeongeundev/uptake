import { afterEach, describe, expect, it } from "vitest";

import {
  __setAuthoringProposerForTests,
  configuredAuthoringProposer,
} from "@/app/api/authoring/proposer";
import { createStubProposer } from "@/services/proposer-stub";

afterEach(() => {
  __setAuthoringProposerForTests(undefined);
});

describe("authoring proposer selection", () => {
  it("does not silently fall back to a stub", () => {
    expect(configuredAuthoringProposer()).toBeUndefined();
  });

  it("allows explicit test injection", () => {
    const proposer = createStubProposer({});
    __setAuthoringProposerForTests(proposer);
    expect(configuredAuthoringProposer()).toBe(proposer);
  });
});
