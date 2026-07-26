import { defineConfig, devices } from "@playwright/test";

import { createE2EFixtures } from "./e2e/fixtures.config";

const baseURL = "http://127.0.0.1:3100";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is required when reusing E2E fixtures`);
  }
  return value;
}

const ownsFixture = process.env.UPTAKE_E2E_FIXTURE_ROOT === undefined;
const fixture =
  ownsFixture
    ? createE2EFixtures()
    : {
        root: requiredEnvironment("UPTAKE_E2E_FIXTURE_ROOT"),
        catalogDir: requiredEnvironment("UPTAKE_CATALOG_DIR"),
        sourceRoot: requiredEnvironment("UPTAKE_SOURCE_ROOT"),
        targetRoot: requiredEnvironment("UPTAKE_E2E_TARGET_ROOT"),
        authoringTargetRoot: requiredEnvironment(
          "UPTAKE_E2E_AUTHORING_TARGET_ROOT",
        ),
        proposerStubScript: requiredEnvironment(
          "UPTAKE_PROPOSER_STUB_SCRIPT",
        ),
        unresolvedProposerStubScript: requiredEnvironment(
          "UPTAKE_UNRESOLVED_PROPOSER_STUB_SCRIPT",
        ),
      };

process.env.UPTAKE_E2E_FIXTURE_ROOT = fixture.root;
process.env.UPTAKE_E2E_FIXTURE_OWNED = ownsFixture ? "1" : "0";
process.env.UPTAKE_CATALOG_DIR = fixture.catalogDir;
process.env.UPTAKE_SOURCE_ROOT = fixture.sourceRoot;
process.env.UPTAKE_E2E_TARGET_ROOT = fixture.targetRoot;
process.env.UPTAKE_E2E_AUTHORING_TARGET_ROOT = fixture.authoringTargetRoot;
process.env.UPTAKE_PROPOSER = "stub";
process.env.UPTAKE_PROPOSER_STUB_SCRIPT = fixture.proposerStubScript;
process.env.UPTAKE_UNRESOLVED_PROPOSER_STUB_SCRIPT =
  fixture.unresolvedProposerStubScript;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "authoring-unresolved.spec.ts",
  fullyParallel: false,
  workers: 1,
  globalTeardown: "./e2e/global-teardown.config.ts",
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "npm run build && npx next start --hostname 127.0.0.1 --port 3100",
    env: {
      ...process.env,
      UPTAKE_CATALOG_DIR: fixture.catalogDir,
      UPTAKE_SOURCE_ROOT: fixture.sourceRoot,
      UPTAKE_PROPOSER: "stub",
      UPTAKE_PROPOSER_STUB_SCRIPT: fixture.proposerStubScript,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
