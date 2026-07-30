# Step 0: engine-cli-readiness

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 전부
- `/docs/ARCHITECTURE.md` — 특히 '워크플로우 산출물 계약', 'verify → apply 결속 (phase 5)'의 해시 3종 표, '승인 경계 (phase 5)', '자산 경로 계약 (ADR-024)'
- `/docs/ADR.md` — ADR-008(양성/음성·gate-error), ADR-022(승인 경계는 호출자 책임), ADR-024(자산 경로 계약)
- `/docs/PRD.md` — 'Phase 5 범위'
- `/src/lib/engine/apply.ts` — 이번 step이 순수화할 대상
- `/src/lib/engine/verify.ts` — `hashGenerated`·`vitestBin`·`VerifyOutcome`
- `/src/lib/engine/instantiate.ts`, `/src/lib/engine/detect.ts` — `GeneratedFile`·`BindingDetection` 타입
- `/src/services/approval-store.ts`, `/src/services/workflow-store.ts` — 웹 표면의 호출자
- `/src/services/gate-runner.ts` — `GateOutcome.logPath`가 어디서 오는지
- `/src/lib/engine/apply.test.ts`, `/src/lib/engine/verify.test.ts`, `/src/services/approval-store.test.ts`, `/src/services/workflow-store.test.ts`, `/src/__tests__/pipeline.integration.test.ts` — 이번 변경으로 갱신될 기존 테스트

기존 코드의 설계 의도를 이해한 뒤 작업하라.

## 배경

phase 5는 CLI에 `uptake verify` · `uptake apply`를 붙인다. 그 전에 **엔진이 웹 표면에 매여 있는 지점 세 곳**을 끊는 것이 이 step이다. 세 변경 모두 `verify.ts`·`apply.ts` 한 쌍에 국한되며 서로 독립적이다.

## 작업

### (a) `applyGenerated` 순수화 + `bindingsHash` (ADR-022)

`applyGenerated`가 인메모리 승인 저장소(`consumeApproved`)를 직접 소비하는 결합을 끊는다. 엔진은 **저장 방식 어휘(`pending`/`approved`/`consumed`)를 몰라야 한다.**

`src/lib/engine/apply.ts`:

```ts
export type ApprovalInput = {
  patternId: string;
  targetRepoRoot: string;
  contentHash: string;
  bindingsHash: string;
  targetBaseHash: string;
  frozenArgv: string[];
};

export type ApplyResult =
  | { status: "completed"; written: string[] }
  | {
      status:
        | "diff-mismatch"
        | "bindings-mismatch"
        | "base-changed"
        | "apply-failed";
      detail: string;
    };

export function applyGenerated(
  approval: ApprovalInput,
  files: GeneratedFile[],
  bindings: BindingDetection[],
  targetRepoRoot: string,
): ApplyResult;
```

규칙:

- `consumeApproved` import를 제거하고 `not-approved`·`unknown-approval` 상태를 `ApplyResult`에서 없앤다. 그 둘은 저장 방식의 어휘이며 **호출자 책임**이다.
- 대조는 셋을 **각각 다른 status로** 구분한다. `contentHash` 불일치(또는 `targetRepoRoot` 불일치) → `diff-mismatch`, `bindingsHash` 불일치 → `bindings-mismatch`, `targetBaseHash` 불일치 → `base-changed`. 뭉치지 마라 — 무엇이 바뀌었는지 정확한 이름으로 실패하는 것이 이 해시들을 셋으로 나눈 이유다(ARCHITECTURE 해시 표).
- 파일 쓰기 로직(경로 격리 `inside`, 신규 파일만 허용, 중복 목적지 거부, 실패 시 롤백)은 **한 글자도 바꾸지 마라.** 이번 변경은 승인 입력의 출처만 바꾸는 것이다.

`src/lib/engine/verify.ts`에 `hashGenerated` 옆에 추가:

```ts
export function hashBindings(bindings: BindingDetection[]): string;
```

규칙:

