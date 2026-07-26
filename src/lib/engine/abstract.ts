import { isId } from "@/lib/catalog/load";
import type { ExtractResult } from "@/lib/engine/extract";
import { ANCHOR_ROLE_IDS, type Proposer } from "@/services/proposer";
import type {
  AuthoringRequest,
  CorroborationReport,
  Evidence,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";

export type ContrastResult =
  | { ok: true; draft: Pattern; corroboration: CorroborationReport }
  | {
      ok: false;
      reason:
        | "anchor-role-missing"
        | "role-evidence-insufficient"
        | "reference-invalid"
        | "no-roles";
      detail: string;
      corroboration: CorroborationReport;
    };

// Bounds untrusted proposer input while preserving local comparison context.
const EVIDENCE_EXCERPT_LIMIT = 4_000;
const bindingKinds = new Set([
  "spec-format",
  "checker",
  "gate-location",
  "naming",
]);
const anchorDescriptions: Record<(typeof ANCHOR_ROLE_IDS)[number], string> = {
  "spec-artifact": "A repository-native specification artifact.",
  "spec-check": "A check bound to the specification artifact.",
  "blocking-gate": "A gate that blocks when the specification check fails.",
};
const demotedBindingKinds: Record<
  (typeof ANCHOR_ROLE_IDS)[number],
  Pattern["bindingPoints"][number]["kind"]
> = {
  "spec-artifact": "spec-format",
  "spec-check": "checker",
  "blocking-gate": "gate-location",
};

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function makeReport(
  request: AuthoringRequest,
  evidence: Evidence[],
): CorroborationReport {
  const sourceById = new Map(
    request.sources.map((source) => [source.id, source]),
  );
  return {
    independenceGroups: sortedUnique(
      request.sources.map(({ independenceGroup }) => independenceGroup),
    ),
    nonTargetStackSourceIds: request.sources
      .filter(({ isTargetStack }) => !isTargetStack)
      .map(({ id }) => id)
      .sort(),
    perRole: sortedUnique(evidence.map(({ roleId }) => roleId)).map(
      (roleId) => ({
        roleId,
        independenceGroups: sortedUnique(
          evidence
            .filter((item) => item.roleId === roleId)
            .flatMap(({ sourceId }) => {
              const source = sourceById.get(sourceId);
              return source === undefined ? [] : [source.independenceGroup];
            }),
        ),
      }),
    ),
    demoted: [],
  };
}

function failure(
  reason: Exclude<ContrastResult, { ok: true }>["reason"],
  detail: string,
  corroboration: CorroborationReport,
): ContrastResult {
  return { ok: false, reason, detail, corroboration };
}

export async function contrastEvidence(
  request: AuthoringRequest,
  extracted: Extract<ExtractResult, { ok: true }>,
  proposer: Proposer,
): Promise<ContrastResult> {
  const proposal = await proposer.proposeContrast({
    intent: request.intent,
    roleIds:
      request.capability === "generative" ? ANCHOR_ROLE_IDS : [],
    evidence: extracted.evidence
      .map(({ sourceId, path, roleId, content }) => ({
        sourceId,
        path,
        roleId,
        excerpt: content.slice(0, EVIDENCE_EXCERPT_LIMIT),
      }))
      .sort(
        (left, right) =>
          left.sourceId.localeCompare(right.sourceId) ||
          left.path.localeCompare(right.path) ||
          left.roleId.localeCompare(right.roleId),
      ),
  });
  const evidenceRoleIds = new Set(
    extracted.evidence.map(({ roleId }) => roleId),
  );
  const proposedDescriptions = new Map(
    proposal.roles
      .filter(({ id, description }) => isId(id) && description.length > 0)
      .map(({ id, description }) => [id, description]),
  );
  const corroboration = makeReport(request, extracted.evidence);

  let roles: Pattern["roles"];
  if (request.capability === "generative") {
    const missing = ANCHOR_ROLE_IDS.filter(
      (roleId) => !evidenceRoleIds.has(roleId),
    );
    if (missing.length > 0) {
      return failure(
        "anchor-role-missing",
        `Anchor roles without evidence: ${missing.join(", ")}.`,
        corroboration,
      );
    }
    roles = ANCHOR_ROLE_IDS.map((id) => ({
      id,
      description: proposedDescriptions.get(id) ?? anchorDescriptions[id],
    }));
  } else {
    const acceptedRoleIds = new Set<string>();
    roles = proposal.roles
      .filter(
        ({ id, description }) =>
          isId(id) &&
          description.length > 0 &&
          evidenceRoleIds.has(id) &&
          !acceptedRoleIds.has(id),
      )
      .map(({ id, description }) => {
        acceptedRoleIds.add(id);
        return { id, description };
      });
  }
  roles.sort((left, right) => left.id.localeCompare(right.id));

  const groupsByRole = new Map(
    corroboration.perRole.map(({ roleId, independenceGroups }) => [
      roleId,
      independenceGroups,
    ]),
  );
  const demotedRoles =
    request.evidenceStatus === "corroborated"
      ? roles.filter(({ id }) => (groupsByRole.get(id)?.length ?? 0) < 2)
      : [];
  corroboration.demoted = demotedRoles
    .map(({ id }) => ({
      roleId: id,
      reason: "single-independence-group" as const,
    }))
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  const demotedIds = new Set(demotedRoles.map(({ id }) => id));
  roles = roles.filter(({ id }) => !demotedIds.has(id));

  if (
    request.capability === "generative" &&
    ANCHOR_ROLE_IDS.some((roleId) => demotedIds.has(roleId))
  ) {
    return failure(
      "role-evidence-insufficient",
      "A generative anchor role lacks two independence groups.",
      corroboration,
    );
  }
  if (roles.length === 0) {
    return failure(
      "no-roles",
      "No evidenced role candidate remains.",
      corroboration,
    );
  }

  const bindingPoints: Pattern["bindingPoints"] = [];
  const bindingIds = new Set<string>();
  for (const binding of proposal.bindingPoints) {
    if (
      !isId(binding.id) ||
      binding.description.length === 0 ||
      !bindingKinds.has(binding.kind) ||
      bindingIds.has(binding.id)
    ) {
      continue;
    }
    bindingIds.add(binding.id);
    bindingPoints.push(binding);
  }
  for (const role of demotedRoles) {
    if (bindingIds.has(role.id)) continue;
    bindingIds.add(role.id);
    bindingPoints.push({
      id: role.id,
      description: role.description,
      kind:
        role.id in demotedBindingKinds
          ? demotedBindingKinds[
              role.id as keyof typeof demotedBindingKinds
            ]
          : "naming",
    });
  }
  bindingPoints.sort((left, right) => left.id.localeCompare(right.id));

  const retainedRoleIds = new Set(roles.map(({ id }) => id));
  const provenance = extracted.evidence
    .filter(({ roleId }) => retainedRoleIds.has(roleId))
    .map(({ sourceId, path, roleId }) => ({
      sourceId,
      path,
      observedRole: roleId,
    }))
    .sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        left.path.localeCompare(right.path) ||
        left.observedRole.localeCompare(right.observedRole),
    );
  const sources = [...extracted.sources].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const sourceIds = new Set(sources.map(({ id }) => id));
  const referencedSources = new Set(
    provenance.map(({ sourceId }) => sourceId),
  );
  const referencedRoles = new Set(
    provenance.map(({ observedRole }) => observedRole),
  );
  if (
    provenance.some(
      ({ sourceId, observedRole }) =>
        !sourceIds.has(sourceId) || !retainedRoleIds.has(observedRole),
    ) ||
    sources.some(({ id }) => !referencedSources.has(id)) ||
    roles.some(({ id }) => !referencedRoles.has(id))
  ) {
    return failure(
      "reference-invalid",
      "The assembled draft contains an orphan or invalid reference.",
      corroboration,
    );
  }

  const narrative = await proposer.proposeNarrative({
    intent: request.intent,
    capability: request.capability,
    roles,
    bindingPoints,
    sources: sources.map(({ stack, isTargetStack }) => ({
      stack,
      isTargetStack,
    })),
  });
  return {
    ok: true,
    draft: {
      schemaVersion: 1,
      patternId: request.patternId,
      name: request.name,
      capability: request.capability,
      evidenceStatus: request.evidenceStatus,
      intent: request.intent,
      roles,
      bindingPoints,
      sources,
      provenance,
      tradeoffs: narrative.tradeoffs,
    },
    corroboration,
  };
}
