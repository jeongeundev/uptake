# Step 1: survey-diagnostics

phase 4는 각 단계의 결과를 디스크 산출물로 남긴다(ADR-020). **게이트 실패도 산출물을 남기며, revision이 이미 고정된 뒤의 실패는 예외 없이 revision을 싣는다** — 그러지 않으면 "무엇을 조사했는지 모르는 실패 기록"이 남아 재현이 끊긴다. 지금 `no-signal`이 정확히 그 상태다: revision을 알면서도 `detail` 문자열만 반환한다.

이 step은 그 반환 형태를 넓힌다. CLI는 아직 만들지 않는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "게이트 실패도 산출물을 남긴다" CRITICAL 항목
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 절, 특히 **"revision이 고정된 뒤의 실패는 예외 없이 revision을 싣는다"** 단락과 3-상태 모델 표
- `/docs/PRD.md` — 'Phase 4 범위'의 "세 상태를 디스크에서 구분한다" 요구사항
- `/docs/ADR.md` — ADR-017(SURVEY가 제품 루트) · ADR-018(수집 규칙은 데이터)
- `src/lib/engine/survey-collect.ts` · `src/lib/engine/survey-collect.test.ts`
- `src/lib/engine/survey.ts` · `src/lib/engine/survey.test.ts`
- `src/services/survey-service.ts`
- `src/__tests__/survey-route.test.ts`
- `src/types/survey.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 0이 `SourceSpec.revision?`를 추가하고 `resolveSources`가 고정 revision을 존중하게 만들었다. `survey-adopt.ts`의 `revision-moved` 판정은 제거됐다.
- 이 step은 그 변경과 겹치는 파일이 없다.

## 작업

### 1. `CollectResult`의 `no-signal`이 확정된 사실을 싣는다

`src/lib/engine/survey-collect.ts`의 `CollectResult` 실패 유니온을 나눈다:

```ts
| {
    ok: false;
    reason: "repository-unresolved" | "revision-unpinnable";
    detail: string;
  }
| {
    ok: false;
    reason: "no-signal";
    detail: string;
    revision: string;
    skipped: SkippedSignal[];
  }
```

`no-signal`은 revision을 고정하고 트리를 읽은 **뒤** 파일이 하나도 수집되지 않은 상태다(현재 158-164행). 그 시점에는 `revision`과 `skipped`가 이미 확정돼 있으므로 함께 반환한다.

`repository-unresolved`·`revision-unpinnable`에는 **실을 revision이 없다** — revision을 고정하기 전에 끝난 실패이며, 그 부재가 곧 진단이다. 억지로 채우지 마라.

### 2. `SurveyResult`의 두 실패가 같은 형태를 갖는다

`src/lib/engine/survey.ts`의 `SurveyResult`에서 `no-signal`을 `no-candidate`와 **같은 형태의 브랜치**로 옮긴다:

```ts
| {
    ok: false;
    reason: "repository-unresolved" | "revision-unpinnable";
    detail: string;
  }
| {
    ok: false;
    reason: "no-signal" | "no-candidate";
    detail: string;
    repository: string;
    revision: string;
    collected: { path: string; ruleId: string; truncated: boolean }[];
    skipped: SkippedSignal[];
    discardedEvidence: DiscardedEvidence[];
    discardedCandidates: DiscardedSurveyCandidate[];
  }
```

`no-signal`일 때 채우는 값:

- `repository`: 인자로 받은 값
- `revision`·`skipped`: `collectSignalFiles`가 반환한 값
- `collected`: `[]` (수집된 파일이 0건이라 `no-signal`이 된 것이므로 항상 빈 배열이다)
- `discardedEvidence`·`discardedCandidates`: `[]` (proposer를 부르지도 않았다)

두 실패의 형태를 맞추는 이유: 다음 step들이 이 결과를 `survey.json`으로 **그대로 직렬화**한다. 실패마다 형태가 다르면 산출물 스키마가 실패 종류만큼 갈라진다.

### 3. `survey-service.ts`의 분기를 넓힌다

현재 98-110행이 `surveyed.reason === "no-candidate"`만 상세 필드를 채운다. `no-signal`도 같은 필드를 채우도록 바꾼다.

**분기 판정을 reason 문자열 나열로 하지 말고 판별 유니온을 쓰라** — `"repository" in surveyed`처럼 필드 존재로 좁히거나, TypeScript가 유니온을 좁힐 수 있는 형태로 작성하라. reason 이름을 나열하면 실패가 하나 늘 때마다 여기를 고쳐야 한다.

`SurveyError` 타입(27-48행)은 이미 `repository`·`revision`·`collected`·`skipped`·`discardedEvidence`·`discardedCandidates`를 선택 필드로 갖고 있다 — **타입을 바꿀 필요 없이 채우기만 하면 된다.**

### 4. 테스트

- `src/lib/engine/survey-collect.test.ts` — `no-signal` 반환에 `revision`과 `skipped`가 실려 있음을 확인한다. 수집 규칙에 하나도 걸리지 않는 fixture 저장소로 만들 수 있다.
- `src/lib/engine/survey.test.ts` — `no-signal`이 `repository`·`revision`·빈 `collected`를 싣는 것을 확인한다.
- `src/__tests__/survey-route.test.ts` — `no-signal` 응답에 revision이 실려 나가는지 확인한다(웹 API 응답 타입이 이 값을 그대로 내보낸다).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/lib/engine/survey-collect.test.ts src/lib/engine/survey.test.ts src/__tests__/survey-route.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-workflow-relay/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **새 `reason`/`status` 이름을 만들지 마라. 이유: ARCHITECTURE의 3-상태 모델은 "새 상태를 만드는 것이 아니라 기존 실패 분기에 필드를 더하는 것"을 명시한다. `no-signal`은 그대로 `no-signal`이다.**
- **`repository-unresolved`·`revision-unpinnable`에 빈 문자열이나 `"unknown"` 같은 자리표시 revision을 넣지 마라. 이유: revision을 고정하기 전에 끝난 실패이며, 값이 없다는 것이 진단이다. 가짜 값은 산출물을 읽는 쪽이 "조사는 됐는데 신호가 없었다"로 오해하게 만든다.**
- **`collected`에 수집되지 않은 파일을 채우지 마라. 이유: `no-signal`은 정의상 수집 0건이다.**
- **`SurveyError` 타입의 선택 필드를 필수로 바꾸지 마라. 이유: `repository-unresolved` 계열은 그 필드를 가질 수 없다.**
- **`collectSignalFiles`의 수집 알고리즘(라운드로빈·예산)을 건드리지 마라. 이유: 카테고리별 상한 문제는 실측으로 확인됐으나 타입·파서·수집기·테스트를 함께 고치는 별도 작업이며 phase 4 범위가 아니다.**
- **CLI(`bin/`)·워크플로우 층(`src/workflow/`)을 만들지 마라. 이유: 다음 step들의 범위다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
