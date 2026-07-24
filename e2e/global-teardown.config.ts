import { rmSync } from "node:fs";

export default function globalTeardown() {
  const fixtureRoot = process.env.UPTAKE_E2E_FIXTURE_ROOT;
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

