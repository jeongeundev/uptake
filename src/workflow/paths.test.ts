import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRun,
  methodPath,
  projectRoot,
  readCurrentRun,
  runDir,
  runsDir,
  sourceRoot,
  templatesDir,
  uptakeDir,
  writeCurrentRun,
} from "@/workflow/paths";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "uptake-workflow-paths-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("project-relative paths", () => {
  it("resolves .uptake state under the given root", () => {
    expect(uptakeDir(root)).toBe(join(root, ".uptake"));
    expect(runsDir(root)).toBe(join(root, ".uptake", "runs"));
    expect(runDir("001-example", root)).toBe(
      join(root, ".uptake", "runs", "001-example"),
    );
    expect(methodPath(root)).toBe(join(root, ".uptake", "METHOD.md"));
  });

  it("defaults projectRoot to process.cwd() when no root is given", () => {
    expect(projectRoot()).toBe(process.cwd());
  });

  it("prefers UPTAKE_SOURCE_ROOT over the project-relative default", () => {
    const previous = process.env.UPTAKE_SOURCE_ROOT;
    try {
      delete process.env.UPTAKE_SOURCE_ROOT;
      expect(sourceRoot(root)).toBe(join(root, ".uptake", "sources"));

      process.env.UPTAKE_SOURCE_ROOT = "/tmp/custom-sources";
      expect(sourceRoot(root)).toBe("/tmp/custom-sources");
    } finally {
      if (previous === undefined) {
        delete process.env.UPTAKE_SOURCE_ROOT;
      } else {
        process.env.UPTAKE_SOURCE_ROOT = previous;
      }
    }
  });
});

describe("templatesDir", () => {
  it("resolves to the package templates directory regardless of cwd", () => {
    const fromHere = templatesDir();
    expect(fromHere).toBe(resolve(__dirname, "..", "..", "templates"));

    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      expect(templatesDir()).toBe(fromHere);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("createRun", () => {
  it("starts at 001 and increments without touching earlier runs", () => {
    const first = createRun("github.com/roberts/laravel-wallets", root);
    expect(first).toBe("001-github-com-roberts-laravel-wallets");
    expect(existsSync(runDir(first, root))).toBe(true);

    const second = createRun("github.com/roberts/laravel-wallets", root);
    expect(second).toBe("002-github-com-roberts-laravel-wallets");
    expect(existsSync(runDir(first, root))).toBe(true);
    expect(existsSync(runDir(second, root))).toBe(true);
  });

  it("keeps the run id safe for path-hostile or empty repository names", () => {
    const evil = createRun("../../evil", root);
    expect(evil).toBe("001-evil");
    expect(existsSync(runDir(evil, root))).toBe(true);

    const empty = createRun("", root);
    expect(empty).toBe("002-repo");

    const unicode = createRun("한글/저장소", root);
    expect(unicode).toMatch(/^003-[a-z0-9-]+$/);
  });
});

describe("current run pointer", () => {
  it("returns undefined when runs/current does not exist", () => {
    expect(readCurrentRun(root)).toBeUndefined();
  });

  it("round-trips a written run id", () => {
    const runId = createRun("example/repo", root);
    writeCurrentRun(runId, root);

    expect(readCurrentRun(root)).toBe(runId);
    expect(readFileSync(join(runsDir(root), "current"), "utf8")).toBe(
      `${runId}\n`,
    );
  });

  it("is a plain file the user can overwrite by hand", () => {
    const first = createRun("example/one", root);
    const second = createRun("example/two", root);
    writeCurrentRun(first, root);
    writeCurrentRun(second, root);

    expect(readCurrentRun(root)).toBe(second);
  });
});
