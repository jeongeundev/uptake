# Step 7: verify-orchestrator

## 읽어야 할 파일

먼저 아래 파일들을 **꼼꼼히** 읽어라. 이 step은 프로젝트의 정직성(성공 위장 방지)이 걸린 핵심 오케스트레이션이다:

- `/docs/ARCHITECTURE.md` — 「VERIFY 실행 계약」 전체·「게이트 결과 판별」의 판정 규칙·상태 표·「위반 삽입 계약」·「구현 중 결정」표의 **"워크스페이스 복제 범위"** 행. 이 step이 그 행을 확정한다.
- `/docs/PRD.md` — **AC-5·AC-6·AC-7·AC-7b·AC-8·AC-12**. 이 step이 이 기준들을 테스트로 구현한다.
- `/docs/ADR.md` — ADR-008(양성+음성 판별 오라클, 성공 위장 금지).
- `/AGENTS.md` — "red는 exit code가 아니다"·"인프라 오류를 위반 잡았다로 세는 것이 성공 위장의 가장 위험한 형태".
- 이전 step 산출물: `src/types/pattern.ts`, `src/lib/engine/instantiate.ts`(`GeneratedFile[]`·`InstantiatedInjection`·`gateTestId`), `src/lib/engine/detect.ts`(`BindingDetection`), **`src/services/gate-runner.ts`(`runGate`·`GateOutcome`)**, step 4 fixture 타깃 경로(index.json 참고).

## 배경 — 이 step의 경계

step 6의 `runGate`는 워크스페이스 하나에서 게이트를 돌리고 `{ kind: "ran", perTest } | { kind: "error" }`를 반환하는 저수준 실행기다. **이 step은 그 실행기를 양성·음성 두 번 호출하며, 워크스페이스 라이프사이클·injection·판정·상태 매핑을 오케스트레이션한다.** `runGate`가 모르는 `oracle.gateTestId`를 여기서 해석한다.

## 작업

`src/lib/engine/verify.ts`:
```ts
type VerifyOutcome =
  | { status: "awaiting-approval"; contentHash: string; frozenArgv: string[];
      positiveLog: string; negativeLog: string }
  | { status: "positive-failed" | "injection-failed" | "gate-error"
            | "negative-not-caught" | "timeout"; detail: string; frozenArgv?: string[] };

function verify(
  pattern: Pattern,
  generated: /* step 5의 ok 결과: files·injection·gateTestId */,
  bindings: BindingDetection[],
  targetRepoRoot: string
): Promise<VerifyOutcome>;

function hashGenerated(files: GeneratedFile[]): string; // 산출물 내용 해시 (step 8이 재사용)
```

### 실행 계약 (ARCHITECTURE「VERIFY 실행 계약」 그대로)

```
타깃 repo (읽기 전용)
  → W_pos 생성        임시 워크스페이스에 타깃 tracked 파일 복제
  → 생성물 적용        W_pos 에만 (step 5의 GeneratedFile[])
  → argv 동결·표시     checker·gate-location 결합점에서 argv 확정 → frozenArgv
  → 양성 실행          runGate(frozenArgv, W_pos, timeout)
  → W_neg 생성        W_pos 를 복제한 별도 워크스페이스
  → 위반 삽입          InstantiatedInjection → W_neg 에만
  → 음성 실행          runGate(frozenArgv, W_neg, timeout)
  → 워크스페이스 폐기   W_pos · W_neg 통째로 삭제
  → 해시·판정          hashGenerated → awaiting-approval (판정 통과 시)
```

### gateTestId 해석 & 판정 (CRITICAL)

`runGate` 결과를 받아 `pattern.oracle.gateTestId`로 해석한다:

- **양성 성공** = 양성이 `ran` **이고** `perTest[gateTestId] === "passed"`. 아니면 → `positive-failed`.
- **음성 성공** = 음성이 `ran` **이고** `perTest[gateTestId] === "failed"` **이면서**, 그 테스트가 *양성에서는 `passed`였을 것*. **양성·음성의 `perTest`를 대조**해 확인한다 — 무관한 테스트가 실패해 생긴 것이 아님을 보장(ARCHITECTURE).
- 음성이 `error` → **`gate-error`** (timeout이면 `timeout`). **절대 음성 성공으로 계산하지 마라**(AC-7b). `runGate`가 정직하게 `error`를 준 것을 여기서 `fail`로 둔갑시키면 안 된다.
- 음성이 `ran`인데 `perTest[gateTestId] === "passed"` (위반을 못 잡음, green) → **`negative-not-caught`**. 일반 실패와 의미가 반대다(green이라서 실패). 이름에 "failed"를 쓰지 않는다(AC-8).
- 양성 성공 + 음성 성공 → `awaiting-approval`.

### argv 동결·사전 공개 (AC-12)

- argv는 **`checker`·`gate-location` 결합점에서 결속**한다(사람이 타이핑하지 않음). 결합점 확정 → 생성물 확정 → **argv 동결(frozenArgv)** → `VerifyOutcome`에 담아 반환 → 실행.
- **양성·음성 두 실행 모두 동일한 frozenArgv**로 `runGate`를 호출한다. 표시된 argv와 실제 호출 argv가 달라지는 경로가 없어야 한다.

### 위반 삽입 (W_neg에만, 구조화된 치환)

