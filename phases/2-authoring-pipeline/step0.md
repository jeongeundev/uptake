# Step 0: authoring-contract

phase 2는 EXTRACT·ABSTRACT(카탈로그 저작)를 앱 안으로 들이는 작업이다. 이 step은 그 파이프라인 전체가 쓸 **타입 계약과 LLM proposer 포트**를 정의한다. 저작 로직은 다음 step들이 구현한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 (특히 provenance 강제·서술적 태도·자기검증·불신 격리)
- `/docs/PRD.md` — "Phase 2 범위 — 카탈로그 저작 (EXTRACT·ABSTRACT)" 절
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약 (phase 2)" 절 + "패턴 스키마" 절
- `/docs/ADR.md` — ADR-005, ADR-008, ADR-009, ADR-012, ADR-013, ADR-014, ADR-015, ADR-016
- `/src/types/pattern.ts` — 기존 패턴 스키마 타입 (재사용 대상)
- `/src/lib/engine/detect.ts` — `BindingKind` 타입 (재사용 대상)
- `/src/lib/catalog/load.ts` — 층 1 하드 게이트의 실제 검증 규칙 (초안이 통과해야 하는 기준)

## 작업

### 1. `src/types/authoring.ts` — 저작 도메인 타입

기존 `@/types/pattern`의 `Pattern`·`Source`·`Provenance`를 **재정의하지 말고 import해서 재사용**하라.

```ts
// 사용자가 지정하는 소스 저장소 사양.
// independenceGroup·independenceNote·isTargetStack·stack 은 전부 사용자 판정값이다.
export type SourceSpec = {
  id: string;                  // catalog Source.id 가 된다
  repository: string;          // UPTAKE_SOURCE_ROOT 아래 상대 경로 식별자
  stack: string;               // 표시용 라벨 (사용자 입력)
  isTargetStack: boolean;      // 사용자 판정
  independenceGroup: string;   // 사용자 판정
  independenceNote: string;    // 사용자 판정 근거
};

// 저작 요청 = 대상 지정 추출의 입력
export type AuthoringRequest = {
  patternId: string;                              // 사용자가 부여 (kebab-case)
  name: string;
  intent: string;                                 // 추출할 방법론의 의도
  capability: "generative" | "descriptive";
  evidenceStatus: "observed" | "corroborated";
  sources: SourceSpec[];
};

// EXTRACT 단계가 확정한 근거 한 건
export type Evidence = {
  sourceId: string;
  path: string;                // repo-상대 posix 경로
  roleId: string;
  content: string;             // resolve된 파일 내용 (proposer 입력용; 카탈로그에는 담기지 않는다)
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

// 앱이 제시하는 결정적 사실 (판정이 아니다)
export type TargetStackFact = {
  sourceId: string;
  vitestObserved: boolean;
  evidencePaths: string[];
};

// corroboration 계산 결과 — 사용자가 입력한 independenceGroup 값만 세서 만든다
export type CorroborationReport = {
  independenceGroups: string[];        // distinct, 정렬됨
  nonTargetStackSourceIds: string[];
  perRole: { roleId: string; independenceGroups: string[] }[];
  demoted: { roleId: string; reason: "single-independence-group" }[];
};
```

### 2. `src/services/proposer.ts` — proposer 포트

LLM은 **후보만** 낸다(ADR-015). 이 파일은 인터페이스와 순수 헬퍼만 담는다. 네트워크 호출·SDK import를 넣지 마라 — 실제 어댑터는 step 7이다.

```ts
export const ANCHOR_ROLE_IDS = [
  "spec-artifact",
  "spec-check",
  "blocking-gate",
] as const;

export type ProposerMetadata = {
  providerId: string;   // 예: "anthropic" | "stub"
  modelId: string;      // 설정값으로 고정된 모델 식별자
};

export type FileCandidateRequest = {
  intent: string;
  sourceId: string;
  repository: string;
  revision: string;
  files: string[];                 // 불신 데이터: 저장소의 파일 경로 목록
  roleIds: readonly string[];      // 후보가 라벨링할 수 있는 역할 id
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
    excerpt: string;               // 불신 데이터: 근거 파일 발췌
  }[];
};

export type ContrastProposal = {
  roles: { id: string; description: string }[];
  bindingPoints: { id: string; description: string; kind: BindingKind }[];
};

export type NarrativeRequest = {
  intent: string;
  capability: "generative" | "descriptive";
  roles: { id: string; description: string }[];
  bindingPoints: { id: string; description: string; kind: BindingKind }[];
  sources: { stack: string; isTargetStack: boolean }[];
};

export type NarrativeProposal = {
  violation: string;   // generative일 때만 사용된다
  tradeoffs: string;
};

export type Proposer = {
  readonly metadata: ProposerMetadata;
  proposeFileCandidates(request: FileCandidateRequest): Promise<FileCandidate[]>;
  proposeContrast(request: ContrastRequest): Promise<ContrastProposal>;
  proposeNarrative(request: NarrativeRequest): Promise<NarrativeProposal>;
};
```

