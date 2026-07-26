import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const catalogDir = process.env.UPTAKE_CATALOG_DIR;
const targetRoot = process.env.UPTAKE_E2E_AUTHORING_TARGET_ROOT;
const patternId = "authored-spec-verification-loop";
const seedName = "spec-change-declaration-gate.json";

test("authors, registers, instantiates, verifies, and applies a new anchor pattern", async ({
  page,
}) => {
  expect(catalogDir).toBeTruthy();
  expect(targetRoot).toBeTruthy();
  if (catalogDir === undefined || targetRoot === undefined) {
    throw new Error("Authoring E2E fixture environment was not configured");
  }

  const seedPath = resolve(catalogDir, seedName);
  const seedBefore = readFileSync(seedPath, "utf8");
  const catalogBefore = readdirSync(catalogDir).sort();

  await page.goto("/#authoring");
  const authoring = page.locator("#authoring");
  await authoring.getByLabel("patternId").fill(patternId);
  await authoring.getByLabel("name").fill("Authored spec verification loop");
  await authoring
    .getByLabel("intent")
    .fill("Observe how repositories bind change specifications to gates.");
  await authoring.getByLabel("capability").selectOption("generative");
  await authoring.getByLabel("evidenceStatus").selectOption("corroborated");

  const firstSource = authoring.getByRole("group", { name: "source-1" });
  await firstSource.getByLabel("repository").fill("fixtures/python-one");
  await firstSource.getByLabel("stack", { exact: true }).fill("python/pytest");
  await firstSource.getByLabel("independenceGroup").fill("independent-one");
  await firstSource
    .getByLabel("independenceNote")
    .fill("Independent E2E source one.");
  await firstSource.locator("select").selectOption("false");

  await authoring.getByRole("button", { name: "소스 추가" }).click();
  const secondSource = authoring.getByRole("group", { name: "source-2" });
  await secondSource.getByLabel("repository").fill("fixtures/python-two");
  await secondSource.getByLabel("stack", { exact: true }).fill("python/pytest");
  await secondSource.getByLabel("independenceGroup").fill("independent-two");
  await secondSource
    .getByLabel("independenceNote")
    .fill("Independent E2E source two.");
  await secondSource.locator("select").selectOption("false");

  await authoring.getByRole("button", { name: "초안 생성" }).click();
  const review = authoring.getByLabel("저작 초안 검토");
  for (const role of ["spec-artifact", "spec-check", "blocking-gate"]) {
    await expect(review).toContainText(role, { timeout: 30_000 });
  }
  await expect(review).toContainText("changes/12359.feature.md");
  await expect(review).toContainText("distinct 2");
  await expect(review).toContainText(
    "양성 green과 음성 red가 확인되었습니다.",
    { timeout: 30_000 },
  );
  await expect(review).toContainText("missing/provenance.md");
  await expect(review).toContainText("provenance-unresolved");

  expect(readdirSync(catalogDir).sort()).toEqual(catalogBefore);
  expect(existsSync(resolve(catalogDir, `${patternId}.json`))).toBe(false);

  await review.getByRole("button", { name: "초안 승인" }).click();
  await expect(
    review.getByRole("button", { name: "서버 승인 완료" }),
  ).toBeVisible();
  await authoring.getByRole("button", { name: "카탈로그 등재" }).click();
  await expect(authoring).toContainText("카탈로그에 등재되었습니다.");

  const authoredPath = resolve(catalogDir, `${patternId}.json`);
  expect(existsSync(authoredPath)).toBe(true);
  expect(JSON.parse(readFileSync(authoredPath, "utf8"))).toMatchObject({
    patternId,
    capability: "generative",
    evidenceStatus: "corroborated",
  });
  expect(readFileSync(seedPath, "utf8")).toBe(seedBefore);

  await page.reload();
  const instantiation = page.locator("#instantiation");
  const pattern = instantiation
    .getByRole("article")
    .filter({ hasText: patternId });
  await expect(pattern).toContainText(
    "generative · corroborated · generationEnabled=true",
  );
  await pattern.getByRole("button", { name: "Select pattern" }).click();
  await instantiation
    .getByLabel("Absolute target repository path")
    .fill(targetRoot);
  await instantiation.getByRole("button", { name: "Start workflow" }).click();

  const bindings = instantiation.getByRole("region", { name: "Bindings" });
  await bindings.getByLabel("spec-format value").fill("markdown");
  await bindings.getByLabel("naming value").fill("changes/*.md");
  await bindings.getByRole("button", { name: "Save bindings" }).click();
  await instantiation.getByRole("button", { name: "이식 실행" }).click();
  await expect(
    instantiation.getByText("awaiting-approval", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await instantiation.getByRole("button", { name: "승인 및 적용" }).click();
  await expect(
    instantiation.getByText("completed", { exact: true }),
  ).toBeVisible();

  expect(
    existsSync(resolve(targetRoot, "uptake-gate/declared-changes.ts")),
  ).toBe(true);
  expect(
    existsSync(resolve(targetRoot, "uptake-gate/spec-gate.test.ts")),
  ).toBe(true);
  expect(readFileSync(seedPath, "utf8")).toBe(seedBefore);
});
