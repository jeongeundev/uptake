# Step 1: authoring-ui-input-binding

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 특히 **"상태 관리"** 절
- `/docs/UI_GUIDE.md`
- `/AGENTS.md` — CRITICAL 규칙
- `src/components/authoring-wizard.tsx` — 이번 step의 주 대상
- `src/components/authoring-wizard.test.tsx`
- `phases/2-fix/step0.md` — 이번 phase step 0의 지시(서버측 계약)
- **step 0에서 변경된 파일들**(먼저 `git diff`로 확인하라):
  - `src/services/draft-store.ts` — `hashAuthoringRequest`, `requestFingerprint`, `stale-input`
  - `src/services/authoring-store.ts` — `approveAuthoringDraft` / `registerAuthoringDraft`의 새 시그니처
  - `src/app/api/authoring/drafts/[draftId]/approve/route.ts`
  - `src/app/api/authoring/drafts/[draftId]/register/route.ts`
  - `src/app/api/http.ts`
  - `src/__tests__/authoring-route.test.ts`
- `e2e/authoring-pipeline.spec.ts`
- `e2e/authoring-unresolved.spec.ts`
- `e2e/fixtures.config.ts`
- `playwright.config.ts`, `playwright.unresolved.config.ts`

step 0이 만든 서버 계약을 꼼꼼히 읽고, 그 계약에 UI를 맞추는 것이 이 step의 일이다.

## 배경

step 0이 저작 초안을 **그것을 만든 입력의 해시에 결속**했다. `approve`·`register` Route Handler는
이제 body에 `{ request: AuthoringRequest }`를 요구하고, 서버가 그 입력을 해시해 초안에 저장된
`requestFingerprint`와 대조한다. 불일치하면 `stale-input`으로 거절한다.

이 step은 UI를 그 계약에 배선한다. 배선하지 않으면 approve·register가 `invalid-request`로
전부 실패한다(현재 두 호출은 빈 body `{}`를 보낸다 — `src/components/authoring-wizard.tsx`의
`approve()`와 `register()`).

동시에 F-001의 원인 코드를 제거한다. `invalidateReview()`는 입력이 바뀔 때 서버에 reject를
알리는데(`void postJson(...).catch(() => undefined)`), **응답을 기다리지 않고 실패를 삼킨다.**
독립 리뷰가 지적한 지점이며, step 0의 서버측 불변식이 이 통지를 불필요하게 만든다.

## 작업

### 1. 현재 입력을 요청 payload로 만드는 단일 지점

`submit()`이 `/api/authoring/drafts`에 보내는 `AuthoringRequest` 구성이 지금 함수 안에 인라인으로
있다(`patternId`·`name`·`intent`·`capability`·`evidenceStatus`·`sources` 매핑). 이것을
컴포넌트 안의 함수 하나로 추출해 `submit()`·`approve()`·`register()`가 **같은 구성**을 쓰게 한다.

```ts
function currentAuthoringRequest(): AuthoringRequest;
```

`sources` 매핑 규칙(`id: source-{index+1}`, `isTargetStack`의 문자열→boolean 변환 등)은
지금 동작을 **그대로** 유지한다. 초안 생성과 승인이 서로 다른 payload를 만들면 정상 흐름이
`stale-input`으로 막히므로, 구성이 한 곳에서만 정의되는 것이 이 step의 핵심이다.

### 2. approve·register 요청에 현재 입력 동봉

```ts
await postJson(`/api/authoring/drafts/${draft.draftId}/approve`, {
  request: currentAuthoringRequest(),
});
```

`register()`도 동일하게 보낸다. `reject()`는 **변경하지 않는다**(서버가 body를 요구하지 않는다).

### 3. `invalidateReview()`의 fire-and-forget reject 호출 제거

```ts
// 제거 대상
if (draft) {
  void postJson(`/api/authoring/drafts/${draft.draftId}/reject`, {}).catch(() => undefined);
}
```

클라이언트 상태 폐기(`setDraft(null)`·`setApproved(false)`·`setRegistration(null)`)는 **유지**한다.
사용자가 명시적으로 누르는 **"초안 거부" 버튼의 `reject()` 경로는 손대지 마라** — 그것은 응답을
기다리고 실패를 표면화하는 정상 경로다.

### 4. `stale-input` 표면화

approve·register 응답이 `stale-input`이면 사용자에게 **입력이 바뀌어 이전 초안이 무효가 되었고
새 초안을 생성해야 한다**는 사실을 화면에 표시한다. 기존 오류 표시 경로(`setError`)를 재사용하고,
새 UI 컴포넌트나 배너를 만들지 마라. `register()`는 현재 응답을 그대로 `setRegistration`에 넣으므로,
오류 상태일 때 등재 성공처럼 보이지 않게 처리하라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npm run test:e2e
python3 -m pytest scripts/ -q
```

아래 테스트를 **반드시 추가**한다:

1. **컴포넌트**(`src/components/authoring-wizard.test.tsx`): 초안 생성 → 입력 필드 변경 →
   화면에서 검토 컨트롤이 사라진다. 그리고 입력 변경 시 `/reject`로 가는 fetch 호출이
   **발생하지 않는다**(fire-and-forget 제거 증명).
2. **컴포넌트**: 초안 생성 → approve 호출 시 요청 body에 현재 입력이 담겨 있다.
3. **컴포넌트**: 서버가 `stale-input`을 반환하면 그 사실이 화면에 표시되고, 등재 성공으로
   표시되지 않는다.
4. **브라우저 E2E**: 정상 저작 흐름(초안 생성 → 승인 → 등재)이 여전히 통과한다. 기존
   `e2e/authoring-pipeline.spec.ts`가 새 body 계약에서도 green이어야 한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:e2e`는 두 config를 모두 돌린다.
2. 아키텍처 체크리스트를 확인한다:
   - `ARCHITECTURE.md` "서버측 엔진 우선" 원칙 — 클라이언트는 인터랙션만 담당하는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - `AGENTS.md` CRITICAL 규칙을 위반하지 않았는가? 특히 **성공 위장 금지** — E2E가 실제로
     승인·등재를 관통하는지 확인하라.
3. 결과에 따라 `phases/2-fix/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **step 0이 만든 서버측 계약을 바꾸지 마라.** 이유: 서버 불변식이 이 결함의 유일한 방어선이다.
  UI를 맞추기 어렵다고 서버에서 fingerprint 대조를 느슨하게 하면 F-001이 다시 열린다.
  서버 계약에 실제 결함이 있다고 판단되면 `status: "blocked"`로 중단하고 사유를 적어라.
- **클라이언트에서 fingerprint를 계산해 보내지 마라.** 이유: 서버가 원본 입력에서 계산한다
  (step 0 계약). 클라이언트는 입력 자체만 보낸다.
- **명시적 "초안 거부" 버튼의 `reject()` 경로를 제거하거나 fire-and-forget으로 바꾸지 마라.**
  이유: 그 경로는 응답을 기다리고 실패를 표면화하는 정상 흐름이다.
- **새 UI 컴포넌트·배너·토스트를 만들지 마라.** 이유: 기존 오류 표시 경로로 충분하다
  (over-engineering 금지, `AGENTS.md`).
- **E2E fixture(`e2e/fixtures.config.ts`)나 카탈로그 씨앗 파일을 새로 만들지 마라.** 이유:
  기존 fixture로 검증 가능하며, 카탈로그는 승인된 초안만 기록해야 한다.
- 기존 테스트를 깨뜨리지 마라.
