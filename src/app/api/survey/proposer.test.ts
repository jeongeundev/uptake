import { afterEach, describe, expect, it } from "vitest";

import {
  __setSurveyProposerForTests,
  configuredSurveyProposer,
} from "@/app/api/survey/proposer";
import { createStubSurveyProposer } from "@/services/proposer-stub";

afterEach(() => __setSurveyProposerForTests(undefined));

describe("survey proposer selection", () => {
  it("uses an explicitly injected proposer", () => {
    const proposer = createStubSurveyProposer({ candidates: [] });
    __setSurveyProposerForTests(proposer);
    expect(configuredSurveyProposer()).toBe(proposer);
  });
});
