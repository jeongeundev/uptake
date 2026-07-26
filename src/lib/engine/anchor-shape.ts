import { ANCHOR_ROLE_IDS } from "@/services/proposer";
import type { Pattern } from "@/types/pattern";

export function hasAnchorRoleShape(pattern: Pattern): boolean {
  const roleIds = new Set(pattern.roles.map(({ id }) => id));
  return (
    roleIds.size === ANCHOR_ROLE_IDS.length &&
    ANCHOR_ROLE_IDS.every((roleId) => roleIds.has(roleId))
  );
}
