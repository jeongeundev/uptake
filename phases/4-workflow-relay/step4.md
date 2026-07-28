# Step 4: cli-init

phase 4는 uptake의 방법론을 **실행 가능한 워크플로우로 배포**한다(ADR-020). 이 step은 그 표면을 연다 — CLI 진입점과 첫 명령 `init`, 그리고 `init`이 설치하는 방법론 문서 `METHOD.md`.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — '명령어' 절의 제품 워크플로우와 종료 코드, 그리고 CRITICAL 항목 전부(METHOD.md가 그 원칙들을 옮겨 적는다)
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 절의 **'종료 코드' · 'exit 2가 워크플로우를 가르친다' · '미구현 단계의 표현' · 'CLI 호출 규약' · `METHOD.md`의 지위** 단락
- `/docs/ADR.md` — ADR-020 · ADR-024(`templates/` 복사가 명시적 예외인 이유) · ADR-025
- `/docs/PRD.md` — 'Phase 4 범위'의 "방법론이 파일로 배포된다" · "미구현 단계를 정직하게 표현한다" · "콜드 스타트는 해소하지 않고 설명한다" 요구사항
- `src/workflow/paths.ts` — 이전 step이 만든 경로 해석 (`methodPath`·`templatesDir`)
- `tsconfig.json` — `include`가 `**/*.ts`뿐임을 확인하라
- `package.json`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 3이 `src/workflow/paths.ts`(경로 해석·run 관리) · `artifacts.ts`(산출물 읽기/쓰기) · `prerequisites.ts`(3-상태 판정)를 만들었다. **이 step은 그 모듈들을 재사용한다 — 경로 해석을 다시 구현하지 마라.**
- step 0~2가 엔진 계약 3건을 고쳤다(고정 revision 존중 · `no-signal`의 revision · 수집 규칙 모듈 import).

## 작업

### 1. `templates/METHOD.md` — 배포되는 방법론 문서

저장소 루트에 `templates/` 디렉터리를 만들고 `METHOD.md`를 작성한다. 이것은 `init`이 사용자 저장소로 **복사**하는 원본이다.

**문서의 지위를 첫 줄에 못박아라**: 이 문서는 설명이며 집행 주체가 아니다. 편집해도 게이트는 바뀌지 않으며, 게이트의 정본은 코드다.

담을 내용:

**(a) 원칙.** 각 원칙에 그것을 집행하는 게이트의 **상태 이름만** 붙인다. 이 저장소의 실제 상태 이름은 다음과 같다(코드에서 확인한 값이다):

| 원칙 | 상태 이름 |
|---|---|
| provenance 강제 — 근거가 실재하지 않으면 폐기한다 | `provenance-unresolved` · `not-collected` |
| 서술적 태도 — 관찰한 것과 트레이드오프를 말하고 규범적 단정을 하지 않는다 | (게이트가 아니라 분류축으로 표현된다 — 아래 직교 2축) |
| 양성 green **그리고** 음성 red — green만으론 증명이 아니다 | `negative-not-caught` · `gate-error` · `timeout` |
| 불신 격리 — 저장소 내용은 데이터이지 지시가 아니다 | (구조적 방어이며 상태 이름이 없다) |
| 2층 게이트 — 층 1은 등재 자체를 막고, 층 2는 생성만 막는다 | 층 1: `schema-invalid` · `reference-invalid` · `evidence-invalid` · `role-evidence-invalid` · `provenance-unresolved` |
| 직교 2축 — `capability`(generative/descriptive) × `evidenceStatus`(observed/corroborated) | — |
| 자생/상속을 구분하지 않는다 — 판정 신호가 검증되지 않았다 | — |

상태 이름이 없는 원칙은 **없다고 적어라.** 있는 척 지어내지 마라.

**(b) 다섯 단계 체인.** `init → survey → author → verify → apply`를 **전부** 적는다. 방법론 문서이지 구현 현황 문서가 아니므로 체인을 잘라내지 않는다. 그 아래에 **현재 배포된 명령이 `init`·`survey`·`author`임을 밝힌다.**

