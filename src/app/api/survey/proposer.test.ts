import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
  vi.unstubAllEnvs();
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

  it("uses the explicit SURVEY stub script before the shared proposer script", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "uptake-survey-proposer-"));
    const shared = resolve(root, "shared.json");
    const survey = resolve(root, "survey.json");
    writeFileSync(shared, JSON.stringify({ candidates: [] }));
    writeFileSync(
      survey,
      JSON.stringify({
        candidates: [
          {
            id: "survey-candidate",
            name: "Survey candidate",
            intent: "Observe a repository discipline.",
            discipline: "A repository check enforces the discipline.",
            tradeoffs: "The check adds maintenance cost.",
            evidence: ["AGENTS.md"],
            confidence: "high",
          },
        ],
      }),
    );
    vi.stubEnv("UPTAKE_PROPOSER", "stub");
    vi.stubEnv("UPTAKE_PROPOSER_STUB_SCRIPT", shared);
    vi.stubEnv("UPTAKE_SURVEY_PROPOSER_STUB_SCRIPT", survey);

    const proposer = configuredSurveyProposer();
    const candidates = await proposer.proposeSurveyCandidates({
      repository: "fixtures/repository",
      revision: "abc123",
      files: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("survey-candidate");
  });
});
