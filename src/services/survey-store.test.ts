import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetSurveyStoreForTests,
  createSurvey,
  getSurvey,
} from "@/services/survey-store";

const stored = {
  sessionId: "session-one",
  repository: "example/one",
  revision: "a".repeat(40),
  candidates: [
    {
      id: "review-gate",
      name: "Review gate",
      intent: "Require review.",
      discipline: "A committed policy requires review.",
      tradeoffs: "Review adds latency.",
      evidence: ["CONTRIBUTING.md"],
      confidence: "high" as const,
    },
  ],
  proposerMetadata: { providerId: "stub", modelId: "stub-model" },
};

beforeEach(__resetSurveyStoreForTests);

describe("survey store", () => {
  it("uses opaque ids, isolates sessions, and returns copies", () => {
    const surveyId = createSurvey(stored);
    expect(surveyId).not.toBe("1");
    expect(getSurvey(surveyId, "session-two")).toBeUndefined();

    const copy = getSurvey(surveyId, stored.sessionId);
    expect(copy).toEqual(stored);
    copy?.candidates.splice(0);
    expect(getSurvey(surveyId, stored.sessionId)?.candidates).toHaveLength(1);
  });
});