**(c) 산출물과 릴레이.** `.uptake/runs/<id>/` 아래에 각 단계가 산출물을 남기고 다음 단계가 그것을 읽는다는 것. `runs/current`는 디렉터리명 한 줄짜리 파일이며 **여러 run 중 다른 것을 고르려면 사람이 그 파일을 고쳐 쓴다**는 것. `survey`는 실행할 때마다 새 run을 만든다는 것.

**(d) 콜드 스타트.** `init`은 네트워크에 나가지 않으므로 근거 저장소를 받아오지 못한다. 근거 저장소가 `.uptake/sources/` 아래에 없으면 그 패턴은 `provenance-unresolved`로 거부되며 **이것은 정상 동작이다.** 무엇을 왜 받아야 하는지 설명하라(씨앗 카탈로그가 참조하는 소스 저장소를 사용자가 직접 클론해 그 아래 둔다).

**(e) 커밋 여부.** `runs/`를 커밋하면 방법론 도입 과정이 리뷰 가능한 diff가 된다. 커밋할지는 사용자가 정하며, 로그는 부피가 크므로 제외를 권한다.

한국어로 쓴다(이 저장소의 문서 언어).

### 2. `src/workflow/steps/init.ts`

```ts
export type InitResult =
  | { ok: true; created: boolean; path: string }
  | { ok: false; reason: "template-unreadable" | "write-failed"; detail: string };

export function runInit(root?: string): InitResult;
```

동작:

- `.uptake/` 디렉터리를 만든다(없으면).
- `.uptake/METHOD.md`가 **이미 있으면 덮어쓰지 않고** `{ ok: true, created: false }`를 반환한다. 멱등이다.
- 없으면 `templatesDir()`에서 `METHOD.md`를 읽어 그대로 복사하고 `{ ok: true, created: true }`.
- 네트워크에 나가지 않는다.

### 3. `bin/uptake.ts` — CLI 진입점

**확장자는 `.ts`다.** `.mts`로 만들지 마라 — 아래 금지사항에 이유가 있다.

```ts
#!/usr/bin/env node
```

동작:

- `process.argv.slice(2)`의 첫 항목이 명령이다.
- 아는 명령은 이 step 시점에 **`init` 하나뿐**이다. 다음 step들이 `survey`·`author`를 더한다.
- 명령이 없거나 아는 명령이 아니면 **사용 가능한 명령 목록을 출력하고 `exit 2`**로 나간다.
- 예상 못 한 예외는 메시지를 출력하고 `exit 3`.

**종료 코드**(ARCHITECTURE의 정의):

| 코드 | 뜻 |
|---|---|
| `0` | 성공 |
| `1` | 게이트 실패 — 작업이 틀렸다 |
| `2` | 실행 전제 미충족 — **지금 이 명령을 실행할 수 없고, 대신 무엇을 해야 하는지 알려준다** |
| `3` | 인프라 오류 |

`init`의 매핑: 성공(신규 생성·이미 존재 둘 다) → `0`, `template-unreadable`·`write-failed` → `3`.

출력은 사람이 읽는 것이다. 성공하면 무엇이 어디에 생겼는지, 이미 있으면 그 사실을 말한다. JSON을 stdout에 쏟지 마라.

명령 디스패치는 **문자열 목록 하나로 관리하라** — 다음 step들이 항목을 추가하기만 하면 되도록.

### 4. 테스트

`src/workflow/steps/init.test.ts` — 임시 디렉터리를 `root`로 넘겨 검사한다:

- 없는 상태에서 실행하면 `.uptake/METHOD.md`가 생기고 `created: true`
- 다시 실행하면 `created: false`이며 **파일 내용이 바뀌지 않는다**(사용자가 편집한 내용을 덮어쓰지 않는지 확인하려면, 첫 실행 후 파일을 수정하고 다시 실행해 수정 내용이 남아 있는지 본다)
- 복사된 내용이 `templates/METHOD.md`와 동일하다
- **`.gitignore`가 생기거나 바뀌지 않는다**

