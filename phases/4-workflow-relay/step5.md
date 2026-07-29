# Step 5: cli-survey

릴레이의 첫 조사 단계를 CLI로 연다. `uptake survey <repository>`는 저장소 하나를 조사해 개발 체계 후보를 뽑고, 그 결과를 **성공이든 실패든** `.uptake/runs/<id>/survey.json`에 남긴다. 다음 단계(`author`)는 프로세스가 죽은 뒤에도 그 파일에서 이어받는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "워크플로우의 정본은 CLI 명령과 디스크 산출물이다" · "게이트 실패도 산출물을 남긴다" CRITICAL 항목
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 절의 **단계와 릴레이 표 · "run은 `survey`가 만든다" · "여러 run 중 다른 것을 고르려면 `current`를 고쳐 쓴다" · 종료 코드** 단락
- `/docs/PRD.md` — 'Phase 4 범위'의 "산출물이 릴레이된다" 요구사항
- `/docs/ADR.md` — ADR-017(SURVEY가 제품 루트) · ADR-020 · ADR-024
- `src/workflow/paths.ts` · `artifacts.ts` · `prerequisites.ts` — 이전 step이 만든 저장 층
- `bin/uptake.ts` · `src/workflow/steps/init.ts` — 이전 step이 만든 CLI 표면
- `src/lib/engine/survey.ts` — `surveyRepository`의 시그니처와 `SurveyResult`
- `src/lib/engine/survey-rules.ts` — `loadSurveyRules` · `SurveyRulesError`
- `src/app/api/survey/proposer.ts` — 이 step에서 옮길 파일
- `src/app/api/survey/route.ts` · `src/app/api/survey/proposer.test.ts` · `src/__tests__/survey-route.test.ts` — 위 파일을 import하는 지점 셋
- `src/services/proposer-anthropic.ts` — `AnthropicProposerConfigurationError`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 3: `src/workflow/paths.ts`(`createRun`·`writeCurrentRun`·`sourceRoot` 등) · `artifacts.ts`(`writeSurveyArtifact`·`readSurveyArtifact`, `WorkflowArtifactError`) · `prerequisites.ts`(3-상태 판정).
- step 4: `bin/uptake.ts`(명령 디스패치·종료 코드) · `src/workflow/steps/init.ts` · `templates/METHOD.md`.
- step 1: `SurveyResult`의 실패가 두 형태다 — `repository-unresolved`/`revision-unpinnable`(detail만) 과 `no-signal`/`no-candidate`(repository·revision·collected·skipped·discardedEvidence·discardedCandidates를 싣는다).
- step 2: `loadSurveyRules()`가 인자·`UPTAKE_SURVEY_RULES` 없이도 동봉 규칙을 로드한다.

## 작업

### 1. proposer 선택 함수를 `src/services/`로 옮긴다

`src/app/api/survey/proposer.ts`를 **`src/services/survey-proposer.ts`로 이동한다. 내용은 그대로다 — 로직을 바꾸지 마라.**

import하는 지점 셋을 새 경로로 고친다:

- `src/app/api/survey/route.ts:9`
- `src/app/api/survey/proposer.test.ts:10` (테스트 파일도 `src/services/survey-proposer.test.ts`로 함께 옮긴다)
- `src/__tests__/survey-route.test.ts:17`

옮기는 이유: CLI가 Next Route Handler 디렉터리에 의존하면 안 된다. 두 표면이 같은 선택 경로를 쓰되 그 위치는 공유 서비스 층이어야 한다.

**`src/app/api/authoring/proposer.ts`는 건드리지 마라** — 저작 proposer는 이 phase의 CLI가 쓰지 않는다.

### 2. `src/workflow/steps/survey.ts`

```ts
export type SurveyCommandResult = {
  exitCode: 0 | 1 | 2 | 3;
  message: string;
  runId?: string;
};

export async function runSurveyCommand(
  repository: string,
  root?: string,
): Promise<SurveyCommandResult>;
```

동작 순서:

1. **설정을 먼저 검사한다.** `loadSurveyRules()`와 `configuredSurveyProposer()`를 부른다. 여기서 실패하면 **run을 만들지 않고** `exitCode: 2`로 돌아간다 — 조사를 시도하지도 못한 것이므로 남길 산출물이 없고, 사용자가 환경을 갖추면 해소된다.
   - `SurveyRulesError` → `exitCode: 2`, 무엇이 잘못됐는지 그대로 보인다
   - `AnthropicProposerConfigurationError` → `exitCode: 2`, `ANTHROPIC_API_KEY`·`UPTAKE_PROPOSER_MODEL`이 필요하다는 안내
2. **새 run을 만든다.** `createRun(repository, root)`. **실행할 때마다 새 run이며 앞 run을 덮어쓰지 않는다** — 조사는 revision을 새로 고정하는 행위이므로 재개가 아니라 새 작업이다.
3. `surveyRepository(repository, proposer, rules, sourceRoot(root))`를 부른다.
4. **결과를 성공·실패 무관하게 `survey.json`으로 쓴다.** `SurveyResult`를 `SurveyArtifact`로 옮기는 것은 `ok`를 `status`로 바꾸는 것이 전부다.
5. **`current`를 갱신한다.** 실패한 run도 갱신한다 — 마지막 조사가 그것이고, 다음 단계가 "앞 단계가 왜 실패했는지"를 그 run에서 읽어 사용자에게 보여야 한다(3-상태 모델의 "실행·실패").
6. 종료 코드를 매긴다:

