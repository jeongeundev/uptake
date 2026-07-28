# Step 6: cli-author

릴레이가 프로세스 경계를 넘는 지점이다. `uptake author --candidate <id>`는 인자로 저장소도 revision도 받지 않는다 — `runs/current`가 가리키는 run의 `survey.json`에서 전부 읽는다. **`survey`를 돌린 프로세스는 이미 죽었고, 이어받는 것은 디스크뿐이다.**

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "고정 revision에서 읽는 단계는 HEAD를 다시 읽지 않는다" · "CLI는 카탈로그를 거치지 않으므로 층 1 보증을 소비 시점에 만든다" CRITICAL 항목, '명령어' 절의 `author` 설명
- `/docs/ADR.md` — **ADR-023**(채택 경로만 태운다) · **ADR-025**(층 1 재검증 · 등재 제외) · ADR-021(고정 revision)
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약'의 단계와 릴레이 표 · '층 1 재검증' 절 · "phase 4에는 승인 경계가 없다" 단락
- `/docs/PRD.md` — 'Phase 4 범위'의 "고정 revision을 그대로 소비한다" · "채택 경로의 게이트는 그대로 걸린다" · "소비 가능한 형태로 직렬화한다" 요구사항
- `src/workflow/paths.ts` · `artifacts.ts` · `prerequisites.ts`
- `src/workflow/steps/survey.ts` · `bin/uptake.ts`
- `src/lib/engine/survey-adopt.ts` — `adoptSurveyCandidate`의 시그니처와 `AdoptResult`
- `src/lib/catalog/load.ts` — `validatePatternValue`의 시그니처
- `src/types/pattern.ts` · `src/types/survey.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 0: `adoptSurveyCandidate`가 `input.revision`을 `SourceSpec.revision`으로 실어 보내고 `extractFromCandidates`가 그 값을 쓴다. HEAD를 다시 읽지 않는다. `AdoptResult`의 실패 reason은 `source-id-underivable` · `revision-unresolvable` · `provenance-unresolvable` · `extract-failed` · `assembly-invalid`다.
- step 3: `AuthoringArtifact` 타입과 `writeAuthoringArtifact`/`readAuthoringArtifact`, 3-상태 판정 헬퍼.
- step 5: `runSurveyCommand`가 새 run을 만들고 `survey.json`과 `current`를 쓴다. `bin/uptake.ts`가 `init`·`survey`를 디스패치한다.

## 작업

### 1. `src/workflow/steps/author.ts`

```ts
export type AuthorCommandResult = {
  exitCode: 0 | 1 | 2 | 3;
  message: string;
};

export async function runAuthorCommand(
  candidateId: string,
  root?: string,
): Promise<AuthorCommandResult>;
```

동작 순서:

1. **선행조건을 검사한다.** 미실행과 실패 두 경우를 모두 검사하고, 각각 **다음에 칠 명령을 알려준다.**

| 상태 | exit | 메시지 |
|---|---|---|
| `current`가 없다 (`survey`를 한 번도 안 돌렸다) | `2` | `uptake survey <repository>`를 먼저 실행하라 |
| `survey.json`이 없다 | `2` | 같음 |
| `survey.json`의 status가 실패다 | `2` | **그 실패 사유를 그대로 보이고** 다시 조사하라고 안내한다 |
| `candidateId`가 후보 목록에 없다 | `2` | 사용 가능한 후보 id를 나열한다 |

2. `survey.json`에서 `repository`·`revision`·해당 `candidate`를 읽어 `adoptSurveyCandidate({ repository, revision, candidate }, sourceRoot(root))`를 부른다. **revision은 `survey.json`의 값을 그대로 쓴다 — `git rev-parse HEAD`를 부르지 마라.**

3. **결과를 성공·실패 무관하게 `authoring.json`으로 쓴다.**
   - 성공: `{ status: "drafted", candidateId, pattern, discarded, targetStackFacts }`
   - 실패: `{ status: <AdoptResult의 reason>, detail, candidateId }`

4. 종료 코드:

| 결과 | exit |
|---|---|
| 성공 (`drafted`) | `0` |
| 채택 실패 전부 (`source-id-underivable`·`revision-unresolvable`·`provenance-unresolvable`·`extract-failed`·`assembly-invalid`) | `1` |
| `WorkflowArtifactError`·예상 못 한 예외 | `3` |

채택 실패가 `1`인 이유: 선행 산출물은 갖춰져 있고 실행도 됐다. 게이트가 근거를 거부한 것이므로 "작업이 틀렸다"이다.

5. **출력.** 성공하면 조립된 패턴의 id·이름·`capability`/`evidenceStatus`·근거 경로와 **폐기된 근거가 있으면 그 사유**를 보인다. 그리고 마지막 줄에 **"여기까지가 현재 배포된 워크플로우다"**를 말한다 — 다음 명령을 안내하지 마라.

### 2. 직렬화 의무 — `pattern`은 `validatePatternValue`가 그대로 먹는 형태여야 한다

CLI는 카탈로그를 거치지 않으므로 층 1 하드 게이트의 보증이 **소비 시점 재검증**에서 온다(ADR-025). 그 재검증은 phase 5의 `verify`가 걸고, **phase 4의 의무는 하나뿐이다 — 그 함수가 그대로 먹는 형태로 직렬화할 것.**

`adoptSurveyCandidate`가 반환하는 `Pattern`은 이미 그 형태다. 이 step이 할 일은 **직렬화 왕복이 그 형태를 깨지 않는지 테스트로 확인하는 것**이다:

```ts
const artifact = readAuthoringArtifact(runId, root);
const validation = validatePatternValue(artifact.pattern, "authoring.json", sourceRootPath);
expect(validation.ok).toBe(true);
```

**`author`가 실행 중에 `validatePatternValue`를 걸지는 마라** — 소비 시점에 거는 것이 ADR-025의 결정이고, 여기서 걸면 같은 검증이 세 곳에서 돌게 된다. 의무는 형태이지 검사가 아니다.

### 3. `bin/uptake.ts`에 `author`를 연결한다

- 인자: `uptake author --candidate <id>`. `--candidate`가 없거나 값이 비면 사용법을 출력하고 `exit 2`.
- 명령 목록에 `author`를 추가한다.
- **`--source`·`--capability` 플래그를 만들지 마라**(아래 금지사항).

### 4. 테스트

`src/workflow/steps/author.test.ts` — 임시 디렉터리를 `root`로, fixture 저장소를 `UPTAKE_SOURCE_ROOT`로 넘긴다. `survey.json`은 `writeSurveyArtifact`로 직접 만들어도 되고 `runSurveyCommand`를 돌려 만들어도 된다.

최소한 다음을 덮어라:

- 성공: `authoring.json`의 status가 `drafted`이고 `pattern`이 실린다. `exitCode: 0`
- **직렬화 왕복 후 `validatePatternValue`가 ok다** (위 2번)
- **HEAD가 움직여도 성공한다** — `survey.json`을 만든 뒤 fixture 저장소에 새 커밋을 넣고 `author`를 돌린다. 조립된 패턴의 `sources[0].revision`이 **`survey.json`의 revision**이다
- `current`가 없으면 `exitCode: 2`이고 메시지가 `uptake survey`를 가리킨다
- `survey.json`이 실패 상태면 `exitCode: 2`이고 **그 실패 사유가 메시지에 보인다**
- 없는 candidateId면 `exitCode: 2`이고 사용 가능한 id가 나열된다
- 채택 실패(예: 근거 파일이 그 revision에 없는 후보)면 `exitCode: 1`이고 `authoring.json`이 실패 status로 남는다
- **`catalog/` 아래에 파일이 생기지 않는다**

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/workflow/
```

