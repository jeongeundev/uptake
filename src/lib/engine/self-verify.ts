import { detectBindings } from "@/lib/engine/detect";
import { instantiate } from "@/lib/engine/instantiate";
import { materializeSelfVerifyTarget } from "@/lib/engine/selfverify-target";
import {
  executeVerification,
  prepareVerification,
  type VerifyOutcome,
} from "@/lib/engine/verify";
import type { Pattern } from "@/types/pattern";

type VerifyFailure = Exclude<
  VerifyOutcome,
  { status: "awaiting-approval" }
>;

export type SelfVerifyResult =
  | {
      ok: true;
      frozenArgv: string[];
      positiveLog: string;
      negativeLog: string;
    }
  | { ok: false; status: VerifyFailure["status"]; detail: string };

export async function selfVerifyOracle(
  pattern: Pattern,
): Promise<SelfVerifyResult> {
  const target = await materializeSelfVerifyTarget();
  try {
    const bindings = detectBindings(pattern, target.root);
    const generated = instantiate(pattern, bindings);
    if (!generated.ok) {
      return {
        ok: false,
        status: "positive-failed",
        detail: generated.detail,
      };
    }
    const prepared = prepareVerification(
      pattern,
      generated,
      bindings,
      target.root,
    );
    if (prepared.status !== "prepared") {
      return { ok: false, status: prepared.status, detail: prepared.detail };
    }

    const outcome = await executeVerification(prepared);
    if (outcome.status !== "awaiting-approval") {
      return { ok: false, status: outcome.status, detail: outcome.detail };
    }
    return {
      ok: true,
      frozenArgv: outcome.frozenArgv,
      positiveLog: outcome.positiveLog,
      negativeLog: outcome.negativeLog,
    };
  } finally {
    await target.dispose();
  }
}
