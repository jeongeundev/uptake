import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as approveDraft } from "@/app/api/authoring/drafts/[draftId]/approve/route";
import { POST as registerDraft } from "@/app/api/authoring/drafts/[draftId]/register/route";
import { __setSurveyProposerForTests } from "@/services/survey-proposer";
import { POST as runSurvey } from "@/app/api/survey/route";
import { POST as adoptCandidate } from "@/app/api/survey/[surveyId]/candidates/[candidateId]/adopt/route";
import { __resetAuthoringStoreForTests } from "@/services/authoring-store";
import { createStubSurveyProposer } from "@/services/proposer-stub";
import { AnthropicProposerResponseError } from "@/services/proposer-anthropic";
import { __resetSurveyStoreForTests } from "@/services/survey-store";
import type { SurveyCandidate } from "@/types/survey";

let root: string;
let sourceRoot: string;
let catalogDir: string;

const candidate: SurveyCandidate = {
  id: "review-gate",
  name: "Review gate",
  intent: "Require a review before accepting a change.",
  discipline: "A committed review policy records the blocking review gate.",
  tradeoffs: "Reviews add latency before changes can land.",
  evidence: ["CONTRIBUTING.md"],
  confidence: "high",
};

function createRepository(): void {
  const path = join(sourceRoot, "example", "one");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "CONTRIBUTING.md"), "Changes require review.\n");
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["add", "."], { cwd: path });
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
    { cwd: path },
  );
}

function surveyRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/survey", {
    method: "POST",
    headers: cookie === undefined ? undefined : { cookie },
    body: JSON.stringify(body),
  });
}