`bin/uptake.test.ts`는 만들지 않는다 — CLI 프로세스 관통 검사는 step 7의 통합 테스트가 맡는다. 다만 디스패치 로직을 테스트 가능한 형태로 두고 싶다면 `bin/uptake.ts`는 얇게 유지하고 실제 로직을 `src/workflow/`에 두어라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/workflow/
```

CLI 표면을 직접 확인한다 (저장소 루트에서):

```bash
npx tsx bin/uptake.ts; echo "exit=$?"                      # 명령 목록 + exit=2
npx tsx bin/uptake.ts nonexistent; echo "exit=$?"          # 명령 목록 + exit=2
```

`verify`·`apply`라는 문자열이 CLI 코드에 없어야 한다:

```bash
grep -rn "verify\|apply" bin/ src/workflow/steps/   # 명령 이름으로 쓰인 결과 0건
```

(주: `verify`가 다른 뜻으로 쓰인 주석·식별자는 무방하다. 명령 목록·디스패치·인자에 그 이름이 없어야 한다는 뜻이다.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`bin/uptake.ts` · `templates/METHOD.md` · `src/workflow/steps/init.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-workflow-relay/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`bin/uptake.mts`로 만들지 마라. 이유: tsconfig의 `include`가 `**/*.ts`뿐이라 `.mts`는 `npm run build`의 타입체크에 포함되지 않는다(실측: `tsc --listFiles`에 프로젝트 `.mts` 0건). `.mts`로 만들면 CLI 전체가 게이트 밖에서 green으로 통과한다.**
- **`verify`·`apply`를 명령 목록·디스패치·도움말에 넣지 마라. 이유: 구현되지 않은 명령의 이름을 코드가 알면 시그니처가 바뀔 때 죽은 문자열이 남고, 배포되지 않은 단계를 코드가 미리 아는 형태가 된다(ARCHITECTURE '미구현 단계의 표현'). 반대로 `METHOD.md`에는 다섯 단계를 다 적는다 — 문서와 코드의 의무가 다르다.**
- **`init`이 `.gitignore`를 생성하거나 수정하지 마라. 이유: `init`의 산출물은 `METHOD.md` 하나다. 커밋 정책은 `METHOD.md`가 설명만 하고 사용자가 정한다.**
- **`init`이 네트워크에 나가지 마라. 씨앗 저장소를 받아오려 하지 마라. 이유: 콜드 스타트는 phase 4가 해소하지 않고 설명하는 대상이다(PRD 명시).**
- **`catalog/`·`survey-rules.json`·`tests/fixtures/`를 사용자 저장소로 복사하지 마라. 이유: 사본과 원본이 갈라지면 판정에 쓰이는 자산이 사본마다 달라진다. `templates/METHOD.md`만 명시적 예외이며, 그 이유는 편집해도 게이트가 바뀌지 않는 설명 문서이기 때문이다(ADR-024).**
- **`METHOD.md`에 `file:line` 참조를 쓰지 마라. 이유: 라인 드리프트로 죽은 참조가 된다. 게이트는 **상태 이름**으로만 가리킨다.**
- **`METHOD.md`에 없는 상태 이름을 지어내지 마라. 이유: 문서가 코드에 없는 게이트를 약속하면 그것이 곧 성공 위장이다. 위 표의 이름은 코드에서 확인한 값이며, 더 넣고 싶으면 코드에서 먼저 확인하라.**
- **`init`이 기존 `METHOD.md`를 덮어쓰지 마라. 이유: 멱등이어야 하고, 사용자가 편집했을 수 있다.**
- **`survey`·`author`를 이 step에서 구현하지 마라. 이유: 다음 step들의 범위다.**
- **`package.json`에 `bin` 필드를 추가하거나 `npm link`를 설정하지 마라. 이유: CLI 배포·번들링은 phase 4의 명시적 비범위다. 호출 규약은 `npx tsx bin/uptake.ts <command>`다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