| 결과 | exit | 이유 |
|---|---|---|
| 성공 (`surveyed`) | `0` | |
| `repository-unresolved` | `2` | 저장소를 `.uptake/sources/` 아래에 두면 해소된다 — 무엇을 할지 알려준다 |
| `revision-unpinnable` | `2` | git 저장소가 아니거나 커밋이 없다 — 같은 부류 |
| `no-signal` | `1` | 조사는 돌았고 결과가 비었다 — 게이트 실패 |
| `no-candidate` | `1` | 같음 |

`WorkflowArtifactError`나 예상 못 한 예외 → `exitCode: 3`.

**출력**은 사람이 읽는 것이다. 성공하면 run id, 고정한 revision, 후보 목록(id·이름·근거 경로 수)과 폐기된 것이 있으면 그 사유를 보인다. 실패하면 무엇이 왜 실패했는지와 산출물 경로를 보인다. **JSON을 stdout에 쏟지 마라** — 그것은 `survey.json`의 역할이다.

성공 메시지에 다음 명령(`uptake author --candidate <id>`)을 안내해도 좋다 — `author`는 이 phase가 배포하는 명령이다.

### 3. `bin/uptake.ts`에 `survey`를 연결한다

- 인자: `uptake survey <repository>`. repository가 없으면 사용법을 출력하고 `exit 2`.
- 명령 목록에 `survey`를 추가한다.

### 4. 테스트

`src/workflow/steps/survey.test.ts` — 임시 디렉터리를 `root`로, fixture 저장소를 `UPTAKE_SOURCE_ROOT`로 넘긴다. proposer는 `__setSurveyProposerForTests`로 주입하거나 스텁 스크립트를 쓴다(둘 중 하나를 고르고 일관되게 써라).

최소한 다음을 덮어라:

- 성공: `survey.json`의 `status`가 `surveyed`이고 `revision`이 fixture의 HEAD와 같다. `current`가 그 run을 가리킨다. `exitCode: 0`
- **두 번 실행하면 run이 둘이고 앞 run의 `survey.json`이 그대로 남아 있다.** `current`는 두 번째를 가리킨다
- `repository-unresolved`: 없는 저장소를 지정하면 `exitCode: 2`이고 **`survey.json`은 남는다**(status가 `repository-unresolved`)
- `no-candidate`: 스텁이 근거 없는 후보만 내면 `exitCode: 1`이고 `survey.json`에 폐기 사유가 실린다
- `no-signal`: 수집 규칙에 하나도 걸리지 않는 저장소면 `exitCode: 1`이고 `survey.json`에 **revision이 실린다**

기존 웹 테스트(`src/__tests__/survey-route.test.ts` · `src/services/survey-proposer.test.ts`)가 import 경로 변경 후에도 통과해야 한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/workflow/ src/__tests__/survey-route.test.ts src/services/survey-proposer.test.ts
```

옮긴 파일의 잔재가 없어야 한다:

```bash
grep -rn "@/app/api/survey/proposer" src/ e2e/    # 결과 0건
ls src/app/api/survey/proposer.ts                  # 존재하지 않음
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

- **같은 저장소를 다시 조사할 때 앞 run을 덮어쓰거나 재사용하지 마라. 이유: 조사는 revision을 새로 고정하는 행위이므로 재개가 아니라 새 작업이다. 재개는 `author` 이후 단계의 성질이다(ARCHITECTURE "run은 `survey`가 만든다").**
- **run을 고르는 옵션(`--run`·`--resume` 등)을 만들지 마라. 이유: 여러 run 중 고르는 인터페이스는 `runs/current`를 사람이 고쳐 쓰는 것 하나다. 명령 옵션으로 만들면 "각 명령은 인자 없이 앞 단계를 찾는다"는 릴레이 계약에 예외가 생긴다.**
- **실패했다고 산출물을 쓰지 않고 나가지 마라. 이유: "실행하지 않음"과 "실행했지만 실패"를 디스크에서 구분할 수 있어야 한다. 그것이 3-상태 모델이다.**
- **`repository-unresolved`·`revision-unpinnable`에 자리표시 revision을 채우지 마라. 이유: revision 고정 전에 끝난 실패이며 값의 부재가 진단이다.**
- **카탈로그(`catalog/`)를 읽거나 쓰지 마라. 이유: CLI 워크플로우는 카탈로그를 거치지 않는다(ADR-025).**
- **`src/app/api/survey/proposer.ts`의 내용을 고치면서 옮기지 마라. 이유: 이 step의 이동은 위치 변경이며, 로직을 함께 바꾸면 웹 회귀가 났을 때 원인이 갈리지 않는다.**
- **웹 UI 컴포넌트(`src/components/`)를 건드리지 마라. 이유: phase 4는 웹 표면을 개편하지 않는다.**
- **`author`를 이 step에서 구현하지 마라. 이유: 다음 step의 범위다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