`BindingKind`는 `@/lib/engine/detect`에서 import하라. 새로 정의하지 마라.

### 3. 불신 데이터 경계 블록 헬퍼 (같은 파일 또는 `src/services/untrusted.ts`)

저장소에서 읽은 내용은 지시가 아니라 **데이터**로 LLM에 전달된다(AGENTS.md CRITICAL·ARCHITECTURE 신뢰 경계).

```ts
export function untrustedBlock(label: string, content: string): string;
```

계약:

- 반환 문자열은 `content`를 명확한 시작·종료 구분자로 감싼다.
- **content 안에 구분자와 같은 문자열이 있어도 블록을 탈출할 수 없어야 한다.** content에 나타나는 구분자 문자열은 무해한 형태로 치환한 뒤 감싼다.
- 같은 입력에 같은 출력을 낸다(결정적). 난수·타임스탬프를 쓰지 마라 — 테스트가 불가능해지고 프롬프트 캐시도 깨진다.
- `label`은 호출자가 주는 식별자다. 그대로 구분자에 넣되, label 자체가 구분자를 깨뜨리지 않도록 다룬다.

### 4. `src/services/proposer-stub.ts` — 결정적 스텁 proposer

ADR-015는 "수용 기준 테스트는 이 포트를 스텁으로 주입해 임의·적대적 후보에도 게이트가 옳게 걸러내는지 검증한다"를 요구한다. 이후 모든 step의 AC 테스트와 step 9의 E2E가 이 스텁을 쓴다.

```ts
export type StubProposerScript = {
  metadata?: ProposerMetadata;
  fileCandidates?: FileCandidate[] | ((r: FileCandidateRequest) => FileCandidate[]);
  contrast?: ContrastProposal | ((r: ContrastRequest) => ContrastProposal);
  narrative?: NarrativeProposal | ((r: NarrativeRequest) => NarrativeProposal);
};

export function createStubProposer(script: StubProposerScript): Proposer;
```

- 스크립트에 없는 응답은 빈 후보(`[]`) 또는 빈 제안으로 처리한다.
- 호출 인자를 기록해 테스트에서 검사할 수 있게 하라(예: 반환 객체에 `calls` 노출). 단, `Proposer` 타입 자체는 오염시키지 마라.
- **적대적 후보를 표현할 수 있어야 한다** — 존재하지 않는 경로, 단일 저장소만 지지하는 role, 앵커 밖 role id.

### 5. 테스트

- `untrustedBlock`: 평범한 내용 감싸기 / content가 구분자 문자열을 포함할 때 탈출 불가 / 결정성.
- `createStubProposer`: 스크립트대로 응답, 미지정 응답의 기본값.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/types/`, `src/services/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`@anthropic-ai/sdk`를 설치하거나 import하지 마라. 이유: 실제 LLM 어댑터는 step 7의 범위이고, 이 step의 포트는 SDK를 몰라야 한다.**
- **`Pattern`·`Source`·`Provenance`·`BindingKind`를 다시 정의하지 마라. 이유: 스키마가 두 곳으로 갈라지면 층 1 하드 게이트와 저작 초안이 어긋난다.**
- **`untrustedBlock`에 난수나 현재 시각을 넣지 마라. 이유: 결정성이 깨지면 테스트가 불가능하고 프롬프트 캐시 프리픽스도 매번 무효화된다.**
- **저작 로직(파일 읽기, git 호출, 대조, 카탈로그 쓰기)을 여기서 구현하지 마라. 이유: 이 step은 계약만 정의한다. 구현은 step 2~5다.**
- **`independenceGroup`이나 `isTargetStack`을 앱이 추론하는 코드를 넣지 마라. 이유: 판정 주체는 사용자다(ADR-005/015). 타입상으로도 이 값들은 `SourceSpec`의 사용자 입력 필드다.**
- 기존 테스트를 깨뜨리지 마라.
