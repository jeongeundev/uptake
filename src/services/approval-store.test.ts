import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetApprovalStoreForTests,
  approveVerification,
  consumeApproved,
  createApproval,
} from "@/services/approval-store";

const input = {
  patternId: "pattern",
  targetRepoRoot: "/target",
  contentHash: "content",
  targetBaseHash: "base",
  frozenArgv: ["vitest", "run"],
};

beforeEach(__resetApprovalStoreForTests);

describe("approval store", () => {
  it("requires explicit approval before one successful consumption", () => {
    const verificationId = createApproval(input);

    expect(consumeApproved(verificationId)).toEqual({
      ok: false,
      reason: "not-approved",
    });
    expect(approveVerification(verificationId)).toEqual({ ok: true });
    expect(consumeApproved(verificationId)).toMatchObject({
      ok: true,
      approval: { ...input, status: "consumed" },
    });
    expect(consumeApproved(verificationId)).toEqual({
      ok: false,
      reason: "already-consumed",
    });
  });

  it("rejects unknown ids and approval outside the pending state", () => {
    expect(approveVerification("unknown")).toEqual({
      ok: false,
      reason: "unknown-approval",
    });
    expect(consumeApproved("unknown")).toEqual({
      ok: false,
      reason: "unknown-approval",
    });

    const verificationId = createApproval(input);
    expect(approveVerification(verificationId)).toEqual({ ok: true });
    expect(approveVerification(verificationId)).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });
});
