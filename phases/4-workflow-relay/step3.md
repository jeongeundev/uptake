# Step 3: workflow-store

phase 4의 핵심은 **파일 릴레이**다 — 각 단계가 `.uptake/runs/<id>/` 아래에 산출물을 쓰고, 다음 단계가 인자 없이 `runs/current`가 가리키는 run에서 그것을 찾아 읽는다. 프로세스가 죽어도 이어진다(ADR-020).

이 step은 그 릴레이의 **저장 층**을 만든다. 명령(`init`·`survey`·`author`)은 다음 step들이 얹는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "워크플로우의 정본은 CLI 명령과 디스크 산출물이다" · "동봉 자산과 사용자 상태는 경로 기준이 다르다" CRITICAL 항목
- `/docs/ARCHITECTURE.md` — **'워크플로우 산출물 계약 (phase 4·5)' 절 전체**가 이 step의 정본이다. '디렉토리 구조' 절의 `.uptake/` 트리와 `src/workflow/` 구조도 읽어라
- `/docs/ADR.md` — ADR-020(워크플로우 정본) · ADR-024(자산 경로) · ADR-025(층 1 재검증)
- `/docs/PRD.md` — 'Phase 4 범위'의 "산출물이 릴레이된다" · "세 상태를 디스크에서 구분한다" 요구사항
- `src/lib/engine/survey.ts` — `SurveyResult`의 형태 (산출물이 이것을 직렬화한다)
- `src/lib/engine/survey-adopt.ts` — `AdoptResult`의 형태
- `src/types/pattern.ts` · `src/types/survey.ts` · `src/types/authoring.ts`
- `src/lib/catalog/write.ts` — 이 저장소가 파일을 원자적으로 쓰는 기존 방식이 있는지 확인하라

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 0: `SourceSpec.revision?` 추가. `AdoptResult`의 실패 reason은 `source-id-underivable` · `revision-unresolvable` · `provenance-unresolvable` · `extract-failed` · `assembly-invalid`다 (`revision-moved`는 제거됐다).
- step 1: `SurveyResult`의 실패가 두 형태다 — `repository-unresolved`/`revision-unpinnable`(detail만) 과 `no-signal`/`no-candidate`(repository·revision·collected·skipped·discardedEvidence·discardedCandidates를 싣는다).
- step 2: `loadSurveyRules`가 동봉 규칙을 모듈 import한다.

**이 step을 시작하기 전에 `src/lib/engine/survey.ts`와 `survey-adopt.ts`를 실제로 열어 현재 타입을 확인하라.** 아래 산출물 스키마는 그 타입을 직렬화한 것이며, 실제 타입과 어긋나면 실제 타입이 정본이다.

## 작업

`src/workflow/` 디렉터리를 만들고 세 모듈을 작성한다.

### 1. `src/workflow/paths.ts` — 경로 해석과 run 관리

**경로는 두 종류뿐이며 기준이 다르다**(ADR-024):

| 종류 | 대상 | 해석 기준 |
|---|---|---|
| 사용자 상태 | `.uptake/`(`METHOD.md`·`runs/`·`sources/`) | **프로젝트 루트** = 실행 시 작업 디렉터리 |
| 패키지 동봉 자산 | `templates/` | **설치 위치** = 이 소스 파일 기준 |

시그니처(내부 구현은 재량):

```ts
export function projectRoot(root?: string): string;        // root ?? process.cwd()
export function uptakeDir(root?: string): string;          // <projectRoot>/.uptake
export function runsDir(root?: string): string;            // <projectRoot>/.uptake/runs
export function runDir(runId: string, root?: string): string;
export function methodPath(root?: string): string;         // <projectRoot>/.uptake/METHOD.md
export function sourceRoot(root?: string): string;         // UPTAKE_SOURCE_ROOT ?? <projectRoot>/.uptake/sources

export function templatesDir(): string;                    // 설치 위치 기준 <packageRoot>/templates

export function readCurrentRun(root?: string): string | undefined;
export function writeCurrentRun(runId: string, root?: string): void;
export function createRun(repository: string, root?: string): string;  // 새 run 디렉터리를 만들고 runId 반환
```

**run id 규칙**: `NNN-<slug>`

- `NNN`: 3자리 0패딩 순번. `runs/` 아래 `^\d{3}-` 형태 디렉터리의 최대 순번 + 1. 없으면 `001`.
- `<slug>`: `repository` 문자열을 소문자화하고 `[^a-z0-9]+`를 `-`로 치환한 뒤 앞뒤 `-`를 제거한 것. 결과가 빈 문자열이면 `repo`를 쓴다.
- 순번이 이미 999를 넘으면 그대로 4자리 이상으로 늘어나면 된다 — 별도 처리를 넣지 마라.

