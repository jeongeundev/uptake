export type Source = {
  id: string;
  repository: string;
  revision: string; // 고정 커밋 SHA — 브랜치·태그 금지
  stack: string;
  isTargetStack: boolean;
  independenceGroup: string;
  independenceNote: string;
};

export type Provenance = {
  sourceId: string;
  path: string;
  observedRole: string;
};

export type InjectionTemplate = {
  operation: "replace";
  targetRole: string;
  marker: string;
  replacement: string;
};

export type InstantiatedInjection = {
  operation: "replace";
  path: string;
  marker: string;
  replacement: string;
};

export type Pattern = {
  schemaVersion: 1;
  patternId: string;
  name: string;
  capability: "generative" | "descriptive";
  evidenceStatus: "observed" | "corroborated";
  intent: string;
  roles: { id: string; description: string }[];
  bindingPoints: {
    id: string;
    description: string;
    kind: "spec-format" | "checker" | "gate-location" | "naming";
  }[];
  sources: Source[];
  provenance: Provenance[];
  oracle?: {
    // capability = generative 일 때 필수
    violation: string;
    gateTestId: string;
    injection: InjectionTemplate;
    expect: "red";
  };
  tradeoffs: string;
};
