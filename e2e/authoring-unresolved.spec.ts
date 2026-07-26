import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const catalogDir = process.env.UPTAKE_CATALOG_DIR;

function catalogSnapshot(root: string): Map<string, Buffer> {
  return new Map(
    readdirSync(root)
      .sort()
      .map((name) => [name, readFileSync(resolve(root, name))]),
  );
}

test("rejects unresolved-only evidence without changing the catalog", async ({
  page,
}) => {
  expect(catalogDir).toBeTruthy();
  if (catalogDir === undefined) {
    throw new Error("Authoring E2E fixture environment was not configured");
  }
  const catalogBefore = catalogSnapshot(catalogDir);

  await page.goto("/#authoring");
  const authoring = page.locator("#authoring");
  await authoring.getByLabel("patternId").fill("unresolved-only-method");
  await authoring.getByLabel("name").fill("Unresolved-only method");
  await authoring
    .getByLabel("intent")
    .fill("Observe a repository method.");

  const source = authoring.getByRole("group", { name: "source-1" });
  await source.getByLabel("repository").fill("fixtures/python-one");
  await source.getByLabel("stack", { exact: true }).fill("python/pytest");
  await source.getByLabel("independenceGroup").fill("independent-one");
  await source
    .getByLabel("independenceNote")
    .fill("Independent unresolved E2E source.");
  await source.locator("select").selectOption("false");

  await authoring.getByRole("button", { name: "초안 생성" }).click();
  await expect(authoring).toContainText("provenance-unresolved");
  await expect(
    authoring.getByRole("button", { name: "초안 승인" }),
  ).toHaveCount(0);
  await expect(
    authoring.getByRole("button", { name: "카탈로그 등재" }),
  ).toHaveCount(0);

  const catalogAfter = catalogSnapshot(catalogDir);
  expect([...catalogAfter.keys()]).toEqual([...catalogBefore.keys()]);
  for (const [name, bytes] of catalogBefore) {
    expect(catalogAfter.get(name)).toEqual(bytes);
  }
});
