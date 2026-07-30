# Step 1: verify-artifacts

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 전부
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약'의 단계·릴레이 표, 3-상태 모델, "성공 판별자는 한 파일에만 있다", "게이트 실패도 산출물을 남긴다"
- `/docs/PRD.md` — 'Phase 5 범위'
- `/src/workflow/artifacts.ts` — 이번 step이 확장할 대상. 기존 `survey.json`·`authoring.json` 처리 방식(원자적 쓰기 + 형태 검사 읽기)을 그대로 따른다
- `/src/workflow/prerequisites.ts` — 3-상태 판정
- `/src/workflow/paths.ts` — `runDir`·`readCurrentRun`
- `/src/lib/engine/verify.ts`, `/src/lib/engine/apply.ts`, `/src/lib/engine/instantiate.ts`, `/src/lib/engine/detect.ts` — 직렬화 대상 타입(`GeneratedFile`·`InstantiatedInjection`·`BindingDetection`·`ApprovalInput`)
- `/src/services/workflow-store.ts` — `targetEligibility` 함수(이번 step이 옮긴다)

**이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.** step 0이 `applyGenerated`를 순수화하고(`ApprovalInput`), `hashBindings`를 추가하고, `VerifyOutcome` 실패 분기에 로그 경로를 실었다.

## 배경

`verify`·`apply`가 쓸 산출물의 **저장 층**을 만드는 step이다. 명령 로직(step 2·3)은 여기 만든 것을 쓰기만 한다. 이 step은 CLI 명령을 배포하지 않는다 — `cli.ts`를 건드리지 마라.

산출물 배치(ARCHITECTURE 릴레이 표):

```
.uptake/runs/<run-id>/
  survey.json        (기존)
  authoring.json     (기존)
  bindings.json      verify가 항상 쓴다 — 해소된 바인딩
  generated.json     verify 성공 시 — instantiate한 정확한 파일들
  verify.json        verify의 상태 파일
  logs/positive.log
  logs/negative.log
  apply.json         apply의 상태 파일
```

**성공 판별자는 상태 파일의 `status` 하나뿐이다.** `generated.json`은 판별자가 아니라 `verify.json`이 성공일 때 함께 있어야 하는 내용이다.

## 작업

### (a) `src/workflow/artifacts.ts` 확장

기존 파일의 구조(판별 유니온 타입 → `is*Shape` 검사 함수 → `writeJsonAtomic` 기반 write → `readJsonArtifact` 기반 read)를 그대로 따라 네 산출물을 추가한다. **기존 `survey`/`authoring` 코드를 리팩터링하지 마라.**

```ts
export type BindingsArtifact = {
  patternId: string;
  targetRepoRoot: string;
  bindings: BindingDetection[];
};

export type GeneratedArtifact = {
  patternId: string;
  files: GeneratedFile[];
  injection: InstantiatedInjection;
  gateTestId: string;
};

export type VerifyArtifact =
  | {
      status: "verified";
      verificationId: string;
      patternId: string;
      targetRepoRoot: string;
      contentHash: string;
      bindingsHash: string;
      targetBaseHash: string;
      frozenArgv: string[];
      gateTestId: string;
      positivePreview: string;
      positiveTruncated: boolean;
      negativePreview: string;
      negativeTruncated: boolean;
    }
  | {
      status:
        | "pattern-invalid"
        | "target-ineligible"
        | "bindings-unresolved"
        | "generation-blocked"
        | "generation-failed"
        | "injection-failed"
        | "positive-failed"
        | "negative-not-caught"
        | "gate-error"
        | "timeout";
      detail: string;
      patternId?: string;
      targetRepoRoot: string;
      frozenArgv?: string[];
    };

export type ApplyArtifact =
  | {
      status: "applied";
      verificationId: string;
      targetRepoRoot: string;
      written: string[];
    }
  | {
      status: "diff-mismatch" | "bindings-mismatch" | "base-changed" | "apply-failed";
      verificationId: string;
      targetRepoRoot: string;
      detail: string;
    };
```

읽기/쓰기 함수는 기존 이름 규칙을 따른다:

```ts
export function writeBindingsArtifact(runId: string, artifact: BindingsArtifact, root?: string): void;
export function readBindingsArtifact(runId: string, root?: string): BindingsArtifact | undefined;
// generated · verify · apply도 같은 형태
export function runLogPath(runId: string, name: "positive" | "negative", root?: string): string;
export function writeRunLog(runId: string, name: "positive" | "negative", sourcePath: string, root?: string): void;
```

규칙:

