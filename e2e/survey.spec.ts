import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const catalogDir = process.env.UPTAKE_CATALOG_DIR;
const repository = process.env.UPTAKE_E2E_SURVEY_REPOSITORY;
const patternId = "repository-check-discipline";
const seedName = "spec-change-declaration-gate.json";

test("surveys, adopts, registers, and reloads an observed pattern", async ({
  page,
}) => {
  expect(catalogDir).toBeTruthy();
  expect(repository).toBeTruthy();
  if (catalogDir === undefined || repository === undefined) {
    throw new Error("SURVEY E2E fixture environment was not configured");
  }

  const seedPath = resolve(catalogDir, seedName);
  const seedBefore = readFileSync(seedPath, "utf8");
  const registeredPath = resolve(catalogDir, `${patternId}.json`);

  await page.goto("/#survey");
  const survey = page.locator("#survey");
  await survey.getByLabel("저장소 식별자").fill(repository);
  await survey.getByRole("button", { name: "조사", exact: true }).click();

  const results = survey.getByLabel("SURVEY 조사 결과");
  await expect(results).toContainText("Repository check discipline");
  await expect(results).toContainText("AGENTS.md");
  await expect(results).toContainText("scripts/enforce.py");
  await expect(results).toContainText(".github/workflows/verify.yml");
  await expect(results).toContainText("missing/not-collected.md");
  await expect(results).toContainText("not-collected");
  await expect(results).toContainText("hallucinated-discipline · no-evidence");
  await expect(results).toContainText(
    "그 저장소가 만든 규율과 템플릿에서 상속된 규율을 구분하지 않습니다.",
  );
  await expect(results).toContainText(
    "observed는 “이 저장소가 실제로 이렇게 한다”까지만 주장합니다.",
  );

  await results
    .getByText("Repository check discipline", { exact: true })
    .click();
  const [adoptResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/candidates/repository-check-discipline/adopt"),
    ),
    results
      .getByRole("button", { name: "선택 후보 채택" })
      .click(),
  ]);

  const draft = survey.getByLabel("SURVEY 채택 초안");
  await expect(draft).toContainText("observed · descriptive");
  const adopted = (await adoptResponse.json()) as {
    pattern: {
      capability: string;
      evidenceStatus: string;
      roles: unknown[];
      bindingPoints: unknown[];
    };
  };
  expect(adopted.pattern).toMatchObject({
    capability: "descriptive",
    evidenceStatus: "observed",
  });
  expect(adopted.pattern.roles).toHaveLength(1);
  expect(adopted.pattern.bindingPoints).toEqual([]);

  await draft.getByRole("button", { name: "초안 승인" }).click();
  await expect(
    draft.getByRole("button", { name: "서버 승인 완료" }),
  ).toBeVisible();
  await draft.getByRole("button", { name: "카탈로그 등재" }).click();
  await expect(survey.getByLabel("SURVEY 등재 결과")).toContainText(
    "카탈로그에 등재되었습니다.",
  );

  expect(existsSync(registeredPath)).toBe(true);
  const registered = JSON.parse(readFileSync(registeredPath, "utf8")) as {
    capability: string;
    evidenceStatus: string;
    roles: unknown[];
    bindingPoints: unknown[];
  };
  expect(registered).toMatchObject({
    capability: "descriptive",
    evidenceStatus: "observed",
  });
  expect(registered.roles).toHaveLength(1);
  expect(registered.bindingPoints).toEqual([]);

  const catalogResponse = await page.request.get("/api/catalog");
  expect(catalogResponse.ok()).toBe(true);
  const catalog = (await catalogResponse.json()) as {
    loaded: { pattern: { patternId: string } }[];
    rejected: { patternId: string }[];
  };
  expect(
    catalog.loaded.some((entry) => entry.pattern.patternId === patternId),
  ).toBe(true);
  expect(
    catalog.rejected.some((entry) => entry.patternId === patternId),
  ).toBe(false);
  expect(readFileSync(seedPath, "utf8")).toBe(seedBefore);
});
