import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { createAnthropicProposerFromEnv } from "../src/services/proposer-anthropic";

if (!process.env.ANTHROPIC_API_KEY || !process.env.UPTAKE_PROPOSER_MODEL) {
  console.log(
    "Skipping proposer eval: set ANTHROPIC_API_KEY and UPTAKE_PROPOSER_MODEL to run it.",
  );
  process.exit(0);
}

const fixtureRoot = resolve("tests/fixtures/authoring-selfverify-target");
const files = readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(fixtureRoot, resolve(entry.parentPath, entry.name)))
  .sort();
const proposer = createAnthropicProposerFromEnv();
const candidates = await proposer.proposeFileCandidates({
  intent: "Observe how a written specification is connected to a blocking verification gate.",
  sourceId: "authoring-selfverify-target",
  repository: "tests/fixtures/authoring-selfverify-target",
  revision: "working-fixture",
  files,
  roleIds: ["spec-artifact", "spec-check", "blocking-gate"],
});

console.log(`Provider: ${proposer.metadata.providerId}`);
console.log(`Model: ${proposer.metadata.modelId}`);
console.log("Candidate observations:");
console.log(JSON.stringify(candidates, null, 2));