function adoptRequest(cookie: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/survey/id/candidates/id/adopt", {
    method: "POST",
    headers: { cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function surveyed(
  candidates: SurveyCandidate[] = [candidate],
): Promise<{ result: Record<string, unknown>; cookie: string }> {
  __setSurveyProposerForTests(
    createStubSurveyProposer({ candidates }),
  );
  const response = await runSurvey(
    surveyRequest({ repository: "example/one" }),
  );
  return {
    result: (await response.json()) as Record<string, unknown>,
    cookie: response.headers.get("set-cookie") ?? "",
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-survey-route-"));
  sourceRoot = join(root, "sources");
  catalogDir = join(root, "catalog");
  mkdirSync(sourceRoot);
  mkdirSync(catalogDir);
  createRepository();
  process.env.UPTAKE_SOURCE_ROOT = sourceRoot;
  process.env.UPTAKE_CATALOG_DIR = catalogDir;
  __resetAuthoringStoreForTests();
  __resetSurveyStoreForTests();
});

afterEach(() => {
  __setSurveyProposerForTests(undefined);
  delete process.env.UPTAKE_SOURCE_ROOT;
  delete process.env.UPTAKE_CATALOG_DIR;
  delete process.env.UPTAKE_SURVEY_RULES;
  rmSync(root, { recursive: true, force: true });
});

describe("survey route boundary", () => {
  it("surveys a repository and adopts a server-stored candidate into a draft", async () => {
    const { result, cookie } = await surveyed();
    expect(result).toMatchObject({
      status: "surveyed",
      repository: "example/one",
      candidates: [{ id: candidate.id }],
    });
    expect(result.surveyId).toEqual(expect.any(String));

    const response = await adoptCandidate(
      adoptRequest(cookie),
      {
        params: Promise.resolve({
          surveyId: result.surveyId as string,
          candidateId: candidate.id,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "drafted",
      draftId: expect.any(String),
      pattern: {
        patternId: candidate.id,
        capability: "descriptive",
        evidenceStatus: "observed",
      },
      authoringRequest: { patternId: candidate.id },
    });
  });

  it("exposes discarded evidence from the survey gate", async () => {
    const { result } = await surveyed([
      { ...candidate, evidence: ["CONTRIBUTING.md", "invented.md"] },
    ]);
    expect(result.discardedEvidence).toEqual([
      {
        candidateId: candidate.id,
        path: "invented.md",
        reason: "not-collected",
      },
    ]);
  });

  it("preserves discard details when every candidate is discarded", async () => {
    const { result } = await surveyed([
      { ...candidate, evidence: ["invented.md"] },
    ]);
    expect(result).toMatchObject({
      status: "no-candidate",
      repository: "example/one",
      revision: expect.any(String),
      discardedEvidence: [
        {
          candidateId: candidate.id,
          path: "invented.md",
          reason: "not-collected",
        },
      ],
      discardedCandidates: [
        {
          candidateId: candidate.id,
          reason: "no-evidence",
        },
      ],
    });
  });

  it("returns a structured proposer response error", async () => {
    __setSurveyProposerForTests({
      metadata: { provider: "anthropic", modelId: "configured-model" },
      proposeSurveyCandidates: async () => {
        throw new AnthropicProposerResponseError(
          "invalid Anthropic proposer response after 3 attempts",
        );
      },
    });

    const response = await runSurvey(
      surveyRequest({ repository: "example/one" }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      status: "proposer-response-error",
      detail: "invalid Anthropic proposer response after 3 attempts",
    });
  });

  it("does not allow another session to adopt a survey", async () => {
    const { result } = await surveyed();
    const response = await adoptCandidate(
      adoptRequest("uptake-session=another-session"),
      {
        params: Promise.resolve({
          surveyId: result.surveyId as string,
          candidateId: candidate.id,
        }),
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: "survey-not-found" });
  });

  it("ignores a client-supplied candidate body during adoption", async () => {
    const { result, cookie } = await surveyed();
    const response = await adoptCandidate(
      adoptRequest(cookie, {
        candidate: {
          ...candidate,
          intent: "Client changed intent",
          discipline: "Client changed discipline",
          evidence: ["invented.md"],
        },
      }),
      {
        params: Promise.resolve({
          surveyId: result.surveyId as string,
          candidateId: candidate.id,
        }),
      },
    );
    expect(await response.json()).toMatchObject({
      pattern: {
        intent: candidate.intent,
        roles: [{ description: candidate.discipline }],
        provenance: [{ path: "CONTRIBUTING.md" }],
      },
    });
  });

  it("reports no-signal with the pinned revision when no file matches a rule", async () => {
    const path = join(sourceRoot, "example", "unmatched");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "index.ts"), "export {}\n");
    execFileSync("git", ["init", "-q"], { cwd: path });
    execFileSync("git", ["add", "."], { cwd: path });
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
      { cwd: path },
    );
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [] }));

    const response = await runSurvey(
      surveyRequest({ repository: "example/unmatched" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "no-signal",
      repository: "example/unmatched",
      revision: expect.any(String),
      collected: [],
      skipped: [],
      discardedEvidence: [],
      discardedCandidates: [],
    });
  });

  it("returns a server error when survey rules cannot be loaded", async () => {
    process.env.UPTAKE_SURVEY_RULES = join(root, "missing-rules.json");
    __setSurveyProposerForTests(createStubSurveyProposer({ candidates: [candidate] }));
    const response = await runSurvey(
      surveyRequest({ repository: "example/one" }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: "survey-rules-error",
      detail: expect.stringContaining("failed to read survey rules"),
    });
  });

  it.each([
    {},
    { repository: "" },
    { repository: " " },
    { repository: "example/one", extra: true },
  ])(
    "rejects an invalid survey request %#",
    async (body) => {
      const response = await runSurvey(surveyRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        status: "invalid-request",
      });
    },
  );

  it("returns the existing configuration error when the proposer model is absent", async () => {
    __setSurveyProposerForTests(undefined);
    const response = await runSurvey(
      surveyRequest({ repository: "example/one" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid-request",
      detail: "UPTAKE_PROPOSER_MODEL is required",
    });
  });

  it("reuses the authoring approval and registration routes", async () => {
    const seedPath = join(catalogDir, "seed.json");
    writeFileSync(seedPath, "seed unchanged\n");
    const { result, cookie } = await surveyed();
    const adoptedResponse = await adoptCandidate(
      adoptRequest(cookie),
      {
        params: Promise.resolve({
          surveyId: result.surveyId as string,
          candidateId: candidate.id,
        }),
      },
    );
    const adopted = (await adoptedResponse.json()) as {
      draftId: string;
      authoringRequest: unknown;
    };
    const context = { params: Promise.resolve({ draftId: adopted.draftId }) };
    const actionRequest = () =>
      new NextRequest("http://localhost/api/authoring/drafts/id", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ request: adopted.authoringRequest }),
      });

    const approved = await approveDraft(actionRequest(), context);
    const approvedBody = await approved.json();
    if (approved.status !== 200) {
      throw new Error(JSON.stringify(approvedBody));
    }
    const registered = await registerDraft(actionRequest(), context);
    expect(registered.status).toBe(200);
    expect(existsSync(join(catalogDir, `${candidate.id}.json`))).toBe(true);
    expect(readFileSync(seedPath, "utf8")).toBe("seed unchanged\n");
  });
});