- **`writeRunLog`는 gate-runner가 임시 디렉터리에 남긴 로그 파일을 `runs/<id>/logs/<name>.log`로 복사한다.** 원본을 옮기거나 지우지 마라(엔진의 임시 자원이다). 원본을 읽을 수 없으면 **던지지 말고** 그 사실이 드러나게 처리하라 — 로그 부재 때문에 검증 결과 기록 자체가 유실되면 안 된다.
- 상태 파일(`verify.json`·`apply.json`)의 실패 분기는 **`targetRepoRoot`를 예외 없이 싣는다.** "무엇을 대상으로 실패했는지 모르는 기록"이 남으면 재현이 끊긴다(ARCHITECTURE: "revision이 고정된 뒤의 실패는 예외 없이 revision을 싣는다"와 같은 원칙).
- 형태 검사(`is*Shape`)는 기존 함수들과 같은 수준으로만 한다 — `status` 값 집합 + 분기별 필수 필드의 타입. 배열 원소 하나하나를 깊게 검사하지 마라(기존 코드도 `Array.isArray`까지만 본다).
- 파일이 없으면 `undefined`, 형태가 깨졌으면 `WorkflowArtifactError` — 기존 `readJsonArtifact`의 계약 그대로다.

### (b) `src/workflow/prerequisites.ts` 확장

```ts
export function authoringState(runId: string, root?: string): StageState<AuthoringDraftedArtifact>;
export function verifyState(runId: string, root?: string): StageState<VerifyVerifiedArtifact>;
export function applyState(runId: string, root?: string): StageState<AppliedArtifact>;
```

- 기존 `surveyState`와 **같은 3-상태 모델**을 따른다: 파일 부재 → `missing`, `status`가 성공값이 아님 → `failed`(status·detail 노출), 성공 → `succeeded`(아티팩트 노출).
- `applyState`는 상태를 **노출만** 한다. "이미 적용됐으니 거부한다"는 판정은 apply 명령의 로직이며 여기 넣지 마라(step 3).

### (c) `targetEligibility`를 공용 모듈로 이동

`src/services/workflow-store.ts`의 `targetEligibility`(절대경로 · 읽을 수 있는 `package.json` · git worktree 검사)를 `src/lib/engine/target.ts`로 옮기고 export한다. `workflow-store.ts`는 import해서 쓴다.

- **로직을 한 글자도 바꾸지 마라.** 순수한 이동이다. 반환 계약(`string | undefined` — 부적격 사유 또는 `undefined`)도 그대로다.
- 이유: CLI `verify`가 같은 판정을 해야 하는데, 웹의 인메모리 workflow 저장소 모듈을 CLI가 import하는 것은 표면 경계를 흐린다.

## Acceptance Criteria

```bash
npm run lint     # 통과
npm run build    # 컴파일 에러 없음
npm test         # 전체 통과
```

추가로 아래가 존재하고 통과해야 한다:

```bash
npx vitest run src/workflow/artifacts.test.ts src/workflow/prerequisites.test.ts src/services/workflow-store.test.ts
```

새로 덮어야 할 것:

- 네 산출물의 쓰기→읽기 왕복이 값을 보존한다.
- 형태가 깨진 JSON은 `WorkflowArtifactError`, 파일 부재는 `undefined`.
- `verifyState`가 3-상태를 가른다 — 파일 부재 / `status: "gate-error"` 같은 실패 / `status: "verified"`.
- `writeRunLog`가 임시 파일을 `runs/<id>/logs/`로 복사하고 **원본을 남긴다.**
- `targetEligibility` 이동 후에도 웹 경로의 기존 판정이 그대로다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/5-workflow-apply/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`cli.ts`·`bin/uptake.ts`를 건드리지 마라. 이유:** 이 step은 저장 층만 만든다. 명령 배포는 step 2·3이며, CLI가 아직 `verify`·`apply`라는 이름을 알아서는 안 된다(ARCHITECTURE '미구현 단계의 표현').
- **`generated.json` 존재 여부를 성공 판별자로 삼는 코드를 만들지 마라. 이유:** 판정은 상태 파일의 `status` 하나로 끝나야 한다. 두 파일에 걸치면 "`status`는 성공인데 파일이 없다"는 상태가 생겨 선행조건 검사가 무엇을 믿을지 정할 수 없게 된다.
- **산출물에 해시나 fingerprint로 편집을 탐지하는 장치를 넣지 마라. 이유:** ADR-025는 "누가 고쳤는가"가 아니라 "지금 이 내용이 게이트를 통과하는가"를 묻기로 결정했다. 검증·적용 산출물의 해시 3종은 그것과 별개의 장치(무엇에 동의했는지의 고정)이며 step 2·3이 다룬다.
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
