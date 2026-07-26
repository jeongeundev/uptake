import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { selfVerifyOracle } from "@/lib/engine/self-verify";
import type { Pattern } from "@/types/pattern";

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;
const fixtureRoot = resolve("tests/fixtures/authoring-selfverify-target");

describe("selfVerifyOracle", () => {
  it(
    "proves the deterministic oracle with a real positive pass and negative failure",
    async () => {
      const result = await selfVerifyOracle(pattern);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.frozenArgv).toContain("--reporter=json");
        expect(existsSync(result.positiveLog)).toBe(true);
        expect(existsSync(result.negativeLog)).toBe(true);
      }
    },
    60_000,
  );

  it(
    "rejects an injection that leaves the gate green",
    async () => {
      if (pattern.oracle === undefined) {
        throw new Error("seed pattern must have an oracle");
      }
      const nonDiscriminating: Pattern = {
        ...pattern,
        oracle: {
          ...pattern.oracle,
          injection: {
            ...pattern.oracle.injection,
            replacement: '"still-declared"',
          },
        },
      };

      await expect(selfVerifyOracle(nonDiscriminating)).resolves.toMatchObject({
        ok: false,
        status: "negative-not-caught",
      });
    },
    60_000,
  );

  it(
    "preserves the committed fixture",
    async () => {
      const fixtureBefore = {
        packageJson: readFileSync(resolve(fixtureRoot, "package.json"), "utf8"),
        config: readFileSync(resolve(fixtureRoot, "vitest.config.ts"), "utf8"),
      };
      await selfVerifyOracle(pattern);

      expect(readFileSync(resolve(fixtureRoot, "package.json"), "utf8")).toBe(
        fixtureBefore.packageJson,
      );
      expect(readFileSync(resolve(fixtureRoot, "vitest.config.ts"), "utf8")).toBe(
        fixtureBefore.config,
      );
    },
    60_000,
  );
});
