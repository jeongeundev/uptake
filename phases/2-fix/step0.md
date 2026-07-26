# Step 0: bind-draft-to-input

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 특히 **"상태 관리"** 절과 **"EXTRACT·ABSTRACT 저작 계약"** 절
- `/docs/ADR.md`
- `/AGENTS.md` — CRITICAL 규칙
- `src/services/draft-store.ts` — 이번 step의 주 대상
- `src/services/draft-store.test.ts`
- `src/services/authoring-store.ts` — `draft-store`의 유일한 호출자
- `src/__tests__/authoring-route.test.ts`
- `src/app/api/authoring/drafts/route.ts`
- `src/app/api/authoring/drafts/[draftId]/approve/route.ts`
- `src/app/api/authoring/drafts/[draftId]/register/route.ts`
- `src/app/api/authoring/drafts/[draftId]/reject/route.ts`
- `src/app/api/http.ts` — `statusCode` 매핑
- `src/types/authoring.ts` — `AuthoringRequest` 타입
- `src/lib/engine/verify.ts` — `hashGenerated`(파일 끝부분). 이 저장소의 **해시 작성 관례**다
- `src/services/workflow-store.ts` — 같은 문제를 이미 푼 대칭 사례(승인 레코드를 입력에 결속)

코드를 꼼꼼히 읽고 설계 의도를 이해한 뒤 작업하라.

## 배경

독립 리뷰가 **major / contract_violation**으로 판정하고 3번의 수정 시도가 실패한 결함을 닫는다.

**문제**: `src/services/authoring-store.ts`의 `createAuthoringDraft`는 `AuthoringRequest`를 받아
초안을 만든 뒤, `createDraft({ sessionId, pattern, proposerMetadata })`로 저장한다 —
**요청(입력) 자체는 버려진다.** 그래서 서버는 어떤 draft가 어떤 입력에서 나왔는지 알지 못한다.
사용자가 화면에서 입력이나 소스 목록을 바꿔도 서버의 옛 `draftId`는 `pending`으로 남고,
그 ID로 approve·register를 호출하면 **사용자가 이미 버린 입력의 pattern이 카탈로그에 기록된다.**

`docs/ARCHITECTURE.md` "상태 관리" 절의 계약 위반이다:

> 사용자가 이전 입력을 바꾸면 downstream 생성·검증·승인 상태를 폐기한다.

**이미 실패한 접근 — 반복하지 마라**: 입력이 바뀔 때 클라이언트가 서버에 reject를 알리는 방식.
알림이 유실·실패하면 창이 다시 열린다. **클라이언트의 통지에 의존해서는 계약을 지킬 수 없다.**

**이번 접근**: draft를 **그것을 만든 입력의 해시에 결속**하고, approve·register가
요청에 담긴 입력의 해시와 대조해 불일치를 서버에서 거절한다. 클라이언트가 아무것도 알려주지 않아도
불변식이 성립한다. 워크플로우 쪽이 이미 같은 방식이다 — 승인 레코드가 산출물 해시·타깃 base 해시·
동결 argv에 결속된다(`docs/ARCHITECTURE.md` "상태 관리").

## 작업

### 1. `src/services/draft-store.ts` — 입력 결속

```ts
export function hashAuthoringRequest(request: AuthoringRequest): string;

export type StoredDraft = {
  sessionId: string;
  requestFingerprint: string;
  pattern: Pattern;
  proposerMetadata: ProposerMetadata;
  status: "pending" | "approved" | "consumed" | "rejected";
};

export function approveDraft(
  draftId: string,
  sessionId: string,
  requestFingerprint: string,
):
  | { ok: true }
  | { ok: false; reason: "unknown-draft" | "stale-input" | "invalid-state" };

export function consumeApprovedDraft(
  draftId: string,
  sessionId: string,
  requestFingerprint: string,
):
  | { ok: true; draft: StoredDraft }
  | {
      ok: false;
      reason: "unknown-draft" | "stale-input" | "not-approved" | "already-consumed";
    };
```

핵심 규칙:

- **해시는 결정적이다.** 필드 순서를 고정하고, `sources` 배열은 **입력 순서를 그대로 유지**한다
  (순서 변경도 입력 변경이다 — 정렬하지 마라). 필드 경계 모호성을 없애기 위해
  `hashGenerated`(`src/lib/engine/verify.ts`)의 **길이-접두 구분자 관례**를 따른다.
