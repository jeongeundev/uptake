# Step 6: gate-runner

## 읽어야 할 파일

먼저 아래 파일들을 읽어라. 이 step은 게이트 실행의 **저수준 계약**이다 — "red는 exit code가 아니다"를 물질화하는 곳이다:

- `/docs/ARCHITECTURE.md` — 「게이트 결과 판별 — "red"의 정의」·「신뢰 경계」·「VERIFY 실행 계약」의 **"실행 형태"·"출력은 보존하고 표시는 제한한다"** 부분·「구현 중 결정」표의 **"환경변수 허용 목록"·"timeout 기본값·출력 인코딩·cleanup 실패 처리"** 행. 이 step이 실행기 관련 행들을 확정한다.
- `/docs/PRD.md` — **AC-7b**(인프라 오류는 음성 성공이 아니다)·**AC-12**(고정 argv).
- `/docs/ADR.md` — ADR-008(성공 위장 금지).
- `/AGENTS.md` — "게이트의 red는 exit code가 아니다 — 리포터 출력에서 `oracle.gateTestId` 테스트가 실패한 것만 red다"·"리포터를 못 만든 실행은 `gate-error`이며 음성 성공으로 계산하지 않는다".
- 이전 step 산출물: `vitest.config.ts`·`package.json`(step 0 — uptake 자체 vitest 의존성).

## 배경 — 이 step의 경계

게이트 실행기는 **워크스페이스 하나에서 게이트를 한 번 돌리고 결과를 구조화해 반환**하는 저수준 실행기다. 다음 step(verify-orchestrator)이 이걸 양성·음성 두 번 호출하며 워크스페이스 라이프사이클과 판정을 오케스트레이션한다.

**중요: 이 실행기는 "어느 테스트가 게이트 테스트인지"(oracle.gateTestId)를 모른다.** 실행기는 리포터가 **나왔는지(`ran`) 안 나왔는지(`error`)**만 판정하고, 나왔으면 **테스트별 결과 전체**를 반환한다. gateTestId로 pass/fail을 해석하는 것은 다음 step의 몫이다. 이 관심사 분리가 자기채점을 원천 차단한다 — 실행기는 자기가 통과시킬 오라클을 알 수 없다(ADR-008).

## 작업

`src/services/gate-runner.ts`:
```ts
type GateOutcome =
  | { kind: "ran"; perTest: Record<string, "passed" | "failed">; logPath: string }
  | { kind: "error"; detail: string; logPath: string }; // 리포터 미산출

// 고정 argv로만 실행한다. shell 문자열 조합 금지.
// cwd=워크스페이스로 한정. timeout 필수. 환경변수 상속 최소화(허용 목록).
function runGate(argv: string[], cwd: string, timeoutMs: number): Promise<GateOutcome>;
```

### "ran" vs "error" 판정 (CRITICAL — 어기면 성공 위장)

- 게이트는 **vitest를 JSON reporter로** 실행하고, **리포터 출력을 파싱**해 판정한다. **exit code로 판정하지 마라.**
- **`ran`**: 리포터가 정상 산출·파싱됨. `perTest`에 리포터가 보고한 **모든 테스트의 id → "passed"|"failed"**를 담는다.
- **`error`**: 리포터가 산출·파싱되지 않음 — spawn 실패, 모듈 설치 실패, 설정·문법 오류, timeout, signal 종료, JSON 파싱 불가. 이 경우 **절대 `ran`인 척하지 마라.** `perTest`를 지어내지 마라.
- 이유: 리포터를 못 만든 실행을 "테스트가 실패했다(red)"로 세면, 위반을 못 잡았는데 잡았다고 보고하는 성공 위장이 성립한다. 이것이 이 프로젝트에서 가장 위험한 버그다(AC-7b·AGENTS.md).

### 실행 형태 (신뢰 경계 — 최소 계약)

- **고정 argv로만 실행.** `argv`는 호출자가 넘긴 배열을 그대로 쓴다. **shell 문자열을 조합하지 마라**(`spawn`을 shell 없이).
- `cwd`는 넘어온 워크스페이스로 한정한다.
- **timeout 필수.** 초과 시 프로세스를 종료하고 `error`(호출자가 timeout으로 승격할 수 있도록 detail에 timeout임을 명시).
- **환경변수 상속 최소화** — 허용 목록(PATH 등 게이트 실행에 꼭 필요한 것)만 넘긴다. 이 목록을 이 step에서 확정한다.
- vitest 바이너리는 **uptake 자체 의존성**의 것을 쓸 수 있다(타깃 워크스페이스에 install 불필요). 정확한 실행 방식은 재량이되 위 계약은 지켜라.

