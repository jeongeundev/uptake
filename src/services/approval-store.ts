import { randomUUID } from "node:crypto";

export type StoredApproval = {
  patternId: string;
  targetRepoRoot: string;
  contentHash: string;
  targetBaseHash: string;
  frozenArgv: string[];
  status: "pending" | "approved" | "consumed";
};

const approvals = new Map<string, StoredApproval>();

export function createApproval(
  input: Omit<StoredApproval, "status">,
): string {
  const verificationId = randomUUID();
  approvals.set(verificationId, {
    ...input,
    frozenArgv: [...input.frozenArgv],
    status: "pending",
  });
  return verificationId;
}

export function approveVerification(
  verificationId: string,
):
  | { ok: true }
  | { ok: false; reason: "unknown-approval" | "invalid-state" } {
  const approval = approvals.get(verificationId);
  if (approval === undefined) {
    return { ok: false, reason: "unknown-approval" };
  }
  if (approval.status !== "pending") {
    return { ok: false, reason: "invalid-state" };
  }
  approval.status = "approved";
  return { ok: true };
}

export function consumeApproved(
  verificationId: string,
):
  | { ok: true; approval: StoredApproval }
  | {
      ok: false;
      reason: "unknown-approval" | "not-approved" | "already-consumed";
    } {
  const approval = approvals.get(verificationId);
  if (approval === undefined) {
    return { ok: false, reason: "unknown-approval" };
  }
  if (approval.status === "pending") {
    return { ok: false, reason: "not-approved" };
  }
  if (approval.status === "consumed") {
    return { ok: false, reason: "already-consumed" };
  }
  approval.status = "consumed";
  return {
    ok: true,
    approval: { ...approval, frozenArgv: [...approval.frozenArgv] },
  };
}

export function __resetApprovalStoreForTests(): void {
  approvals.clear();
}