- **검사 순서는 세션 소유권 → fingerprint → 상태다.** 다른 세션의 draft는 지금처럼
  `unknown-draft`로 응답해 존재를 노출하지 않는다.
- `createDraft`는 `requestFingerprint`를 포함해 받는다. 같은 세션의 이전 `pending`/`approved`
  draft를 `rejected`로 만드는 기존 동작은 **유지**한다.
- **`rejectDraft`는 fingerprint를 요구하지 않는다.** 거부는 항상 안전한 방향이고, 입력이 바뀐 뒤에도
  옛 draft를 거부할 수 있어야 한다. 시그니처를 바꾸지 마라.

### 2. `src/services/authoring-store.ts` — 배선

- `createAuthoringDraft`는 `hashAuthoringRequest(request)`를 계산해 `createDraft`에 전달한다.
- `approveAuthoringDraft(sessionId, draftId, request)` / `registerAuthoringDraft(sessionId, draftId, request)`로
  시그니처를 확장한다. 두 함수는 **받은 `request`를 `isAuthoringRequest`로 검증**한 뒤
  **서버에서 직접** `hashAuthoringRequest`로 해시해 store에 넘긴다.
- `AuthoringError.status`에 `"stale-input"`을 추가하고, store의 `stale-input`을 그 상태로 사상한다.
  detail은 초안이 만들어진 입력과 승인 대상 입력이 다르다는 사실을 밝힌다.
- `rejectAuthoringDraft`는 변경하지 않는다.

### 3. Route Handler — 요청 계약

- `POST /api/authoring/drafts/[draftId]/approve`와 `.../register`는 body에서
  `{ request: AuthoringRequest }`를 읽는다(`readJson` 사용). body가 없거나 키 구성이 다르거나
  `isAuthoringRequest`가 거짓이면 `invalid-request`로 400을 반환한다.
- `.../reject`는 변경하지 않는다.
- `src/app/api/http.ts`의 `statusCode`에 `"stale-input"`을 **400** 그룹에 추가한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
python3 -m pytest scripts/ -q
```

아래 테스트를 **반드시 추가**한다. 1번이 이 step의 존재 이유다:

1. **새 draft POST 없이** 입력을 바꾼 직후, 옛 `draftId` + 현재 입력으로 approve → `stale-input` 400.
   (Route Handler 수준에서 증명한다 — `src/__tests__/authoring-route.test.ts`)
2. 같은 시나리오에서 register → 거절. 카탈로그 파일이 늘지 않는다.
3. 옛 입력으로 approve → **통과**한다. 명시적으로 그 입력을 승인한 경우는 계약 위반이 아니다.
4. 다른 세션의 draft는 영향받지 않는다(`unknown-draft`).
5. `sources` 배열의 **순서만** 바뀐 경우도 `stale-input`이다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `ARCHITECTURE.md` 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - `AGENTS.md` CRITICAL 규칙을 위반하지 않았는가? 특히 **성공 위장 금지** — 테스트가 실제로
     거절 경로를 통과하는지 확인하라. green만 보고 넘어가지 마라.
3. 결과에 따라 `phases/2-fix/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **클라이언트가 계산한 fingerprint를 받아 그대로 대조하지 마라.** 이유: 클라이언트가 보낸 값을
  신뢰하는 것이 F-001의 원인이다. 서버가 `AuthoringRequest` 원본에서 직접 계산해야 한다.
- **`src/components/authoring-wizard.tsx`를 건드리지 마라.** 이유: UI 배선은 step 1 범위다.
  이 step에서 손대면 두 step이 같은 파일을 고쳐 충돌한다.
- **`rejectDraft`에 fingerprint 요구를 추가하지 마라.** 이유: 입력이 바뀐 뒤에도 옛 draft를
  거부할 수 있어야 한다.
- **새 HTTP 상태 코드(409 등)를 도입하지 마라.** 이유: 기존 `statusCode` 관례가 404/400만 쓰고,
  상태 문자열로 이미 구분된다.
- **만료·TTL·GC 같은 요청하지 않은 기능을 `draft-store`에 넣지 마라.** 이유: over-engineering 금지
  (`AGENTS.md`). 결속만으로 F-001이 닫힌다.
- 기존 테스트를 깨뜨리지 마라. 시그니처 변경으로 기존 테스트가 컴파일되지 않으면 **호출부만 갱신**하고
  단언 내용은 유지하라.