**`templatesDir()`의 설치 위치 해석**은 `import.meta.url` 기준으로 이 파일에서 저장소 루트까지 올라간 뒤 `templates`를 붙인다. `process.cwd()`를 쓰지 마라 — 사용자 저장소에서 실행하는 순간 없는 경로가 된다.

`sourceRoot()`가 `UPTAKE_SOURCE_ROOT`를 먼저 보는 것은 기존 엔진(`resolveRepositoryRoot`·`resolveProvenance`·`validatePatternValue`)이 같은 환경변수를 쓰기 때문이다. 기본값만 `process.cwd()`가 아니라 프로젝트 루트 기준으로 바뀐다.

### 2. `src/workflow/artifacts.ts` — 산출물 읽기/쓰기

**산출물은 엔진이 반환한 것을 그대로 직렬화한 것이다.** 새 상태 타입을 만들지 않는다 — `ok: true/false`를 `status` 문자열로 바꾸는 것이 전부다.

```ts
export type SurveyArtifact =
  | { status: "surveyed"; repository: string; revision: string; candidates: SurveyCandidate[];
      collected: {...}[]; skipped: {...}[]; discardedEvidence: {...}[]; discardedCandidates: {...}[] }
  | { status: "no-signal" | "no-candidate"; detail: string; repository: string; revision: string;
      collected: {...}[]; skipped: {...}[]; discardedEvidence: {...}[]; discardedCandidates: {...}[] }
  | { status: "repository-unresolved" | "revision-unpinnable"; detail: string };

export type AuthoringArtifact =
  | { status: "drafted"; candidateId: string; pattern: Pattern;
      discarded: DiscardedCandidate[]; targetStackFacts: TargetStackFact[] }
  | { status: "source-id-underivable" | "revision-unresolvable" | "provenance-unresolvable"
            | "extract-failed" | "assembly-invalid";
      detail: string; candidateId: string };
```

필드 타입은 위 엔진 모듈의 타입을 **import해서 재사용하라.** 같은 모양을 손으로 다시 적지 마라 — 엔진이 바뀌면 조용히 어긋난다.

시그니처:

```ts
export function writeSurveyArtifact(runId: string, artifact: SurveyArtifact, root?: string): void;
export function readSurveyArtifact(runId: string, root?: string): SurveyArtifact | undefined;
export function writeAuthoringArtifact(runId: string, artifact: AuthoringArtifact, root?: string): void;
export function readAuthoringArtifact(runId: string, root?: string): AuthoringArtifact | undefined;
```

파일명은 `survey.json` · `authoring.json`이다.

**쓰기는 원자적이어야 한다** — 같은 디렉터리에 임시 파일로 쓴 뒤 `renameSync`로 옮긴다. 중단된 쓰기가 반쪽 JSON을 남기면 다음 단계가 "실행했지만 실패"와 구분할 수 없는 상태를 읽는다. JSON은 사람이 읽을 수 있게 2칸 들여쓰기 + 끝에 개행.

**읽기는 형태를 검증한다.** 파일이 없으면 `undefined`. 파싱에 실패하거나 `status`가 알려진 값이 아니면 `undefined`가 아니라 **던져라** — "파일이 없다"(미실행)와 "파일이 깨졌다"(사용자가 손댔거나 쓰기가 중단됐다)는 다른 상태이며, 후자를 조용히 미실행으로 취급하면 앞 단계를 지운 것과 같아진다. 던지는 에러는 전용 클래스(`WorkflowArtifactError`)로 만들어 호출자가 인프라 오류(exit 3)로 분류할 수 있게 하라.

성공 status일 때 필요한 필드가 있는지도 확인한다(예: `drafted`인데 `pattern`이 없으면 에러). 필드 하나하나를 깊게 검증할 필요는 없다 — `pattern`의 내용 검증은 소비 시점에 `validatePatternValue`가 한다(ADR-025).

### 3. `src/workflow/prerequisites.ts` — 3-상태 판정

| 상태 | 디스크 | 판정 |
|---|---|---|
| 미실행 | 파일 부재 | 선행조건 미충족 |
| 실행·실패 | 파일 존재 + 실패 status | 선행조건 미충족 (사유를 그대로 보인다) |
| 실행·성공 | 파일 존재 + 성공 status | 다음 단계 진행 |

