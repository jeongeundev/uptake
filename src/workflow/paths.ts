import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Package-installed assets (templates/) resolve from this file's own
// location, not process.cwd() — a CLI command runs with cwd set to the
// user's repository, where the package's templates/ does not exist (ADR-024).
const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, "..", "..");

export function projectRoot(root?: string): string {
  return root === undefined ? process.cwd() : resolve(root);
}

export function uptakeDir(root?: string): string {
  return join(projectRoot(root), ".uptake");
}

export function runsDir(root?: string): string {
  return join(uptakeDir(root), "runs");
}

export function runDir(runId: string, root?: string): string {
  return join(runsDir(root), runId);
}

export function methodPath(root?: string): string {
  return join(uptakeDir(root), "METHOD.md");
}

export function sourceRoot(root?: string): string {
  return process.env.UPTAKE_SOURCE_ROOT ?? join(uptakeDir(root), "sources");
}

export function templatesDir(): string {
  return join(packageRoot, "templates");
}

function currentRunPath(root?: string): string {
  return join(runsDir(root), "current");
}

export function readCurrentRun(root?: string): string | undefined {
  try {
    const content = readFileSync(currentRunPath(root), "utf8").trim();
    return content === "" ? undefined : content;
  } catch {
    return undefined;
  }
}

export function writeCurrentRun(runId: string, root?: string): void {
  mkdirSync(runsDir(root), { recursive: true });
  writeFileSync(currentRunPath(root), `${runId}\n`, "utf8");
}

const runSequencePattern = /^(\d{3,})-/;

function slugify(repository: string): string {
  const slug = repository
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "repo" : slug;
}

function nextSequence(root?: string): string {
  let entries: string[];
  try {
    entries = readdirSync(runsDir(root));
  } catch {
    entries = [];
  }

  let max = 0;
  for (const entry of entries) {
    const match = runSequencePattern.exec(entry);
    if (match !== null) {
      const value = Number.parseInt(match[1], 10);
      if (value > max) {
        max = value;
      }
    }
  }
  return String(max + 1).padStart(3, "0");
}

export function createRun(repository: string, root?: string): string {
  const runId = `${nextSequence(root)}-${slugify(repository)}`;
  mkdirSync(runDir(runId, root), { recursive: true });
  return runId;
}
