import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { BindingDetection } from "@/lib/engine/detect";
import type { GeneratedFile, InstantiateResult } from "@/lib/engine/instantiate";
import {
  DEFAULT_GATE_TIMEOUT_MS,
  runGate,
  type GateOutcome,
} from "@/services/gate-runner";
import type { InstantiatedInjection, Pattern } from "@/types/pattern";

export type Generated = Extract<InstantiateResult, { ok: true }>;

export type PreparedVerification = {
  status: "prepared";
  frozenArgv: string[];
  generated: Generated;
  gateTestId: string;
  bindings: BindingDetection[];
  targetRepoRoot: string;
};

export type PrepareRejected = {
  status: "positive-failed";
  detail: string;
};

export type VerifyOutcome =
  | {
      status: "awaiting-approval";
      contentHash: string;
      frozenArgv: string[];
      positiveLog: string;
      negativeLog: string;
      positivePreview: string;
      positiveTruncated: boolean;
      negativePreview: string;
      negativeTruncated: boolean;
    }
  | {
      status:
        | "positive-failed"
        | "injection-failed"
        | "gate-error"
        | "negative-not-caught"
        | "timeout";
      detail: string;
      frozenArgv?: string[];
    };

const execFileAsync = promisify(execFile);
const vitestBin = resolve("node_modules/vitest/vitest.mjs");

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

async function trackedFiles(targetRepoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--", "."],
    { cwd: targetRepoRoot, encoding: "buffer" },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

async function copyTrackedFiles(
  targetRepoRoot: string,
  workspace: string,
): Promise<void> {
  for (const path of await trackedFiles(targetRepoRoot)) {
    const source = resolve(targetRepoRoot, path);
    const destination = resolve(workspace, path);
    if (!inside(workspace, destination)) {
      throw new Error(`tracked path escapes workspace: ${path}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    const stats = await lstat(source);
    if (stats.isSymbolicLink()) {
      await symlink(await readlink(source), destination);
    } else {
      await copyFile(source, destination);
      await chmod(destination, stats.mode);
    }
  }
}

async function writeGenerated(
  workspace: string,
  files: GeneratedFile[],
): Promise<void> {
  for (const file of files) {
    const destination = resolve(workspace, file.path);
    if (!inside(workspace, destination)) {
      throw new Error(`generated path escapes workspace: ${file.path}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
  }
}

function freezeArgv(
  generated: Generated,
  bindings: BindingDetection[],
): string[] {
  const checker = bindings.find(({ kind }) => kind === "checker");
  const gateLocation = bindings.find(({ kind }) => kind === "gate-location");
  const gate = generated.files.find(({ role }) => role === "spec-check");
  if (
    checker === undefined ||
    checker.status === "binding-unresolved" ||
    checker.value !== "vitest" ||
    gateLocation === undefined ||
    gateLocation.status === "binding-unresolved" ||
    gate === undefined
  ) {
    throw new Error("resolved vitest checker and gate-location are required");
  }
  return [
    process.execPath,
    vitestBin,
    "run",
    "--globals",
    "--reporter=json",
    gate.path,
  ];
}

async function applyInjection(
  workspace: string,
  injection: InstantiatedInjection,
): Promise<void> {
  const injectionPath = resolve(workspace, injection.path);
  if (!inside(workspace, injectionPath)) {
    throw new Error(`injection path escapes workspace: ${injection.path}`);
  }
  const resolvedWorkspace = await realpath(workspace);
  const resolvedPath = await realpath(injectionPath);
  if (!inside(resolvedWorkspace, resolvedPath)) {
    throw new Error(
      `injection path resolves outside workspace: ${injection.path}`,
    );
  }
  const content = await readFile(resolvedPath, "utf8");
  const occurrences =
    injection.marker.length === 0
      ? 0
      : content.split(injection.marker).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `marker must appear exactly once in ${injection.path}; found ${occurrences}`,
    );
  }
  await writeFile(
    resolvedPath,
    content.replace(injection.marker, injection.replacement),
    "utf8",
  );
}

function errorStatus(
  outcome: Extract<GateOutcome, { kind: "error" }>,
): "gate-error" | "timeout" {
  return outcome.detail.includes("timeout") ? "timeout" : "gate-error";
}

export function hashGenerated(files: GeneratedFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    for (const value of [file.path, file.role, file.content]) {
      hash.update(String(Buffer.byteLength(value)));
      hash.update(":");
      hash.update(value);
    }
  }
  return hash.digest("hex");
}

