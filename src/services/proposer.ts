import type { BindingKind } from "@/lib/engine/detect";
import type { SurveyCandidate } from "@/types/survey";

export const ANCHOR_ROLE_IDS = [
  "spec-artifact",
  "spec-check",
  "blocking-gate",
] as const;

export type ProposerMetadata = {
  providerId: string;
  modelId: string;
};

export type FileCandidateRequest = {
  intent: string;
  sourceId: string;
  repository: string;
  revision: string;
  files: string[];
  roleIds: readonly string[];
};

export type FileCandidate = {
  sourceId: string;
  path: string;
  roleId: string;
  rationale: string;
};

export type ContrastRequest = {
  intent: string;
  roleIds: readonly string[];
  evidence: {
    sourceId: string;
    path: string;
    roleId: string;
    excerpt: string;
  }[];
};

export type ContrastProposal = {
  roles: { id: string; description: string }[];
  bindingPoints: {
    id: string;
    description: string;
    kind: BindingKind;
  }[];
};

export type NarrativeRequest = {
  intent: string;
  capability: "generative" | "descriptive";
  roles: { id: string; description: string }[];
  bindingPoints: {
    id: string;
    description: string;
    kind: BindingKind;
  }[];
  sources: { stack: string; isTargetStack: boolean }[];
};

export type NarrativeProposal = {
  violation: string;
  tradeoffs: string;
};

export type Proposer = {
  readonly metadata: ProposerMetadata;
  proposeFileCandidates(
    request: FileCandidateRequest,
  ): Promise<FileCandidate[]>;
  proposeContrast(request: ContrastRequest): Promise<ContrastProposal>;
  proposeNarrative(request: NarrativeRequest): Promise<NarrativeProposal>;
};

export type SurveyRequest = {
  repository: string;
  revision: string;
  files: { path: string; ruleId: string; content: string }[];
};

export type SurveyProposer = {
  readonly metadata: ProposerMetadata;
  proposeSurveyCandidates(
    request: SurveyRequest,
  ): Promise<SurveyCandidate[]>;
};

const boundaryPrefix = "<<<UPTAKE_UNTRUSTED:";
const escapedBoundaryPrefix = "<<\u200b<UPTAKE_UNTRUSTED:";

function escapeLabel(label: string): string {
  return label
    .replaceAll(boundaryPrefix, escapedBoundaryPrefix)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

export function untrustedBlock(label: string, content: string): string {
  const safeLabel = escapeLabel(label);
  const safeContent = content.replaceAll(
    boundaryPrefix,
    escapedBoundaryPrefix,
  );

  return [
    `${boundaryPrefix}${safeLabel}:BEGIN>>>`,
    safeContent,
    `${boundaryPrefix}${safeLabel}:END>>>`,
  ].join("\n");
}
