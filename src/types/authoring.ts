export type { Pattern, Provenance, Source } from "@/types/pattern";

export type SourceSpec = {
  id: string;
  repository: string;
  revision?: string; // 이미 고정된 커밋 SHA. 있으면 HEAD를 읽지 않는다 (ADR-021)
  stack: string;
  isTargetStack: boolean;
  independenceGroup: string;
  independenceNote: string;
};

export type AuthoringRequest = {
  patternId: string;
  name: string;
  intent: string;
  capability: "generative" | "descriptive";
  evidenceStatus: "observed" | "corroborated";
  sources: SourceSpec[];
};

export type Evidence = {
  sourceId: string;
  path: string;
  roleId: string;
  content: string;
};

export type DiscardedCandidate = {
  sourceId: string;
  path: string;
  reason:
    | "provenance-unresolved"
    | "path-invalid"
    | "role-not-allowed"
    | "duplicate";
};

export type TargetStackFact = {
  sourceId: string;
  vitestObserved: boolean;
  evidencePaths: string[];
};

export type CorroborationReport = {
  independenceGroups: string[];
  nonTargetStackSourceIds: string[];
  perRole: { roleId: string; independenceGroups: string[] }[];
  demoted: {
    roleId: string;
    reason: "single-independence-group";
  }[];
};
