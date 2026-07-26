# Step 6: authoring-api

저작 파이프라인(EXTRACT → ABSTRACT → oracle 자기검증 → 승인 → 등재)을 하나의 서버측 저장소로 묶고 Route Handler로 노출한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/PRD.md` — "Phase 2 범위"의 요구사항 목록 전체
- `/docs/ARCHITECTURE.md` — "제품 표면", "상태 관리"(세션 소유권·승인은 클라이언트 상태가 아니다), "EXTRACT·ABSTRACT 저작 계약"의 **초안 수명 · 승인 · 등재**
- `/docs/ADR.md` — ADR-015, ADR-016
- `/src/services/workflow-store.ts` — 세션 소유권 결속과 단계별 상태 관리의 선례. 특히 `createSession`·`workflowFor`·`getCatalog`
- `/src/app/api/http.ts` — `sessionIdFor`·`withSession`·`readJson`·`statusCode` 헬퍼 (재사용 대상)
- `/src/app/api/workflows/route.ts`, `/src/app/api/workflows/[workflowId]/approve/route.ts` — 기존 Route Handler 형태
- `/src/services/approval-store.ts`, `/src/services/draft-store.ts` — 승인 저장소
- 이전 step 산출물: `/src/lib/engine/extract.ts`, `/src/lib/engine/abstract.ts`, `/src/lib/engine/oracle-draft.ts`, `/src/lib/engine/self-verify.ts`, `/src/lib/catalog/write.ts`, `/src/services/proposer.ts`, `/src/services/proposer-stub.ts`, `/src/types/authoring.ts`

## 작업

### 1. `src/services/authoring-store.ts` — 저작 세션

`workflow-store.ts`의 구조를 따르되 저작용으로 별도 파일을 만든다(이식 workflow와 뒤섞지 마라).

```ts
export type AuthoringError = {
  status:
    | "invalid-request"
    | "draft-not-found"
    | "source-unresolved"
    | "no-evidence"
    | "contrast-failed"
    | "oracle-not-anchor"
    | "self-verify-failed"
    | "not-approved"
    | "register-rejected";
  detail: string;
};

export type AuthoringDrafted = {
  status: "drafted";
  draftId: string;
  pattern: Pattern;
  corroboration: CorroborationReport;
  targetStackFacts: TargetStackFact[];
  discarded: DiscardedCandidate[];
  selfVerify:
    | { status: "passed"; frozenArgv: string[] }
    | { status: "skipped"; reason: "descriptive" }
    | { status: "failed"; detail: string };
  proposer: ProposerMetadata;          // 모델 ID를 포함한 저작 세션 메타데이터
};

export async function createAuthoringDraft(
  sessionId: string,
  request: AuthoringRequest,
  proposer: Proposer,
): Promise<AuthoringDrafted | AuthoringError>;

export function approveAuthoringDraft(sessionId: string, draftId: string): { status: "approved" } | AuthoringError;

export function registerAuthoringDraft(sessionId: string, draftId: string): { status: "registered"; path: string } | AuthoringError;

