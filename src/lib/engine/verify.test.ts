import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import {
  executeVerification,
  hashGenerated,
  prepareVerification,
  type PreparedVerification,
} from "@/lib/engine/verify";
import { runGate } from "@/services/gate-runner";
import type { GateOutcome } from "@/services/gate-runner";
import type { Pattern } from "@/types/pattern";

vi.mock("@/services/gate-runner", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/gate-runner")>();
  return { ...original, runGate: vi.fn() };
});

const pattern = JSON.parse(
  readFileSync(
    resolve("catalog/spec-change-declaration-gate.json"),
    "utf8",
  ),
) as Pattern;
const targetRoot = resolve("tests/fixtures/target-vitest");
const bindings = detectBindings(pattern, targetRoot);
const instantiated = instantiate(pattern, bindings);

if (!instantiated.ok) {
  throw new Error(`fixture instantiation failed: ${instantiated.detail}`);
}

const mockedRunGate = vi.mocked(runGate);

function ran(status: "passed" | "failed", logPath: string): GateOutcome {
  return {
    kind: "ran",
    perTest: { [instantiated.gateTestId]: status },
    logPath,
  };
}

function targetSnapshot(): { status: string; hash: string } {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "."], {
    cwd: targetRoot,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const path of tracked) {
    hash.update(path);
    hash.update(readFileSync(resolve(targetRoot, path)));
  }
  return {
    status: execFileSync("git", ["status", "--short", "--", "."], {
      cwd: targetRoot,
    }).toString("utf8"),
    hash: hash.digest("hex"),
  };
}

beforeEach(() => {
  mockedRunGate.mockReset();
});

function prepare(): PreparedVerification {
  const result = prepareVerification(
    pattern,
    instantiated,
    bindings,
    targetRoot,
  );
  if (result.status !== "prepared") {
    throw new Error(`fixture preparation failed: ${result.detail}`);
  }
  return result;
}

describe("prepareVerification", () => {
  it("returns frozen argv without running the gate", () => {
    const prepared = prepare();

    expect(prepared.frozenArgv).toEqual(expect.any(Array));
    expect(mockedRunGate).not.toHaveBeenCalled();
  });
});

