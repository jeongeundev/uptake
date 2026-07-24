# Step 0: verify-contract

## 읽어야 할 파일

먼저 아래 파일들을 **꼼꼼히** 읽어라. 이 step은 이미 구현된 VERIFY의 두 계약 결함을 고친다:

- `/docs/ARCHITECTURE.md` — 「VERIFY 실행 계약」의 **"argv의 출처와 동결"**(`결합점 확정 → 생성물 확정 → argv 동결 → 실행 개시 화면에 표시 → 실행`)·「게이트 결과 판별」의 상태 표(`gate-error`·`timeout`의 정의).
- `/docs/PRD.md` — **AC-7b**(인프라 오류는 음성 성공이 아니다)·**AC-12**(실행되는 게이트 커맨드는 개시 전 표시된 것과 동일).
- `/AGENTS.md` — "게이트의 red는 exit code가 아니다"·"인프라 오류를 위반 잡았다로 세는 것이 성공 위장의 가장 위험한 형태".
- 기존 구현: `src/lib/engine/verify.ts`(수정 대상), `src/lib/engine/verify.test.ts`(갱신 대상), `src/services/gate-runner.ts`(`runGate`·`GateOutcome`, 수정하지 마라), `src/lib/engine/instantiate.ts`(`InstantiateResult`), `src/lib/engine/detect.ts`(`BindingDetection`).

## 배경 — 고쳐야 할 두 결함 (코드 리뷰에서 확인됨)

**결함 A (양성 error taxonomy 오분류).** 현재 `verify.ts`는 양성 실행이 `runGate`에서 `kind: "error"`(리포터 미산출 — 설정·문법 오류·spawn 실패·timeout·signal)를 반환해도 무조건 `positive-failed`로 분류한다. 음성 경로에는 `errorStatus()`로 `gate-error`/`timeout`을 구분하면서 **양성 경로에는 적용하지 않았다.** 이는 "인프라 오류를 게이트 판정으로 오분류"이며 AC-7b 위반이다. `positive-failed`는 "준수 상태인데 게이트가 green이 아님"을 뜻하는데, 리포터를 못 만든 실행은 그 의미가 아니다.

현재의 문제 분기:
```ts
if (positive.kind !== "ran" || positive.perTest[gateTestId] !== "passed") {
  return { status: "positive-failed", detail: ..., frozenArgv };  // ← error/timeout이어도 이것
}
```

**결함 B (argv를 실행 전에 공개할 수 없는 구조).** 현재 `verify()`는 내부에서 argv를 동결하자마자 `runGate`를 두 번 호출하고, **실행이 다 끝난 뒤** 결과로 `frozenArgv`를 반환한다. 그래서 사용자는 실행 전에 argv를 볼 수 없다 — `verify()` 호출 자체가 곧 미공개 실행이다. ARCHITECTURE.md와 AC-12가 요구하는 "argv 동결 → **표시** → 실행" 순서를 API 구조가 강제하지 못한다.

## 작업

### 1. `verify()`를 `prepareVerification()` / `executeVerification()` 두 단계로 분리 (결함 B)

argv 공개를 실행과 분리한다. UI가 prepare 결과의 argv를 화면에 표시하고, 사용자가 실행을 누르면 execute를 호출하는 구조를 API로 강제한다.

```ts
type PreparedVerification = {
  status: "prepared";
  frozenArgv: string[];        // 실행 전에 공개되는 값 — 표시용
  generated: Generated;        // step 5 ok 결과
  gateTestId: string;
  bindings: BindingDetection[];
  targetRepoRoot: string;
};
type PrepareRejected = {
  status: "positive-failed";   // argv 결속 실패·gateTestId 불일치 등 실행 이전 거부
  detail: string;
};

// 결합점·생성물에서 argv를 동결만 한다. 워크스페이스를 만들거나 runGate를 호출하지 않는다.
function prepareVerification(
  pattern: Pattern, generated: Generated,
  bindings: BindingDetection[], targetRepoRoot: string
): PreparedVerification | PrepareRejected;

// 이미 동결·공개된 argv로만 실제 검증을 실행한다.
function executeVerification(prepared: PreparedVerification): Promise<VerifyOutcome>;
```

