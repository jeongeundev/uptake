import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
  delete process.env.UPTAKE_PROPOSER;
  delete process.env.UPTAKE_PROPOSER_STUB_SCRIPT;
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

  it("loads a scripted stub only when explicitly configured", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "uptake-proposer-script-"));
    const scriptPath = resolve(root, "script.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        metadata: { providerId: "stub", modelId: "e2e-script" },
        fileCandidates: [
          {
            sourceId: "source-1",
            path: "spec.md",
            roleId: "spec-artifact",
            rationale: "fixture",
          },
        ],
      }),
    );
    process.env.UPTAKE_PROPOSER = "stub";
    process.env.UPTAKE_PROPOSER_STUB_SCRIPT = scriptPath;

    const proposer = configuredAuthoringProposer();

    expect(proposer.metadata).toEqual({
      providerId: "stub",
      modelId: "e2e-script",
    });
    await expect(
      proposer.proposeFileCandidates({
        intent: "fixture",
        sourceId: "source-1",
        repository: "fixtures/source-one",
        revision: "a".repeat(40),
        files: ["spec.md"],
        roleIds: ["spec-artifact"],
      }),
    ).resolves.toEqual([
      {
        sourceId: "source-1",
        path: "spec.md",
        roleId: "spec-artifact",
        rationale: "fixture",
      },
    ]);
    expect(createAnthropicProposerFromEnv).not.toHaveBeenCalled();
  });
});
