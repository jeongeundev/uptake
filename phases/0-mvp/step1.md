# Step 1: pattern-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「패턴 스키마 (카탈로그 파일의 형태)」 절 전체. **TS 타입 정의가 그대로 실려 있다.**
- `/docs/ADR.md` — ADR-005(evidenceStatus)·ADR-012(capability). 두 분류축이 **직교**한다는 점.
- `/AGENTS.md` — 두 분류축·두 층 게이트에 대한 CRITICAL 규칙.
- 이전 step 산출물: `src/types/` 디렉토리 (step 0에서 빈 상태로 생성됨), `tsconfig.json`.

## 작업

`/docs/ARCHITECTURE.md`「패턴 스키마」 절의 TS 타입을 **`src/types/pattern.ts`에 그대로 물질화**한다. 이 파일은 카탈로그·엔진·검증 전 레이어가 공유하는 계약이다.

포함할 타입 (문서와 **정확히 일치**시켜라):

- `Source` — `id`, `repository`, `revision`, `stack`, `isTargetStack`, `independenceGroup`, `independenceNote`
- `Provenance` — `sourceId`, `path`, `observedRole`
- `InjectionTemplate` — `operation`, `targetRole`, `marker`, `replacement`
- `InstantiatedInjection` — `operation`, `path`, `marker`, `replacement`
- `Pattern` — `schemaVersion`, `patternId`, `name`, `capability`, `evidenceStatus`, `intent`, `roles[]`, `bindingPoints[]`, `sources[]`, `provenance[]`, `oracle?`, `tradeoffs`

각 필드의 리터럴 유니온(`capability: "generative" | "descriptive"`, `evidenceStatus: "observed" | "corroborated"`, `bindingPoints[].kind: "spec-format" | "checker" | "gate-location" | "naming"`, `oracle.expect: "red"`, `operation: "replace"`)을 문서 그대로 지킨다.

주석으로 문서의 핵심 계약을 짧게 남긴다 (예: `revision`에 "고정 커밋 SHA — 브랜치·태그 금지", `oracle`에 "capability = generative 일 때 필수").

## Acceptance Criteria

```bash
npm run build   # 타입 컴파일 에러 없음
npm run test    # 기존 스모크 통과 (신규 테스트 없음)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `src/types/pattern.ts`의 타입이 `/docs/ARCHITECTURE.md`「패턴 스키마」의 TS 정의와 필드·유니온까지 일치하는가?
   - `capability`와 `evidenceStatus`가 **별도 필드**로 분리돼 있는가? (하나로 뭉치면 ADR-005/012 위반)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/types/pattern.ts — Pattern 5요소+2축 스키마 타입 정의 (Source/Provenance/Injection*/Pattern). 이후 전 레이어의 공유 계약"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **런타임 로직(함수·클래스·검증 코드)을 쓰지 마라.** 이유: 이 파일은 순수 타입 계약이다. 로드 거부·검증 로직은 step 2가 만든다. (타입만 있으므로 `tdd-guard`가 이 파일에 테스트를 요구하지 않는다 — `types/`는 면제 대상이다.)
- **문서에 없는 필드를 추가하지 마라.** 이유: "요청하지 않은 유연성·미래대비 금지"(AGENTS.md). 스키마는 유예된 세부(ID 문자 제약 등)를 지금 넣지 않는다 — 그건 step 2 로더에서 확정한다.
- **`capability`와 `evidenceStatus`를 하나의 "tier" 필드로 합치지 마라.** 이유: 두 축은 직교하며, 생성 점등은 둘을 **모두** 만족할 때만 일어난다(ADR-012).
- 기존 테스트를 깨뜨리지 마라.
