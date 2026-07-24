import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyGenerated, hashTargetBase } from "@/lib/engine/apply";
import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import { hashGenerated } from "@/lib/engine/verify";
import {
  __resetApprovalStoreForTests,
  approveVerification,
  createApproval,
} from "@/services/approval-store";
import type { GeneratedFile } from "@/lib/engine/instantiate";
import type { Pattern } from "@/types/pattern";

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;
const sourceFixture = resolve("tests/fixtures/target-vitest");
const temporaryRoots: string[] = [];

function targetCopy(): string {
  const root = mkdtempSync(resolve(tmpdir(), "uptake-apply-"));
  temporaryRoots.push(root);
  cpSync(sourceFixture, root, { recursive: true });
  return root;
}

function generatedFor(root: string): GeneratedFile[] {
  const result = instantiate(pattern, detectBindings(pattern, root));
  if (!result.ok) {
    throw new Error(result.detail);
  }
  return result.files;
}

function approval(root: string, files: GeneratedFile[]): string {
  return createApproval({
    patternId: pattern.patternId,
    targetRepoRoot: root,
    contentHash: hashGenerated(files),
    targetBaseHash: hashTargetBase(root),
    frozenArgv: ["node", "vitest", "run"],
  });
}

beforeEach(__resetApprovalStoreForTests);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("applyGenerated", () => {
  it("writes the verified files when approval and base hashes match", () => {
    const root = targetCopy();
    const files = generatedFor(root);
    const verificationId = approval(root, files);
    expect(approveVerification(verificationId)).toEqual({ ok: true });

    expect(applyGenerated(verificationId, files, root)).toEqual({
      status: "completed",
      written: files.map(({ path }) => path),
    });
    for (const file of files) {
      expect(readFileSync(resolve(root, file.path), "utf8")).toBe(file.content);
    }
  });

  it("rejects changed generated content without writing", () => {
    const root = targetCopy();
    const files = generatedFor(root);
    const approved = approval(root, files);
    expect(approveVerification(approved)).toEqual({ ok: true });
    const changed = files.map((file, index) =>
      index === 0 ? { ...file, content: `${file.content}\nchanged` } : file,
    );

    expect(applyGenerated(approved, changed, root)).toMatchObject({
      status: "diff-mismatch",
    });
    expect(changed.every(({ path }) => !existsSync(resolve(root, path)))).toBe(
      true,
    );
  });

  it("rejects a pending verification without writing", () => {
    const root = targetCopy();
    const files = generatedFor(root);
    const verificationId = approval(root, files);

    expect(applyGenerated(verificationId, files, root)).toMatchObject({
      status: "not-approved",
    });
    expect(files.every(({ path }) => !existsSync(resolve(root, path)))).toBe(
      true,
    );
  });

  it("rejects an unknown verification id without writing", () => {
    const root = targetCopy();
    const files = generatedFor(root);

    expect(applyGenerated("forged-id", files, root)).toMatchObject({
      status: "unknown-approval",
    });
    expect(files.every(({ path }) => !existsSync(resolve(root, path)))).toBe(
      true,
    );
  });

  it("rejects reuse after a successful apply without another write", () => {
    const root = targetCopy();
    const files = generatedFor(root);
    const verificationId = approval(root, files);
    expect(approveVerification(verificationId)).toEqual({ ok: true });
    expect(applyGenerated(verificationId, files, root)).toMatchObject({
      status: "completed",
    });

    expect(applyGenerated(verificationId, files, root)).toMatchObject({
      status: "not-approved",
    });
    for (const file of files) {
      expect(readFileSync(resolve(root, file.path), "utf8")).toBe(file.content);
    }
  });

  it("rejects a changed target base without writing", () => {
    const root = targetCopy();
    const files = generatedFor(root);
    const approved = approval(root, files);
    expect(approveVerification(approved)).toEqual({ ok: true });
    writeFileSync(resolve(root, "package.json"), '{"changed":true}\n', "utf8");

    expect(applyGenerated(approved, files, root)).toMatchObject({
      status: "base-changed",
    });
    expect(files.every(({ path }) => !existsSync(resolve(root, path)))).toBe(
      true,
    );
  });

  it("rolls back files written before a later write fails", () => {
    const root = targetCopy();
    const files: GeneratedFile[] = [
      { path: "new/first.ts", role: "spec-artifact", content: "first" },
      { path: "package.json/second.ts", role: "spec-check", content: "second" },
    ];
    const verificationId = approval(root, files);
    expect(approveVerification(verificationId)).toEqual({ ok: true });

    expect(applyGenerated(verificationId, files, root)).toMatchObject({
      status: "apply-failed",
    });
    expect(existsSync(resolve(root, files[0].path))).toBe(false);
    expect(readFileSync(resolve(root, "package.json"), "utf8")).not.toBe(
      "second",
    );
  });
});
