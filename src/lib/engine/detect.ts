import { readFileSync, readdirSync } from "node:fs";
import { extname, join, posix } from "node:path";

import type { Pattern } from "@/types/pattern";

export type BindingKind =
  | "spec-format"
  | "checker"
  | "gate-location"
  | "naming";

export type BindingDetection =
  | {
      bindingId: string;
      kind: BindingKind;
      status: "detected";
      value: string;
      evidence: { path: string }[];
    }
  | {
      bindingId: string;
      kind: BindingKind;
      status: "user-provided";
      value: string;
    }
  | {
      bindingId: string;
      kind: BindingKind;
      status: "binding-unresolved";
    };

type DetectedValue = {
  value: string;
  evidence: { path: string }[];
};

const configNames = [
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
];
const declarationDirectories = [".changeset", "changes", "changelog"];
const formatNames: Record<string, string> = {
  ".md": "markdown",
  ".rst": "reStructuredText",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function readPackageJson(targetRepoRoot: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(targetRepoRoot, "package.json"), "utf8"),
    );
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasVitest(packageJson: Record<string, unknown> | null): boolean {
  if (packageJson === null) {
    return false;
  }
  const dependencySections = ["dependencies", "devDependencies"];
  const dependencyMatch = dependencySections.some((section) => {
    const dependencies = packageJson[section];
    return (
      typeof dependencies === "object" &&
      dependencies !== null &&
      !Array.isArray(dependencies) &&
      "vitest" in dependencies
    );
  });
  const scripts = packageJson.scripts;
  const testScript =
    typeof scripts === "object" &&
    scripts !== null &&
    !Array.isArray(scripts) &&
    typeof (scripts as Record<string, unknown>).test === "string"
      ? (scripts as Record<string, string>).test
      : "";
  return dependencyMatch || /(^|\s|\/)vitest(?:\s|$)/.test(testScript);
}

function detectGateLocation(
  targetRepoRoot: string,
  runnerDetected: boolean,
): DetectedValue | null {
  if (!runnerDetected) {
    return null;
  }

  let viteConfigs: string[] = [];
  try {
    viteConfigs = readdirSync(targetRepoRoot)
      .filter((name) => /^vite\.config\.[^.]+$/.test(name))
      .sort();
  } catch {
    return null;
  }

  for (const configName of [...configNames, ...viteConfigs]) {
    try {
      const config = readFileSync(join(targetRepoRoot, configName), "utf8");
      if (!/\btest\s*:/.test(config)) {
        continue;
      }
      const include = config.match(
        /\binclude\s*:\s*\[\s*["']([^"']+)["']/,
      )?.[1];
      return {
        value: include ?? "co-located test files",
        evidence: [{ path: configName }],
      };
    } catch {
      // An absent or unreadable candidate is not evidence.
    }
  }

  return {
    value: "co-located test files",
    evidence: [{ path: "package.json" }],
  };
}

function detectDeclarationConvention(
  targetRepoRoot: string,
): { format: DetectedValue; naming: DetectedValue } | null {
  for (const directory of declarationDirectories) {
    try {
      const filename = readdirSync(join(targetRepoRoot, directory), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && extname(entry.name) in formatNames)
        .map(({ name }) => name)
        .sort()[0];
      if (filename === undefined) {
        continue;
      }
      const extension = extname(filename);
      const evidence = [{ path: posix.join(directory, filename) }];
      return {
        format: { value: formatNames[extension], evidence },
        naming: { value: `${directory}/*${extension}`, evidence },
      };
    } catch {
      // A missing or unreadable convention directory is not evidence.
    }
  }
  return null;
}

export function detectBindings(
  pattern: Pattern,
  targetRepoRoot: string,
): BindingDetection[] {
  const packageJson = readPackageJson(targetRepoRoot);
  const runnerDetected = hasVitest(packageJson);
  const gateLocation = detectGateLocation(targetRepoRoot, runnerDetected);
  const declaration = detectDeclarationConvention(targetRepoRoot);

  return pattern.bindingPoints.map(({ id, kind }) => {
    let detected: DetectedValue | null = null;
    if (kind === "checker" && runnerDetected) {
      detected = { value: "vitest", evidence: [{ path: "package.json" }] };
    } else if (kind === "gate-location") {
      detected = gateLocation;
    } else if (kind === "spec-format") {
      detected = declaration?.format ?? null;
    } else if (kind === "naming") {
      detected = declaration?.naming ?? null;
    }

    return detected === null
      ? { bindingId: id, kind, status: "binding-unresolved" }
      : {
          bindingId: id,
          kind,
          status: "detected",
          value: detected.value,
          evidence: detected.evidence,
        };
  });
}

export function mergeUserProvidedBindings(
  detections: BindingDetection[],
  values: Readonly<Record<string, string>>,
): BindingDetection[] {
  return detections.map((detection) => {
    const value = values[detection.bindingId]?.trim();
    return detection.status === "binding-unresolved" && value
      ? {
          bindingId: detection.bindingId,
          kind: detection.kind,
          status: "user-provided",
          value,
        }
      : detection;
  });
}