describe("executeVerification", () => {
  it("keeps the target immutable and accepts positive pass plus negative fail", async () => {
    const before = targetSnapshot();
    const workspaces: string[] = [];
    mockedRunGate.mockImplementation(async (_argv, cwd) => {
      workspaces.push(cwd);
      expect(readFileSync(resolve(cwd, instantiated.files[0].path), "utf8")).toBe(
        workspaces.length === 1
          ? instantiated.files[0].content
          : instantiated.files[0].content.replace(
              instantiated.injection.marker,
              instantiated.injection.replacement,
            ),
      );
      return workspaces.length === 1
        ? ran("passed", "/logs/positive.log")
        : ran("failed", "/logs/negative.log");
    });

    const outcome = await executeVerification(prepare());

    expect(outcome).toEqual({
      status: "awaiting-approval",
      contentHash: hashGenerated(instantiated.files),
      frozenArgv: expect.any(Array),
      positiveLog: "/logs/positive.log",
      negativeLog: "/logs/negative.log",
    });
    expect(targetSnapshot()).toEqual(before);
    expect(workspaces).toHaveLength(2);
    expect(workspaces.every((workspace) => !existsSync(workspace))).toBe(true);
  });

  it("uses one frozen argv for both runs and returns that exact argv", async () => {
    mockedRunGate
      .mockResolvedValueOnce(ran("passed", "/logs/positive.log"))
      .mockResolvedValueOnce(ran("failed", "/logs/negative.log"));

    const outcome = await executeVerification(prepare());

    expect(mockedRunGate).toHaveBeenCalledTimes(2);
    const positiveArgv = mockedRunGate.mock.calls[0][0];
    const negativeArgv = mockedRunGate.mock.calls[1][0];
    expect(negativeArgv).toEqual(positiveArgv);
    expect(negativeArgv).toBe(positiveArgv);
    expect(outcome).toMatchObject({ frozenArgv: positiveArgv });
  });

  it.each([
    ["zero", (content: string) => content.replace(instantiated.injection.marker, "")],
    ["multiple", (content: string) => `${content}${instantiated.injection.marker}`],
  ])("rejects an injection whose marker occurs %s times", async (_name, changeContent) => {
    mockedRunGate.mockResolvedValueOnce(
      ran("passed", "/logs/positive.log"),
    );
    const files = instantiated.files.map((file) =>
      file.path === instantiated.injection.path
        ? { ...file, content: changeContent(file.content) }
        : file,
    );

    const prepared = prepareVerification(
      pattern,
      { ...instantiated, files },
      bindings,
      targetRoot,
    );
    if (prepared.status !== "prepared") {
      throw new Error(`fixture preparation failed: ${prepared.detail}`);
    }
    const outcome = await executeVerification(prepared);

    expect(outcome).toMatchObject({ status: "injection-failed" });
    expect(mockedRunGate).toHaveBeenCalledTimes(1);
  });

  it("rejects an injection path that escapes the negative workspace", async () => {
    mockedRunGate.mockResolvedValueOnce(
      ran("passed", "/logs/positive.log"),
    );

    const prepared = prepareVerification(
      pattern,
      {
        ...instantiated,
        injection: { ...instantiated.injection, path: "../outside.ts" },
      },
      bindings,
      targetRoot,
    );
    if (prepared.status !== "prepared") {
      throw new Error(`fixture preparation failed: ${prepared.detail}`);
    }
    const outcome = await executeVerification(prepared);

    expect(outcome).toMatchObject({ status: "injection-failed" });
  });

  it.each([
    [
      "infrastructure error",
      { kind: "error", detail: "reporter parse failed", logPath: "/logs/error.log" },
      "gate-error",
    ],
    [
      "timeout",
      { kind: "error", detail: "timeout after 30000ms", logPath: "/logs/error.log" },
      "timeout",
    ],
  ] as const)("maps a negative %s without counting it as red", async (_name, negative, status) => {
    mockedRunGate
      .mockResolvedValueOnce(ran("passed", "/logs/positive.log"))
      .mockResolvedValueOnce(negative);

    await expect(
      executeVerification(prepare()),
    ).resolves.toMatchObject({ status });
  });

  it.each([
    [
      "infrastructure error",
      { kind: "error", detail: "reporter parse failed", logPath: "/logs/error.log" },
      "gate-error",
    ],
    [
      "timeout",
      { kind: "error", detail: "timeout after 30000ms", logPath: "/logs/error.log" },
      "timeout",
    ],
  ] as const)("maps a positive %s to its infrastructure status", async (_name, positive, status) => {
    mockedRunGate.mockResolvedValueOnce(positive);

    await expect(
      executeVerification(prepare()),
    ).resolves.toMatchObject({ status });
  });

  it("reports negative-not-caught when the injected violation stays green", async () => {
    mockedRunGate
      .mockResolvedValueOnce(ran("passed", "/logs/positive.log"))
      .mockResolvedValueOnce(ran("passed", "/logs/negative.log"));

    await expect(
      executeVerification(prepare()),
    ).resolves.toMatchObject({ status: "negative-not-caught" });
  });

  it("requires the oracle test itself to pass in the positive run", async () => {
    mockedRunGate.mockResolvedValueOnce({
      kind: "ran",
      perTest: { "unrelated-test": "passed" },
      logPath: "/logs/positive.log",
    });

    await expect(
      executeVerification(prepare()),
    ).resolves.toMatchObject({ status: "positive-failed" });
    expect(mockedRunGate).toHaveBeenCalledTimes(1);
  });

  it("rejects execution when generated output changes the displayed argv", async () => {
    const prepared = prepare();
    const gate = prepared.generated.files.find(
      ({ role }) => role === "spec-check",
    );
    if (gate === undefined) {
      throw new Error("fixture gate file is missing");
    }
    gate.path = "uptake-gate/changed-spec-gate.test.ts";

    await expect(executeVerification(prepared)).resolves.toMatchObject({
      status: "positive-failed",
      detail: "prepared argv no longer matches generated output and bindings",
    });
    expect(mockedRunGate).not.toHaveBeenCalled();
  });
});

describe("hashGenerated", () => {
  it("is deterministic and includes paths and contents", () => {
    const original = hashGenerated(instantiated.files);
    expect(hashGenerated(instantiated.files)).toBe(original);
    expect(
      hashGenerated([
        { ...instantiated.files[0], content: `${instantiated.files[0].content}\n` },
        instantiated.files[1],
      ]),
    ).not.toBe(original);
  });
});
