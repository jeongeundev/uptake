import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve("tests/fixtures/authoring-selfverify-target");

export async function materializeSelfVerifyTarget(): Promise<{
  root: string;
  dispose: () => Promise<void>;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "uptake-selfverify-target-"));
  try {
    for (const entry of await readdir(fixtureRoot)) {
      await cp(resolve(fixtureRoot, entry), resolve(root, entry), {
        recursive: true,
      });
    }
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=uptake self-verify",
        "-c",
        "user.email=self-verify@uptake.local",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