- `prepareVerification`은 **실행하지 않는다.** freezeArgv·gateTestId 일치 검사만 하고 `frozenArgv`를 담아 반환한다. 여기서 argv가 확정·공개된다.
- `executeVerification`은 `prepared.frozenArgv`로 W_pos/W_neg를 실행한다. **실행 직전에 `prepared.generated`·`prepared.bindings`로 argv를 재계산해 `prepared.frozenArgv`와 동일한지 확인하고, 다르면 실행하지 말고 거부한다**(AC-12: "표시되지 않은 argv로 실행하는 경로는 없다"). 동결 이후 생성물·결합점이 바뀌면 표시된 argv와 달라지므로 이 재확인이 그 경로를 막는다.
- 기존 `verify()`는 **제거한다.** 이유: monolithic `verify()`는 호출 자체가 미공개 실행이라 계약 위반이다. 소비자(테스트)는 prepare→execute로 옮긴다. 편의 합성 함수를 남기지 마라 — 남기면 미공개 실행 경로가 다시 열린다.

### 2. 양성 error taxonomy 수정 (결함 A)

양성 실행 결과 판정을 **음성과 동일한 원칙**으로 고친다:
- 양성이 `runGate`에서 `kind: "error"` → 기존 `errorStatus()`를 그대로 적용해 **`gate-error` 또는 `timeout`**. `positive-failed`가 아니다.
- 양성이 `ran`인데 `perTest[gateTestId] !== "passed"` → `positive-failed` (이건 유지 — 준수 상태인데 게이트가 통과 안 함).
- 즉 "리포터를 못 만든 실행"과 "리포터는 나왔으나 게이트 테스트가 통과 못 함"을 **양성에서도** 구분한다.

`errorStatus()`는 이미 있으니 재사용하라. 음성 판정 로직·`negative-not-caught`·`injection-failed`·타깃 불변·워크스페이스 폐기는 **그대로 유지**한다(건드리지 마라).

### 3. 테스트 갱신·추가 (`verify.test.ts`)

기존 테스트를 새 API(prepare/execute)로 옮기고, 아래를 **추가**한다:
- **결함 A 회귀**: 양성 `runGate`가 `{ kind:"error", detail:"timeout after 30000ms" }` → 결과 `status: "timeout"`. 양성 error(비-timeout) → `status: "gate-error"`. (현재는 둘 다 `positive-failed`가 되므로 이 테스트가 결함을 잡아야 한다.)
- **결함 B / AC-12**: `prepareVerification`이 실행 없이 `frozenArgv`를 반환하는지. 그리고 `executeVerification`에 **생성물이 바뀌어 argv가 달라진 prepared**를 주면 실행을 거부하는지(표시되지 않은 argv 실행 차단).
- 기존 유지 확인: 양성 pass + 음성 fail → `awaiting-approval`, 음성 green → `negative-not-caught`, 음성 error → `gate-error`.

`runGate` mock은 이 step에서 계속 써도 된다(상태 머신 단위 검증). **실제 통합은 step 1에서 mock 없이** 한다.

## Acceptance Criteria

```bash
npm run build
npm run test    # verify.test.ts 전부 (신규 양성 error/timeout·argv 공개 테스트 포함)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 양성 `error`가 **`gate-error`/`timeout`**으로 분류되는가(더 이상 `positive-failed` 아님)?
   - `prepareVerification`이 **실행 없이** argv를 반환하는가?
   - `executeVerification`이 **표시된(prepared) argv와 다른 실제 argv**로 실행하는 경로를 거부하는가?
   - monolithic `verify()`가 제거됐는가?
3. 결과에 따라 `phases/0-fix/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "verify.ts — verify()를 prepareVerification()/executeVerification()로 분리(argv 실행 전 공개, AC-12 재확인). 양성 error/timeout을 gate-error/timeout으로 분류(Major1/AC-7b). verify.test.ts 갱신+양성error·argv공개 회귀 테스트"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **양성 `error`를 `positive-failed`로 두지 마라.** 이유: 리포터를 못 만든 실행은 "게이트가 green이 아님"이 아니라 인프라 오류다. 뭉개면 AC-7b 위반(성공 위장의 사촌).
- **monolithic `verify()`를 남기거나 되살리지 마라.** 이유: 호출 자체가 미공개 실행이라 AC-12 계약을 구조적으로 깬다.
- **`executeVerification`이 argv를 새로 만들어 실행하지 마라.** 이유: 표시된 것과 실행하는 것이 달라질 수 있다. prepared의 argv로만 실행하고, 재계산은 **동일성 확인용**으로만 쓴다.
- **`gate-runner.ts`·음성 판정·`negative-not-caught`·injection 로직을 바꾸지 마라.** 이유: 이번 step 범위는 양성 taxonomy와 prepare/execute 분리뿐이다. 정상 동작하는 부분을 건드리지 마라.
- 기존 테스트를 깨뜨리지 마라(새 API로 갱신하는 것은 허용).
