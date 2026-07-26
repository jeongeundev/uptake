import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createStubSurveyProposer } from "@/services/proposer-stub";
import { runSurvey } from "@/services/survey-service";

afterEach(() => {
  delete process.env.UPTAKE_SURVEY_RULES;
  delete process.env.UPTAKE_SOURCE_ROOT;
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

  it("preserves discard details when every proposed candidate is rejected", async () => {
    const root = mkdtempSync(join(tmpdir(), "uptake-survey-service-"));
    const repositoryRoot = join(root, "example", "one");
    mkdirSync(join(repositoryRoot, "docs"), { recursive: true });
    writeFileSync(join(repositoryRoot, "docs", "method.md"), "method\n");
    execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
    execFileSync("git", ["add", "."], { cwd: repositoryRoot });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Uptake Test",
        "-c",
        "user.email=uptake@example.test",
        "commit",
        "-q",
        "-m",
        "fixture",
      ],
      { cwd: repositoryRoot },
    );
    process.env.UPTAKE_SOURCE_ROOT = root;
    const proposer = createStubSurveyProposer({
      candidates: [
        {
          id: "ungrounded",
          name: "Ungrounded",
          intent: "Observe a practice.",
          discipline: "No collected evidence supports this.",
          tradeoffs: "Unknown.",
          evidence: ["invented.md"],
          confidence: "low",
        },
      ],
    });

    const result = await runSurvey("session", "example/one", proposer);

    expect(result).toMatchObject({
      status: "no-candidate",
      repository: "example/one",
      revision: expect.any(String),
      discardedEvidence: [
        {
          candidateId: "ungrounded",
          path: "invented.md",
          reason: "not-collected",
        },
      ],
      discardedCandidates: [
        {
          candidateId: "ungrounded",
          reason: "no-evidence",
        },
      ],
    });
    rmSync(root, { recursive: true, force: true });
  });
});