`generated.injection`(`InstantiatedInjection`)을 W_neg에 적용한다:
- `path`는 정규화 후 **워크스페이스 루트 내부**여야 한다. `..`·절대경로·바깥을 가리키는 symlink는 거부(이 검사는 injection path에 한정).
- `marker`는 대상 파일에 **정확히 1회**. 0회·2회 이상이면 `injection-failed`(음성 검증 불가 = 이식 실패, 조용히 건너뛰지 마라).
- 치환은 **순수 문자열 연산**. `marker`/`replacement`를 코드로 평가하지 마라. 결정적.

### 타깃 불변 (AC-5)

- 타깃 repo는 **읽기 전용**이다. 복제·생성물 적용·injection은 전부 **임시 워크스페이스에만**. 타깃에 대한 쓰기는 이 step에 존재하지 않는다(쓰기는 step 8 apply에만).
- **위반은 삽입 후 롤백하지 마라.** W_neg에만 심고 워크스페이스를 통째로 버린다 — 롤백 실패 시 오염이 남는다(ARCHITECTURE).

### 유예 항목 확정 (이 step에서 결정)

`/docs/ARCHITECTURE.md`「구현 중 결정」표의 **"워크스페이스 복제 범위"**를 코드로 확정하고 summary에 명시(docs 수정 금지): 권장 — git tracked 파일만 복제(node_modules·ignored 제외). MVP 생성물은 self-contained하므로 **타깃 의존성 install을 하지 않고**, 게이트 vitest는 step 6이 확정한 대로 uptake 자체 의존성으로 실행한다. cleanup(W_pos·W_neg 삭제) 시점·실패 처리도 명시한다.

### 테스트 (AC를 테스트로 — 전부 필수)

step 4 fixture 타깃 + step 5 생성물을 써서:
- **AC-5**: `verify` 전후 타깃 repo 작업 트리 동일성(git status 무변화 + 파일 해시 동일). 타깃 쓰기 없음.
- **AC-6**: 준수 생성물 → 양성 `perTest[gateTestId]==="passed"` → `awaiting-approval`.
- **AC-7**: injection 적용 → 음성 `perTest[gateTestId]==="failed"`(양성과 대조 확인) → 음성 성공. + `injection-failed` 케이스(marker 0/2회).
- **AC-7b**: 음성 실행이 `error`(runGate가 error 반환 — 예: 워크스페이스에 깨진 설정)일 때 **`gate-error`로 보고되고 음성 성공으로 계산되지 않음**. timeout은 `timeout`.
- **AC-8**: 판별력 없는 게이트(음성에서도 gateTestId가 passed) → `negative-not-caught`.
- **AC-12**: 양성·음성이 **동일한 frozenArgv**로 `runGate`를 호출하고, 그 argv가 `VerifyOutcome`에 반환된 값과 같음.

`runGate`를 테스트에서 실물로 돌려도 되고(실제 vitest 실행), 결정성·속도를 위해 주입(mock)해도 된다 — 단 **AC-7b·AC-8은 runGate가 각각 `error`·`ran(passed)`를 반환하는 상황에서 verify의 매핑이 올바른지**를 반드시 검사하라.

## Acceptance Criteria

```bash
npm run build
npm run test    # verify 테스트 전부 (AC-5·6·7·7b·8·12)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `runGate`의 `error`를 절대 `fail`(음성 성공)로 세지 않는가(gate-error 분리, AC-7b)?
   - 음성 성공을 양성·음성 **perTest 대조**로 확인하는가?
   - 음성 green을 **negative-not-caught**로(일반 실패와 구별) 보고하는가(AC-8)?
   - 타깃 repo가 전 구간 **불변**인가(AC-5)?
   - 양성·음성이 **동일 frozenArgv**로 실행되고 그것이 반환되는가(AC-12)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 7을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/lib/engine/verify.ts — verify(pattern, generated, bindings, targetRoot): W_pos/W_neg 라이프사이클, runGate 2회 호출, gateTestId 해석(양성 passed·음성 failed 대조), error→gate-error/timeout(AC-7b), 음성 green→negative-not-caught(AC-8), injection 순수치환·marker 1회, argv 동결(AC-12), 타깃 불변(AC-5). hashGenerated 유틸(step8 재사용). 워크스페이스=tracked만·install 없음"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`runGate`의 `error`를 음성 성공으로 계산하지 마라.** 이유: 리포터를 못 만든 실행은 판별이 아니다. `gate-error`로 중단하라(AC-7b). **이 규칙을 어기는 것이 이 프로젝트에서 가장 위험한 버그다.**
- **음성 green을 그냥 통과로 처리하지 마라.** 이유: 위반을 못 잡은 것이므로 `negative-not-caught` = 이식 실패다(AC-8).
- **타깃 repo에 쓰지 마라. 검증은 워크스페이스에서만.** 이유: AC-5. 쓰기는 step 8에만.
- **위반을 심었다가 롤백하지 마라.** 이유: 롤백 실패 시 오염이 남는다. W_neg에만 심고 통째로 버린다.
- **양성과 음성을 다른 argv로 실행하지 마라.** 이유: 두 실행의 유일한 차이는 injection이어야 판별이 성립한다. argv가 다르면 대조가 무의미하다(AC-12).
- 기존 테스트를 깨뜨리지 마라.
