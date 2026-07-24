import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const targetRoot = process.env.UPTAKE_E2E_TARGET_ROOT;
const catalogDir = process.env.UPTAKE_CATALOG_DIR;

test("completes the Python-to-JS/Vitest vertical slice in Chromium", async ({
  browser,
  page,
}) => {
  expect(targetRoot).toBeTruthy();
  expect(catalogDir).toBeTruthy();
  if (targetRoot === undefined || catalogDir === undefined) {
    throw new Error("E2E fixture environment was not configured");
  }

  const fixturePattern = JSON.parse(
    readFileSync(
      resolve(catalogDir, "spec-change-declaration-gate.json"),
      "utf8",
    ),
  ) as {
    sources: Array<{ stack: string; isTargetStack: boolean }>;
    oracle: { gateTestId: string };
  };
  expect(fixturePattern.sources).toHaveLength(2);
  expect(
    fixturePattern.sources.every(
      ({ stack, isTargetStack }) =>
        stack.startsWith("python/") && !isTargetStack,
    ),
  ).toBe(true);
  expect(
    JSON.parse(readFileSync(resolve(targetRoot, "package.json"), "utf8")),
  ).toMatchObject({ devDependencies: { vitest: expect.any(String) } });

  await page.goto("/");
  const pattern = page
    .getByRole("article")
    .filter({ hasText: "spec-change-declaration-gate" });
  await expect(pattern).toContainText(
    "generative · corroborated · generationEnabled=true",
  );
  await pattern.getByRole("button", { name: "Select pattern" }).click();
  await page
    .getByLabel("Absolute target repository path")
    .fill(targetRoot);

  const workflowResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workflows") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start workflow" }).click();
  const workflow = (await (await workflowResponse).json()) as {
    workflowId: string;
  };

  const bindings = page.getByRole("region", { name: "Bindings" });
  await expect(
    bindings.getByRole("article").filter({ hasText: "checker" }),
  ).toContainText("detected");
  await expect(
    bindings.getByRole("article").filter({ hasText: "checker" }),
  ).toContainText("package.json");
  await expect(
    bindings.getByRole("article").filter({ hasText: "gate-location" }),
  ).toContainText("package.json");
  await bindings.getByLabel("spec-format value").fill("markdown");
  await bindings.getByLabel("naming value").fill("changes/*.md");

  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const denied = await otherContext.request.post(
      `/api/workflows/${workflow.workflowId}/apply`,
    );
    expect(denied.status()).toBe(404);
    await expect(denied.json()).resolves.toMatchObject({
      status: "workflow-not-found",
    });
    expect(existsSync(resolve(targetRoot, "uptake-gate"))).toBe(false);
  } finally {
    await otherContext.close();
  }

  await page.getByRole("button", { name: "Save bindings" }).click();
  const execution = page.getByRole("region", {
    name: "Execution contract",
  });
  await expect(execution).toContainText("vitest.mjs");
  await expect(execution).toContainText(
    "temporary workspace outside the target repository",
  );
  await expect(execution).toContainText("30000 ms");

  await page.getByRole("button", { name: "이식 실행" }).click();
  await expect(page.getByText("awaiting-approval", { exact: true })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.getByText(
      "양성 green과 음성 red가 확인되었습니다. 승인 대기 중입니다.",
    ),
  ).toBeVisible();

  expect(fixturePattern.oracle.gateTestId).toBe("declared-change-present");
  await expect(
    page.getByRole("article").filter({
      hasText: "add · uptake-gate/declared-changes.ts · spec-artifact",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({
      hasText: "add · uptake-gate/spec-gate.test.ts · spec-check",
    }),
  ).toContainText('test("declared-change-present"');

  await page.getByRole("button", { name: "승인 및 적용" }).click();
  await expect(page.getByText("completed", { exact: true })).toBeVisible();
  for (const path of [
    "uptake-gate/declared-changes.ts",
    "uptake-gate/spec-gate.test.ts",
  ]) {
    expect(existsSync(resolve(targetRoot, path))).toBe(true);
  }
});

