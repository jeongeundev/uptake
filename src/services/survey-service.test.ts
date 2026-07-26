import { afterEach, describe, expect, it } from "vitest";

import { createStubSurveyProposer } from "@/services/proposer-stub";
import { runSurvey } from "@/services/survey-service";

afterEach(() => {
  delete process.env.UPTAKE_SURVEY_RULES;
});

describe("survey service", () => {
  it("surfaces a missing rules file without calling the proposer", async () => {
    process.env.UPTAKE_SURVEY_RULES = "/missing/survey-rules.json";
    const proposer = createStubSurveyProposer({ candidates: [] });
    const result = await runSurvey("session", "example/one", proposer);

    expect(result).toMatchObject({
      status: "survey-rules-error",
      detail: expect.stringContaining("failed to read survey rules"),
    });
    expect(proposer.calls).toHaveLength(0);
  });
});