카탈로그 등재 경로를 부르지 않았는지 확인한다:

```bash
grep -rn "registerPattern\|writePattern\|loadCatalog" src/workflow/   # 결과 0건
```

배포되지 않은 명령 이름이 없어야 한다:

```bash
grep -rn '"verify"\|"apply"\|--source\|--capability' bin/ src/workflow/steps/   # 결과 0건
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

- **`git rev-parse HEAD`를 부르거나 저장소의 현재 HEAD를 읽지 마라. 이유: `survey.json`에 고정된 revision을 그대로 쓰는 것이 ADR-021의 계약이다. "HEAD가 움직였다"는 실패 사유가 아니다.**
- **`--source`·`--capability` 플래그를 만들지 마라. 이유: 두 번째 소스 대조 저작과 `generative` 승격은 phase 4의 명시적 비범위다(ADR-023). 채택 경로와 대조 저작은 이름만 같지 저작 기계가 다르며, 채택 경로로는 `generative`가 원천적으로 불가능하다(앵커 역할 게이트). 채택 산출물은 항상 `descriptive`/`observed`다.**
- **카탈로그에 등재하지 마라. `registerPattern`·`writePattern`·`loadCatalog`를 부르지 마라. 이유: 5단계 체인 어디에도 등재된 카탈로그를 되읽는 단계가 없다. 아무도 소비하지 않는 산출물은 릴레이의 일부가 아니며, 등재는 카탈로그를 실제로 읽는 단계와 함께 설계한다(ADR-025).**
- **`authoring.json` 외에 `status`를 싣는 두 번째 파일을 만들지 마라(`pattern.draft.json` 금지). 이유: 갈라두면 "`status`는 성공인데 패턴 파일이 없다"는 상태가 가능해져 성공 판별자가 두 파일에 걸친다.**
- **`author` 안에서 `validatePatternValue`를 걸지 마라. 이유: 층 1 재검증은 **소비 시점**에 거는 것이 ADR-025의 결정이다. phase 4의 의무는 그 함수가 먹는 형태로 직렬화하는 것이며, 그 사실은 테스트로 확인한다.**
- **성공 메시지에 `verify`·`apply`를 안내하지 마라. 이유: 배포되지 않은 명령의 이름을 코드가 갖지 않는다. "여기까지가 현재 배포된 워크플로우"를 말한다(ARCHITECTURE '미구현 단계의 표현').**
- **승인 단계(approve/confirm)를 넣지 마라. 이유: `author`는 run 디렉터리 안에만 쓰고 사용자 저장소의 다른 곳이나 타깃 저장소를 바꾸지 않는다 — 동의를 받을 대상이 없다. 승인이 필요해지는 지점은 phase 5의 `apply`다.**
- **draft 저장소(`src/services/draft-store.ts`)나 인메모리 승인 저장소를 쓰지 마라. 이유: 그것들은 HTTP 세션이 사람의 의사를 대신 주장하는 웹 표면의 구조이며, CLI에는 그 간극이 없다.**
- **웹 UI·Route Handler를 건드리지 마라.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
