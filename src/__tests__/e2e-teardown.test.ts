import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import globalTeardown from "../../e2e/global-teardown.config";

const originalRoot = process.env.UPTAKE_E2E_FIXTURE_ROOT;
const originalOwned = process.env.UPTAKE_E2E_FIXTURE_OWNED;

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.UPTAKE_E2E_FIXTURE_ROOT;
  } else {
    process.env.UPTAKE_E2E_FIXTURE_ROOT = originalRoot;
  }
  if (originalOwned === undefined) {
    delete process.env.UPTAKE_E2E_FIXTURE_OWNED;
  } else {
    process.env.UPTAKE_E2E_FIXTURE_OWNED = originalOwned;
  }
});

describe("globalTeardown", () => {
  it("removes a fixture root owned by this run", () => {
    const root = mkdtempSync(resolve(tmpdir(), "uptake-owned-fixture-"));
    process.env.UPTAKE_E2E_FIXTURE_ROOT = root;
    process.env.UPTAKE_E2E_FIXTURE_OWNED = "1";

    globalTeardown();

    expect(existsSync(root)).toBe(false);
  });

  it("preserves an externally provided fixture root", () => {
    const root = mkdtempSync(resolve(tmpdir(), "uptake-external-fixture-"));
    const sentinel = resolve(root, "sentinel");
    writeFileSync(sentinel, "keep");
    process.env.UPTAKE_E2E_FIXTURE_ROOT = root;
    process.env.UPTAKE_E2E_FIXTURE_OWNED = "0";

    globalTeardown();

    expect(existsSync(sentinel)).toBe(true);
  });
});
