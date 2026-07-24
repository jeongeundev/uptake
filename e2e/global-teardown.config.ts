import { rmSync } from "node:fs";

export default function globalTeardown() {
  const fixtureRoot = process.env.UPTAKE_E2E_FIXTURE_ROOT;
  if (
    fixtureRoot !== undefined &&
    process.env.UPTAKE_E2E_FIXTURE_OWNED === "1"
  ) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