- `bindingId`로 정렬한 뒤 각 항목의 `bindingId` · `kind` · `status` · `value`(`binding-unresolved`이면 빈 문자열)를 넣는다. `hashGenerated`와 **같은 방식으로 각 값 앞에 바이트 길이를 넣어** 구분자 주입으로 서로 다른 입력이 같은 해시를 내는 것을 막아라.
- `evidence`(탐지 근거 경로)는 해시에 넣지 마라. 이유: 승인의 대상은 "어떤 값으로 이식하는가"이지 그 값을 어디서 탐지했는지가 아니다.
- `bindingsHash`가 `contentHash`로 대체되지 않는 이유를 코드 주석에 남겨라 — 현재 `instantiate`는 바인딩 중 `checker`만 읽으므로 `spec-format`·`naming`을 바꿔도 생성물이 한 바이트도 변하지 않는다.

### (b) vitest 바이너리를 설치 위치 기준으로 해석 (ADR-024)

`src/lib/engine/verify.ts:71`의

```ts
const vitestBin = resolve("node_modules/vitest/vitest.mjs");
```

는 `process.cwd()` 기준이다. 게이트가 실행하는 vitest는 **uptake 동봉 자산**이며(검증 워크스페이스는 타깃의 tracked 파일만 복사하므로 `node_modules`가 없다), CLI가 사용자 프로젝트 디렉터리에서 돌면 이 경로는 존재하지 않아 **모든 검증이 `gate-error`가 된다.** ADR-024가 "적용은 그 자산을 실제로 읽는 코드 경로가 생길 때 한다"고 유예해 둔 자산이고, 그 경로를 만드는 것이 phase 5의 `verify`다.

```ts
import { createRequire } from "node:module";

// 게이트가 실행하는 vitest는 uptake 동봉 자산이므로 설치 위치에서 해석한다.
// cwd 기준으로 풀면 CLI가 사용자 저장소에서 도는 순간 없는 경로가 된다(ADR-024).
export const vitestBin = createRequire(import.meta.url).resolve(
  "vitest/vitest.mjs",
);
```

- 이 subpath가 vitest의 `exports`(`"./*"`)로 해석되는 것은 실측으로 확인됐다. 다른 방식(`resolve("vitest/package.json")` 후 조립 등)으로 바꾸지 마라.
- `vitestBin`을 export하는 이유는 테스트가 경로 계약을 검사하기 위해서다. 테스트는 (1) 그 경로의 파일이 실제로 존재하고 (2) uptake 설치 위치(이 저장소 루트) 아래임을 확인한다. **cwd 독립성의 실제 증명은 step 4의 통합 테스트**(저장소 밖 cwd에서 별개 프로세스로 `verify` 실행)가 한다 — 여기서 `process.chdir`로 흉내내지 마라(모듈 상수는 최초 import 시점에 고정되므로 그 테스트는 아무것도 증명하지 못한다).

### (c) `VerifyOutcome` 실패 분기에 로그 경로 노출

ARCHITECTURE '워크플로우 산출물 계약'은 **"로그 파일은 항상 남긴다 — `gate-error`·`timeout`의 원인은 리포터 출력에만 있고, 그것이 사라지면 인프라 오류와 진짜 red를 구별할 수 없다"**고 못박는다. 그런데 지금 `executeVerification`의 실패 분기는 `detail`과 `frozenArgv`만 싣고 `logPath`를 버린다 — CLI가 로그를 산출물로 남길 방법이 없다.

`VerifyOutcome`의 실패 분기에 선택적 로그 경로를 추가한다:

```ts
| {
    status:
      | "positive-failed"
      | "injection-failed"
      | "gate-error"
      | "negative-not-caught"
      | "timeout";
    detail: string;
    frozenArgv?: string[];
    positiveLog?: string;
    negativeLog?: string;
  };
```

규칙:

- 게이트를 **실제로 돌린** 분기는 그 시점까지 얻은 `logPath`를 싣는다(양성만 돌고 실패했으면 `positiveLog`만, 음성까지 갔으면 둘 다).
- 게이트를 돌리기 **전에** 끝난 실패(argv 재계산 불일치, `prepareVerification` 거부)는 로그가 없고 그것이 정상이다 — 빈 문자열이나 가짜 경로를 만들어 넣지 마라.
- 성공 분기(`awaiting-approval`)의 기존 필드 이름(`positiveLog`·`negativeLog`)을 바꾸지 마라. 웹 라우트가 쓴다.

### (d) 웹 배선 흡수

(a)로 시그니처가 바뀌므로 웹 호출자를 고친다. **최소 수정만 하라 — 웹의 동작과 응답 형태를 바꾸는 것은 이번 범위가 아니다.**