```ts
export type StageState<T> =
  | { state: "missing" }
  | { state: "failed"; status: string; detail: string }
  | { state: "succeeded"; artifact: T };

export function surveyState(runId: string, root?: string): StageState<Extract<SurveyArtifact, { status: "surveyed" }>>;
```

`current`가 없는 경우까지 포함해 판정하는 헬퍼도 여기 둔다:

```ts
export type CurrentSurveyState = { state: "no-run" } | StageState<...>;
export function currentSurveyState(root?: string): CurrentSurveyState;
```

**성공 판별자는 `status` 하나다.** 성공했을 때만 생기는 별도 파일의 존재를 판별자로 삼지 마라 — "`status`는 성공인데 그 파일이 없다"는 상태가 가능해지고, 선행조건 검사가 무엇을 믿을지 정할 수 없게 된다.

### 4. 테스트

`src/workflow/paths.test.ts` · `artifacts.test.ts` · `prerequisites.test.ts`를 작성한다. 모두 **임시 디렉터리를 `root` 인자로 넘겨** 검사하라(`process.chdir`에 의존하지 마라 — 테스트가 서로 간섭한다).

최소한 다음을 덮어라:

- `createRun`이 `001-...`부터 시작하고 두 번 부르면 `002-...`가 되며, **앞 run 디렉터리를 지우거나 덮어쓰지 않는다**
- slug가 이상한 저장소 이름(`../evil`, 빈 문자열, 유니코드)에서도 `NNN-<safe>` 형태를 유지한다
- `writeCurrentRun`/`readCurrentRun` 왕복. `current`가 없으면 `undefined`
- 산출물 쓰기 → 읽기 왕복이 성공·실패 두 형태 모두에서 성립한다
- 깨진 JSON을 읽으면 `WorkflowArtifactError`가 던져진다 (조용히 `undefined`가 아니다)
- 3-상태 판정이 세 경우를 각각 맞게 가른다
- `templatesDir()`이 cwd와 무관하다 — 임시 디렉터리로 `process.chdir` 한 상태에서도 같은 값을 반환한다 (`try/finally`로 반드시 원래 cwd로 복귀시켜라)

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/workflow/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/workflow/paths.ts`·`artifacts.ts`·`prerequisites.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-workflow-relay/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **산출물에 새 상태 이름을 만들지 마라. 이유: 엔진이 반환한 reason을 그대로 `status`로 쓴다. 이름을 바꾸면 진단이 엔진과 산출물에서 갈라지고, 어느 쪽이 정본인지 알 수 없게 된다.**
- **`.uptake/`를 설치 위치 기준으로, `templates/`를 `process.cwd()` 기준으로 해석하지 마라. 이유: 정확히 반대다(ADR-024). 뒤바꾸면 CLI가 uptake 저장소 밖에서 도는 순간 깨진다.**
- **`config.json`·`run.json` 같은 설정 파일이나 실행 원장을 만들지 마라. 이유: 설정은 `인자 > 환경변수 > 기본값`으로 해결되고, 실행 원장은 어느 단계도 읽지 않는다(PRD 명시적 비범위).**
- **산출물에 해시·fingerprint·체크섬을 넣지 마라. 이유: ADR-025가 편집 탐지를 명시적으로 배제했다. 산출물을 사람이 읽고 고칠 수 있다는 것이 파일 릴레이를 고른 이유이며, 보증은 소비 시점 재검증으로 만든다.**
- **한 단계의 `status`를 두 파일에 나눠 싣지 마라. 이유: 성공 판별자가 두 파일에 걸치면 "status는 성공인데 파일이 없다"는 상태가 생긴다. `pattern`은 `authoring.json` 안의 필드다 — `pattern.draft.json` 같은 별도 파일을 만들지 마라.**
- **`verify`·`apply`의 산출물(`bindings.json`·`generated.json`·`verify.json`·`apply.json`)을 위한 타입·함수를 미리 만들지 마라. 이유: phase 5의 범위이며, 시그니처가 확정되지 않은 것을 미리 박으면 죽은 코드가 남는다.**
- **run을 고르는 옵션이나 API를 만들지 마라. 이유: 여러 run 중 하나를 고르는 인터페이스는 `runs/current` 파일을 사람이 고쳐 쓰는 것 하나다.**
- **`bin/uptake.ts`나 `src/workflow/steps/`를 만들지 마라. 이유: 다음 step들의 범위다.**
- **웹 UI·Route Handler·엔진 파일을 건드리지 마라. 이유: 이 step은 새 모듈만 추가한다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
