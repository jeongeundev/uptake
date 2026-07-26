import type {
  ContrastProposal,
  ContrastRequest,
  FileCandidate,
  FileCandidateRequest,
  NarrativeProposal,
  NarrativeRequest,
  Proposer,
  ProposerMetadata,
} from "@/services/proposer";

export type StubProposerScript = {
  metadata?: ProposerMetadata;
  fileCandidates?:
    | FileCandidate[]
    | ((request: FileCandidateRequest) => FileCandidate[]);
  contrast?:
    | ContrastProposal
    | ((request: ContrastRequest) => ContrastProposal);
  narrative?:
    | NarrativeProposal
    | ((request: NarrativeRequest) => NarrativeProposal);
};

type StubCalls = {
  fileCandidates: FileCandidateRequest[];
  contrast: ContrastRequest[];
  narrative: NarrativeRequest[];
};

export function createStubProposer(
  script: StubProposerScript,
): Proposer & { readonly calls: StubCalls } {
  const calls: StubCalls = {
    fileCandidates: [],
    contrast: [],
    narrative: [],
  };

  return {
    metadata: script.metadata ?? {
      providerId: "stub",
      modelId: "deterministic-stub",
    },
    calls,
    async proposeFileCandidates(request) {
      calls.fileCandidates.push(request);
      const response = script.fileCandidates;
      return typeof response === "function"
        ? response(request)
        : (response ?? []);
    },
    async proposeContrast(request) {
      calls.contrast.push(request);
      const response = script.contrast;
      return typeof response === "function"
        ? response(request)
        : (response ?? { roles: [], bindingPoints: [] });
    },
    async proposeNarrative(request) {
      calls.narrative.push(request);
      const response = script.narrative;
      return typeof response === "function"
        ? response(request)
        : (response ?? { violation: "", tradeoffs: "" });
    },
  };
}