- `src/services/approval-store.ts`: `StoredApproval`에 `bindingsHash: string`를 추가한다. 저장소 자체(`pending`/`approved`/`consumed` 상태 기계)는 그대로 둔다 — 그것은 웹 표면의 관심사로 **남는 것이 옳다**(ADR-022).
- `src/services/workflow-store.ts`:
  - `executeWorkflow`가 `createApproval`에 `bindingsHash: hashBindings(workflow.bindings)`를 실어 준다.
  - `applyWorkflow`가 **직접** `consumeApproved(verificationId)`를 호출하고, 실패하면 기존과 같은 `WorkflowError`를 반환한다. 성공하면 소비한 레코드를 `ApprovalInput`으로 조립해 `applyGenerated(approval, files, bindings, targetRepoRoot)`를 부른다. **일회성 소비 봉인이 호출자로 내려온 것이 이 변경의 핵심이다.**
  - 기존 API 응답의 status 문자열을 바꾸지 마라. 라우트 테스트·E2E가 기대하는 문자열이 있으면 그대로 유지한다 — 바꿔야 할 것 같으면 먼저 그 테스트가 무엇을 보호하는지 읽어라.

### (e) 문서 갱신

`docs/ARCHITECTURE.md`의 '자산 경로 계약 (ADR-024)' 절, 자산별 적용 시점 표에 **vitest 바이너리** 행을 추가한다 — "phase 5가 읽는가: 예(`verify`의 게이트 실행) / 해법: 설치 위치 해석(`createRequire`)". 그 표는 "같은 계약을 따르는 자산과 아직 cwd에 매인 자산이 공존하므로 그 목록을 문서가 관리한다"는 ADR-024의 요구를 이행하는 곳이다.

문서 수정은 **이 한 곳뿐이다.** PRD·ADR·AGENTS.md를 고치지 마라.

## Acceptance Criteria

```bash
npm run lint     # 통과
npm run build    # 컴파일 에러 없음
npm test         # 전체 통과 (기존 테스트 갱신 포함)
```

추가로 아래 테스트가 실제로 존재하고 통과해야 한다:

```bash
npx vitest run src/lib/engine/apply.test.ts src/lib/engine/verify.test.ts src/services/approval-store.test.ts src/services/workflow-store.test.ts src/__tests__/pipeline.integration.test.ts
```

새로 덮어야 할 것:

- `applyGenerated`가 `bindingsHash` 불일치를 `bindings-mismatch`로 거부한다 — **생성물이 한 바이트도 같은 상태에서** 바인딩만 바꿔 거부되는 케이스여야 한다(그렇지 않으면 `contentHash`가 잡은 것과 구분되지 않아 이 해시를 추가한 이유를 검증하지 못한다).
- `applyGenerated`가 저장소 어휘 없이 동작한다 — `ApprovalInput`만으로 성공/거부가 갈린다.
- `hashBindings`가 순서에 무관하고, 값이 다르면 다른 해시를 낸다.
- `vitestBin`이 실재하는 파일이며 이 저장소 루트 아래다.
- `executeVerification`의 게이트 실패 분기가 로그 경로를 싣는다(최소 `negative-not-caught` 또는 `gate-error` 1건).

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

- **`hashTargetBase`를 고치지 마라. 이유:** `.git`만 제외하고 타깃 트리 전부를 읽는 것이 실사용에서 문제가 될 수 있음은 이미 파악돼 있고, phase 5의 명시적 비범위다. 성능 개선은 해시 대상이 바뀌는 변경이라 별도 결정이 필요하다.
- **승인 저장소(`approval-store.ts`)를 없애거나 파일 기반으로 바꾸지 마라. 이유:** 그것은 웹 표면의 관심사로 남는 것이 ADR-022의 결정이다. CLI는 자기 산출물로 따로 조립한다(step 3).
- **엔진에 파일 경로·산출물 개념을 넣지 마라. 이유:** `verify.ts`·`apply.ts`는 인자만 받는 순수 함수여야 두 표면이 같은 판정을 받는다. `.uptake/` 경로를 엔진이 알면 안 된다.
- **`ApplyResult`에 `not-approved`·`unknown-approval`을 남겨두지 마라. 이유:** 저장 방식 어휘를 엔진에서 제거하는 것이 이 step의 목적이며, 남겨두면 다음 표면이 다시 그 어휘에 맞춰 가짜 승인을 조립하게 된다.
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
