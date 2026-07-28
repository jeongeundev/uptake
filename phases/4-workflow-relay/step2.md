# Step 2: survey-rules-module

phase 4는 CLI 명령을 **사용자 저장소에서** 실행한다. 그러면 지금 코드가 동봉 자산을 푸는 방식이 깨진다 — `loadSurveyRules`는 기본 경로를 `resolve("survey-rules.json")`, 즉 `process.cwd()` 기준으로 푼다. 표면이 `next dev` 하나였고 항상 uptake 저장소 루트에서 띄웠기 때문에 드러나지 않았을 뿐이다.

이 step은 그 경로 해석을 **없앤다**(ADR-024). CLI는 아직 만들지 않는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "동봉 자산과 사용자 상태는 경로 기준이 다르다" CRITICAL 항목
- `/docs/ADR.md` — **ADR-024**(자산 경로 계약)가 이 step의 정본이다. ADR-018(수집 규칙 = 확장 가능한 데이터)도 읽어라
- `/docs/ARCHITECTURE.md` — '자산 경로 계약 (ADR-024)' 절
- `src/lib/engine/survey-rules.ts` · `src/lib/engine/survey-rules.test.ts`
- `src/types/survey.ts`
- `survey-rules.json` (저장소 루트)
- `tsconfig.json` (`resolveJsonModule`이 이미 `true`임을 확인하라)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 0: `SourceSpec.revision?` 추가, `resolveSources`가 고정 revision 존중, `revision-moved` 제거.
- step 1: `no-signal`이 `revision`·`skipped`를 싣고 `SurveyResult`의 두 실패가 같은 형태를 갖는다.
- 이 step은 두 변경과 겹치는 파일이 없다.

## 작업

`src/lib/engine/survey-rules.ts`의 `loadSurveyRules(rulesPath?: string)`에서 **기본 경로 해석을 제거**하고 모듈 import로 바꾼다.

우선순위는 `명시 인자 > 환경변수 > 기본값` 3단이며(ADR-024), 각 단이 값을 얻는 방법이 다르다:

| 우선순위 | 값의 출처 | 읽는 방법 |
|---|---|---|
| `rulesPath` 인자 | 호출자가 지정한 파일 | **fs 읽기** (종전 그대로) |
| `UPTAKE_SURVEY_RULES` | 사용자가 지정한 파일 | **fs 읽기** (종전 그대로) |
| 기본값 | 저장소 동봉 `survey-rules.json` | **모듈 import** — 경로가 개입하지 않는다 |

```ts
import defaultRuleSet from "../../../survey-rules.json";
```

경로가 맞는지 확인하라 — `src/lib/engine/`에서 저장소 루트까지는 세 단계 위다. `@/` 별칭은 `./src/*`만 커버하므로 루트 파일에는 쓸 수 없다.

**import한 값도 `parseRuleSet`를 그대로 통과시킨다.** 파싱·검증을 건너뛰지 마라 — 규칙은 코드가 아니라 데이터이고(ADR-018), 데이터는 같은 게이트를 통과해야 계약이 유지된다. `import`가 반환하는 값의 타입은 `unknown`으로 받아 기존 검증 경로에 그대로 태워라.

**왜 모듈 import인가** (이 결정은 확정이며 다시 열지 마라): `survey-rules.json`은 CLI와 웹이 **둘 다** 읽는 유일한 동봉 자산이다. 웹은 Next가 서버 코드를 번들하므로 `import.meta.url` 기준 해석이 출력 청크 위치를 가리킬 위험이 있고, 이 저장소엔 `next.config.*`가 없어 파일 추적 보정 수단도 없다. 모듈 import는 두 표면에서 동일하게 동작하고 경로가 개입하지 않는다.

### 테스트

`src/lib/engine/survey-rules.test.ts`에 다음을 추가한다:

- **인자·환경변수가 모두 없을 때 동봉 규칙이 로드된다** — `rules`가 비어 있지 않고 `budget`이 유효하다.
- **cwd와 무관하게 동작한다** — `process.chdir()`로 임시 디렉터리에 들어간 상태에서도 기본 로드가 성공한다. (테스트 후 원래 cwd로 복귀시켜라. `try/finally`를 써라 — 복귀하지 않으면 뒤따르는 테스트가 전부 깨진다.)
- **`UPTAKE_SURVEY_RULES` 오버라이드가 살아 있다** — 다른 파일을 가리키면 그 내용이 로드된다.
- **오버라이드 파일이 잘못되면 `SurveyRulesError`다** — fs 경로의 에러 처리가 사라지지 않았는지 확인한다.

기존 테스트 중 `resolve("survey-rules.json")` 기본 경로에 의존하던 것이 있으면 위 계약에 맞게 고친다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/lib/engine/survey-rules.test.ts
```

추가로 아래가 **0건**이어야 한다 (기본 경로 해석이 남지 않았는지):

```bash
grep -n 'resolve("survey-rules.json")' src/lib/engine/survey-rules.ts
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

- **`survey-rules.json` 파일을 지우거나 옮기거나 `.ts`로 바꾸지 마라. 이유: 수집 규칙은 생태계별로 확장 가능한 **데이터**다(ADR-018). 파일은 저장소 루트에 그대로 남는다 — import는 그것을 읽는 방법을 바꾼 것이지 데이터를 코드로 만든 것이 아니다.**
- **import한 기본값의 파싱·검증을 건너뛰지 마라. 이유: 검증을 우회하면 동봉 규칙과 사용자 규칙이 서로 다른 계약을 갖게 된다.**
- **`UPTAKE_SURVEY_RULES` 오버라이드를 제거하거나 import 기반으로 바꾸지 마라. 이유: 사용자가 지정하는 파일은 런타임에 결정되므로 fs 읽기여야 한다.**
- **`import.meta.url`이나 `__dirname`으로 `survey-rules.json` 경로를 계산하지 마라. 이유: 정확히 그 방식이 Next 번들에서 출력 청크를 가리킬 위험 때문에 배제됐다.**
- **씨앗 `catalog/`나 자기검증 fixture의 경로 해석을 함께 고치지 마라. 이유: phase 4의 CLI는 그 자산들을 읽지 않는다. 읽지 않는 자산의 경로를 미리 고치면 옳은지 검증할 실행이 없다(ADR-024).**
- **CLI(`bin/`)·워크플로우 층(`src/workflow/`)을 만들지 마라. 이유: 다음 step들의 범위다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