export function prepareVerification(
  pattern: Pattern,
  generated: Generated,
  bindings: BindingDetection[],
  targetRepoRoot: string,
): PreparedVerification | PrepareRejected {
  const gateTestId = pattern.oracle?.gateTestId;

  if (gateTestId === undefined || gateTestId !== generated.gateTestId) {
    return {
      status: "positive-failed",
      detail: "generated gate test id does not match the pattern oracle",
    };
  }

  try {
    return {
      status: "prepared",
      frozenArgv: freezeArgv(generated, bindings),
      generated,
      gateTestId,
      bindings,
      targetRepoRoot,
    };
  } catch (error) {
    return {
      status: "positive-failed",
      detail: error instanceof Error ? error.message : "argv binding failed",
    };
  }
}

export async function executeVerification(
  prepared: PreparedVerification,
): Promise<VerifyOutcome> {
  let positiveWorkspace: string | undefined;
  let negativeWorkspace: string | undefined;
  const {
    bindings,
    frozenArgv,
    gateTestId,
    generated,
    targetRepoRoot,
  } = prepared;

  let recalculatedArgv: string[];
  try {
    recalculatedArgv = freezeArgv(generated, bindings);
  } catch {
    return {
      status: "positive-failed",
      detail: "prepared argv no longer matches generated output and bindings",
      frozenArgv,
    };
  }
  if (
    recalculatedArgv.length !== frozenArgv.length ||
    recalculatedArgv.some((value, index) => value !== frozenArgv[index])
  ) {
    return {
      status: "positive-failed",
      detail: "prepared argv no longer matches generated output and bindings",
      frozenArgv,
    };
  }

  try {
    positiveWorkspace = await mkdtemp(resolve(tmpdir(), "uptake-pos-"));
    await copyTrackedFiles(targetRepoRoot, positiveWorkspace);
    await writeGenerated(positiveWorkspace, generated.files);

    const positive = await runGate(
      frozenArgv,
      positiveWorkspace,
      DEFAULT_GATE_TIMEOUT_MS,
    );
    if (positive.kind === "error") {
      return {
        status: errorStatus(positive),
        detail: positive.detail,
        frozenArgv,
      };
    }
    if (positive.perTest[gateTestId] !== "passed") {
      return {
        status: "positive-failed",
        detail: `gate test ${gateTestId} did not pass`,
        frozenArgv,
      };
    }

    negativeWorkspace = await mkdtemp(resolve(tmpdir(), "uptake-neg-"));
    for (const entry of await readdir(positiveWorkspace)) {
      await cp(
        resolve(positiveWorkspace, entry),
        resolve(negativeWorkspace, entry),
        { recursive: true, preserveTimestamps: true },
      );
    }
    try {
      await applyInjection(negativeWorkspace, generated.injection);
    } catch (error) {
      return {
        status: "injection-failed",
        detail:
          error instanceof Error ? error.message : "violation injection failed",
        frozenArgv,
      };
    }

    const negative = await runGate(
      frozenArgv,
      negativeWorkspace,
      DEFAULT_GATE_TIMEOUT_MS,
    );
    if (negative.kind === "error") {
      return {
        status: errorStatus(negative),
        detail: negative.detail,
        frozenArgv,
      };
    }
    if (negative.perTest[gateTestId] === "passed") {
      return {
        status: "negative-not-caught",
        detail: `gate test ${gateTestId} still passed after injection`,
        frozenArgv,
      };
    }
    if (negative.perTest[gateTestId] !== "failed") {
      return {
        status: "gate-error",
        detail: `gate test ${gateTestId} was absent from the negative report`,
        frozenArgv,
      };
    }

    return {
      status: "awaiting-approval",
      contentHash: hashGenerated(generated.files),
      frozenArgv,
      positiveLog: positive.logPath,
      negativeLog: negative.logPath,
      positivePreview: positive.outputPreview,
      positiveTruncated: positive.outputTruncated,
      negativePreview: negative.outputPreview,
      negativeTruncated: negative.outputTruncated,
    };
  } catch (error) {
    return {
      status: "gate-error",
      detail: error instanceof Error ? error.message : "verification failed",
      frozenArgv,
    };
  } finally {
    if (negativeWorkspace !== undefined) {
      await rm(negativeWorkspace, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (positiveWorkspace !== undefined) {
      await rm(positiveWorkspace, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
