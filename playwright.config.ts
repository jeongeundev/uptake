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

const fixture =
  process.env.UPTAKE_E2E_FIXTURE_ROOT === undefined
    ? createE2EFixtures()
    : {
        root: requiredEnvironment("UPTAKE_E2E_FIXTURE_ROOT"),
        catalogDir: requiredEnvironment("UPTAKE_CATALOG_DIR"),
        sourceRoot: requiredEnvironment("UPTAKE_SOURCE_ROOT"),
        targetRoot: requiredEnvironment("UPTAKE_E2E_TARGET_ROOT"),
      };

process.env.UPTAKE_E2E_FIXTURE_ROOT = fixture.root;
process.env.UPTAKE_CATALOG_DIR = fixture.catalogDir;
process.env.UPTAKE_SOURCE_ROOT = fixture.sourceRoot;
process.env.UPTAKE_E2E_TARGET_ROOT = fixture.targetRoot;

export default defineConfig({
  testDir: "./e2e",
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
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