### 출력 보존 (정직성)

- stdout/stderr **전문**을 임시 로그 파일에 남기고 `logPath`를 반환한다. `error`일 때도 로그를 남긴다 — 무엇이 깨졌는지 원문 접근이 가능해야 한다(ARCHITECTURE).

### 유예 항목 확정 (이 step에서 결정)

`/docs/ARCHITECTURE.md`「구현 중 결정」표의 **"환경변수 허용 목록"·"timeout 기본값·출력 인코딩·cleanup 실패 처리"**를 코드로 확정하고 summary에 명시한다(docs는 수정하지 마라). **워크스페이스 복제 범위·cleanup은 이 step이 아니라 step 7(verify-orchestrator)에서** 정한다 — 실행기는 워크스페이스를 만들지 않는다.

### 테스트 (AC를 테스트로)

임시 워크스페이스 fixture를 코드에서 만들어 runGate를 검증한다 (uptake 자체 vitest로 실행):
- **정상 실행**: 통과 테스트 1개 + 실패 테스트 1개를 담은 워크스페이스 → `ran`, `perTest`에 각각 `"passed"`/`"failed"`, 두 테스트 id가 모두 존재.
- **AC-7b (핵심)**: 리포터를 못 만드는 케이스가 **`error`로 정직히 판정**되는지 — (a) 문법 오류가 있는 테스트 파일, (b) 존재하지 않는/깨진 vitest 설정, (c) 무한 루프로 timeout. **셋 다 `error`이며 `ran`으로 위장되지 않아야 한다.**
- **AC-12**: `runGate`가 넘겨받은 argv를 **shell 없이 고정 인자로** 실행하는지 (예: argv에 shell 메타문자가 들어와도 그것이 셸에서 해석되지 않음을 검사).
- `logPath`에 stdout/stderr 전문이 남는지.

## Acceptance Criteria

```bash
npm run build
npm run test    # gate-runner 테스트 (ran/error 판정, AC-7b·AC-12)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **exit code가 아니라 리포터 파싱**으로 ran/error를 판정하는가?
   - 리포터 미산출을 **`error`로 정직히** 반환하고 `perTest`를 지어내지 않는가(AC-7b)?
   - 실행기가 gateTestId를 **모르는가**(관심사 분리)?
   - 고정 argv·shell 금지·cwd 한정·timeout·env 최소화가 지켜지는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/services/gate-runner.ts — runGate(argv, cwd, timeoutMs): GateOutcome. vitest JSON reporter 파싱으로 ran(perTest 전체)/error(리포터 미산출) 판정, exit code 아님. 고정argv·shell없음·cwd한정·timeout·env허용목록·로그전문보존. gateTestId 미인지(step7이 해석). AC-7b/AC-12 테스트 통과. env목록=<확정>, timeout기본=<확정>"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **exit code로 게이트 결과를 판정하지 마라.** 이유: 설치·설정·문법 오류·OOM·signal도 non-zero다. 리포터 출력으로만 판정한다(ARCHITECTURE).
- **리포터가 없는데 `perTest`를 지어내거나 `ran`으로 반환하지 마라.** 이유: 인프라 오류를 테스트 실패로 위장하는 것이 성공 위장의 가장 위험한 형태다(AC-7b). 리포터 미산출은 정직하게 `error`다.
- **gateTestId·오라클로 pass/fail을 판정하지 마라.** 이유: 그것은 다음 step의 책임이다. 실행기가 오라클을 알면 자기채점 여지가 생긴다. 실행기는 전체 `perTest`만 반환한다.
- **shell 문자열로 실행하지 마라.** 이유: 고정 argv·cwd 한정·timeout이 신뢰 경계의 최소 계약이다.
- **워크스페이스를 만들거나 삭제하지 마라.** 이유: 라이프사이클은 step 7의 몫이다. 실행기는 주어진 `cwd`에서 실행만 한다.
- 기존 테스트를 깨뜨리지 마라.
