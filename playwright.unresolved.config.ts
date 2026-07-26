import { defineConfig, devices } from "@playwright/test";

import { createE2EFixtures } from "./e2e/fixtures.config";

const baseURL = "http://127.0.0.1:3101";
const fixture = createE2EFixtures();

process.env.UPTAKE_E2E_FIXTURE_ROOT = fixture.root;
process.env.UPTAKE_E2E_FIXTURE_OWNED = "1";
process.env.UPTAKE_CATALOG_DIR = fixture.catalogDir;
process.env.UPTAKE_SOURCE_ROOT = fixture.sourceRoot;
process.env.UPTAKE_PROPOSER = "stub";
process.env.UPTAKE_PROPOSER_STUB_SCRIPT =
  fixture.unresolvedProposerStubScript;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "authoring-unresolved.spec.ts",
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
      "npm run build && npx next start --hostname 127.0.0.1 --port 3101",
    env: {
      ...process.env,
      UPTAKE_CATALOG_DIR: fixture.catalogDir,
      UPTAKE_SOURCE_ROOT: fixture.sourceRoot,
      UPTAKE_PROPOSER: "stub",
      UPTAKE_PROPOSER_STUB_SCRIPT:
        fixture.unresolvedProposerStubScript,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