export function __resetAuthoringStoreForTests(): void;
```

동작 계약:

**a. `createAuthoringDraft`**
1. 요청 검증 — `patternId`·role id 문자 제약은 `load.ts`와 같은 기준을 쓴다. `corroborated` 요청인데 소스가 2개 미만이면 `invalid-request`.
2. `extractEvidence` → 실패면 그 사유를 그대로 올린다.
3. `contrastEvidence` → 실패면 `contrast-failed`(detail에 원래 사유와 `corroboration`을 사람이 읽을 수 있게 담아라).
4. `capability === "generative"`이면 `draftAnchorOracle` → `selfVerifyOracle`. 자기검증에 실패하면 **초안을 저장하지 않고** `self-verify-failed`를 반환한다. `descriptive`이면 두 단계를 건너뛰고 `selfVerify.status = "skipped"`.
5. 성공한 초안만 `createDraft`로 저장하고 `draftId`를 발급한다. **이 시점까지 카탈로그에는 아무것도 쓰이지 않는다.**
6. 응답에 `proposer.metadata`를 그대로 담는다 — 어느 provider·어느 모델 ID가 이 초안을 제안했는지가 저작 세션의 기록이다.

**b. `approveAuthoringDraft`** — `draft-store`의 상태 전이만 수행한다. 여기서 카탈로그를 쓰지 마라.

**c. `registerAuthoringDraft`** — `consumeApprovedDraft`로 한 번 소비한 뒤 `registerPattern`을 호출한다. 등재 거부는 `register-rejected`로 사유를 그대로 전달한다. 카탈로그 경로는 `workflow-store.ts`의 `getCatalog`와 **같은 환경변수 규칙**(`UPTAKE_CATALOG_DIR` / `UPTAKE_SOURCE_ROOT`)을 쓴다.

proposer는 인자로 주입받는다 — 저장소가 어댑터를 직접 만들지 마라. 기본 proposer 선택은 Route Handler 계층에서 한다.

### 2. Route Handlers

- `POST /api/authoring/drafts` — body: `AuthoringRequest` → `AuthoringDrafted`
- `POST /api/authoring/drafts/[draftId]/approve`
- `POST /api/authoring/drafts/[draftId]/register`

규칙:

- 세션은 `sessionIdFor`/`withSession`으로 다룬다. 초안은 발급한 세션에서만 승인·등재할 수 있다.
- 클라이언트가 보낸 `approved: true` 같은 필드를 신뢰하지 마라. 승인은 서버 저장소의 상태 전이로만 성립한다.
- `readJson`으로 body를 읽고, 알 수 없는 필드나 타입 불일치는 `invalid-request`로 거부하라.
- `http.ts`의 `statusCode`에 새 상태들의 매핑을 추가하라(`draft-not-found` → 404, `invalid-request`·`not-approved`류 → 400 등). 기존 매핑은 바꾸지 마라.
- proposer 선택: 환경변수로 어댑터가 설정돼 있으면 그것을, 없으면 **명시적 오류**를 반환한다. 조용히 스텁으로 대체하지 마라 — 실제 저작이 안 되는데 되는 것처럼 보이면 성공 위장이다. (실제 어댑터는 step 7이므로, 이 step에서는 "어댑터 미설정" 오류 경로와 테스트용 주입 경로만 있으면 된다.)

### 3. 테스트

- `src/services/authoring-store.test.ts`: 스텁 proposer 주입으로 전 단계 검사.
  - 자기검증 실패 시 draftId가 발급되지 않고 카탈로그에 아무것도 쓰이지 않는다.
  - 승인 없이 register하면 `not-approved`.
  - 같은 draftId로 두 번 register하면 두 번째는 거부된다.
  - 다른 세션의 draftId로 승인·등재하면 `draft-not-found`.
  - `descriptive` 요청은 자기검증을 건너뛰고 초안이 만들어진다.
- `src/app/api/` 라우트 테스트: 기존 `src/__tests__/route.test.ts`·`src/app/api/http.test.ts` 형태를 따라 세션 쿠키 결속과 상태 코드를 검사한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app/api/`, `src/services/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **클라이언트가 보낸 승인 플래그를 믿지 마라. 이유: UI를 우회한 직접 호출로 등재되는 경로가 생긴다(ARCHITECTURE 상태 관리·AC-10과 대칭).**
- **자기검증 실패한 초안을 저장하거나 승인 가능하게 만들지 마라. 이유: 판별력 없는 oracle이 승인 UI까지 도달하면 사람이 실수로 통과시킨다(ADR-016).**
- **proposer 어댑터가 없을 때 스텁으로 조용히 대체하지 마라. 이유: 저작이 실제로 동작하지 않는데 동작하는 것처럼 보이는 성공 위장이다. 명시적 오류를 반환하라.**
- **`workflow-store.ts`의 기존 이식 workflow 계약을 바꾸지 마라. 이유: phase 1의 확정된 UI/API 계약이며 E2E가 의존한다.**
- **저작 세션 상태를 디스크에 영속화하지 마라. 이유: 서버 프로세스 수명 in-memory가 계약이다(ARCHITECTURE 상태 관리).**
- **한 Route Handler에서 초안 생성과 등재를 함께 처리하지 마라. 이유: 사용자 승인 이벤트가 두 단계 사이에 반드시 들어가야 한다.**
- 기존 테스트를 깨뜨리지 마라.
