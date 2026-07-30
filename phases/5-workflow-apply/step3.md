# Step 3: cli-apply

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 전부, 특히 "엔진은 승인의 저장 방식을 몰라야 한다"
- `/docs/ARCHITECTURE.md` — 'verify → apply 결속 (phase 5)'의 해시 3종 표, **'승인 경계 (phase 5)'**, '워크플로우 산출물 계약'의 종료 코드
- `/docs/ADR.md` — ADR-010(human-in-the-loop), ADR-022(승인 경계는 호출자 책임 / 대화형 · TTY 아니면 실패), ADR-020(산출물 릴레이)
- `/docs/PRD.md` — 'Phase 5 범위'의 "승인은 대화형 한 프로세스 안에서" · "재적용 차단"
- `/src/workflow/steps/verify.ts` — 이전 step이 만든 명령. 어떤 산출물을 어떤 필드로 남기는지
- `/src/workflow/artifacts.ts`, `/src/workflow/prerequisites.ts`, `/src/workflow/paths.ts`
- `/src/workflow/cli.ts`, `/bin/uptake.ts`
- `/src/lib/engine/apply.ts` — step 0이 순수화한 `applyGenerated(approval, files, bindings, targetRepoRoot)`
- `/templates/METHOD.md`

**이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.** step 2가 `uptake verify`를 배포해 `verify.json`(status·verificationId·해시 3종·frozenArgv) · `generated.json` · `bindings.json` · `logs/`를 남긴다.

## 배경

`apply`는 **타깃 저장소를 실제로 바꾸는 유일한 명령**이다. 그래서 승인이 여기 있다. 승인은 파일에 보관되지 않는다 — `apply` 프로세스 안에서 받고 즉시 소비한다. 파일에 승인을 보관하면 복사·되돌리기로 재사용 시도가 가능해진다(ADR-022).

## 작업

### (a) `src/workflow/steps/apply.ts`

```ts
export type ApprovalSummary = {
  patternId: string;
  targetRepoRoot: string;
  frozenArgv: string[];
  gateTestId: string;
  files: { path: string; role: string; content: string }[];
  bindings: BindingDetection[];
};

export type ApprovalPrompt = (summary: ApprovalSummary) => Promise<boolean>;

export type ApplyCommandResult = { exitCode: 0 | 1 | 2 | 3; message: string };

export async function runApplyCommand(
  options: { confirm: ApprovalPrompt; root?: string },
): Promise<ApplyCommandResult>;
```

순서:

1. `readCurrentRun` → 없으면 exit 2.
2. `verifyState(runId)` → `missing`/`failed`면 exit 2. 실패면 그 status·detail을 보이고 `uptake verify --target <abs>`를 다시 치라고 알려준다.
3. `generated.json`·`bindings.json`을 읽는다. 둘 중 하나라도 없거나 형태가 깨졌으면 exit 2 — "검증 산출물이 불완전하니 `verify`를 다시 돌려라". **여기서 다시 생성하지 마라**(아래 금지사항).
4. **재적용 차단 ①(소비 봉인).** `applyState(runId)`가 `succeeded`이고 그 `verificationId`가 `verify.json`의 것과 **같으면** exit 2, "이 검증 산출물은 이미 적용됐다. 다시 적용하려면 `verify`를 다시 돌려라". 기존 `apply.json`을 덮어쓰지 마라 — 적용 기록이다.
5. 승인 요약을 만들어 `confirm(summary)`를 부른다. 요약에는 **적용될 파일 전체 내용**과 검증에 쓰인 `frozenArgv`·`gateTestId`·해소된 바인딩이 들어간다. 사람이 무엇에 동의하는지 보지 못하면 승인이 아니다.
6. `confirm`이 `false`면 exit 2, "승인되지 않아 적용하지 않았다". **`apply.json`을 쓰지 마라.** 이유: 거부는 게이트 실패가 아니라 사람의 선택이고, 기록하면 4번의 소비 봉인에 걸려 같은 검증 산출물로 다시 승인할 길이 막힌다.
7. `verify.json`에 **고정된** 값으로 `ApprovalInput`을 조립해 `applyGenerated(approval, generated.files, bindings, targetRepoRoot)`를 부른다.

   ```ts
   const approval: ApprovalInput = {
     patternId, targetRepoRoot,
     contentHash, bindingsHash, targetBaseHash,   // verify.json의 값 그대로
     frozenArgv,
   };
   ```

   **해시를 여기서 다시 계산해 넣지 마라.** 검증 시점에 고정된 값을 넘겨야 엔진의 재계산 대조가 의미를 갖는다 — 지금 계산한 값을 넘기면 항상 일치해 세 방어가 전부 무력해진다. 재계산은 엔진의 일이다.
8. 결과를 `apply.json`에 기록한다. `completed` → `status: "applied"` + `written` + 소비한 `verificationId`, exit 0. 그 외(`diff-mismatch` · `bindings-mismatch` · `base-changed` · `apply-failed`) → 그대로 기록하고 exit 1.

**재적용 차단 ②(base-changed)**는 코드를 따로 쓰지 않는다 — 사용자가 `apply.json`을 지우고 다시 쳐도 적용으로 타깃 트리가 이미 달라졌으므로 엔진의 `targetBaseHash` 대조가 `base-changed`로 거부한다. step 4가 이 경로를 테스트한다.

### (b) TTY 승인 배선

**승인 프롬프트의 구현은 `runApplyCommand` 밖에 둔다.** 명령 로직은 `ApprovalPrompt` 포트만 알고, TTY 검사와 readline은 CLI 배선(`src/workflow/cli.ts`)이 담당한다.

- `cli.ts`의 `KNOWN_COMMANDS`에 `"apply"`를 추가한다.
- `apply`를 실행하기 전에 `process.stdin.isTTY !== true`면 **`runApplyCommand`를 부르지 않고** exit 2로 나간다: "승인을 받을 수 없는 환경이다(stdin이 TTY가 아니다). 대화형 터미널에서 실행하라." 산출물을 쓰지 않는다.
- TTY일 때 쓰는 프롬프트는 `node:readline/promises`로 요약을 출력하고 응답을 받는다. **`y`/`yes`(대소문자 무시)만 승인이고 나머지는 전부 거부다.** 빈 입력을 승인으로 해석하지 마라.
- 프롬프트 함수는 테스트 가능하도록 `cli.ts`에서 export하되, 기본 배선이 그것을 쓰게 한다.

### (c) 배포 현황 문구 갱신

다섯 단계가 모두 배포됐다.

- `templates/METHOD.md`: 배포 현황 문단을 "다섯 단계가 모두 배포됐다"로 갱신한다. 다섯 단계 체인 자체는 그대로다.
- `src/workflow/steps/verify.ts`의 성공 메시지: "여기까지가 현재 배포된 워크플로우" → 다음 명령 안내(`uptake apply`)로 바꾼다.
- `apply` 성공 메시지가 마지막이므로 적용된 파일 목록과 **다음에 사람이 할 일**(생성된 게이트를 커밋할지 검토)을 알린다. 규범적 단정 없이 서술적으로 쓴다(ADR-006).

## Acceptance Criteria

```bash
npm run lint     # 통과
npm run build    # 컴파일 에러 없음
npm test         # 전체 통과
```

추가로 아래가 존재하고 통과해야 한다:

```bash
npx vitest run src/workflow/steps/apply.test.ts src/workflow/cli.test.ts src/workflow/steps/verify.test.ts
```

`src/workflow/steps/apply.test.ts`가 덮어야 할 것 (`confirm`은 스텁을 주입한다):

- 선행조건: run 없음 / `verify.json` 없음 / `verify.json`이 실패 상태 → 각각 exit 2, `apply.json` 없음.
- 승인 거부(`confirm`이 `false`) → exit 2, `apply.json` 없음, **타깃 파일 변화 없음**.
- 승인 → `status: "applied"`, 타깃에 생성 파일이 실제로 쓰임, exit 0.
- **재적용 차단 ①**: 같은 run에서 다시 호출 → exit 2, 기존 `apply.json`이 그대로 보존됨, `confirm`이 **호출되지 않음**(소비 봉인이 승인보다 앞선다).
- **재적용 차단 ②**: `apply.json`을 지우고 다시 호출 → `status: "base-changed"` + exit 1.
- **해시 대조 3종이 각각 다른 이름으로 실패한다**: `verify.json`의 `contentHash`를 손으로 바꾸면 `diff-mismatch`, `bindingsHash`를 바꾸면 `bindings-mismatch`, `targetBaseHash`를 바꾸면 `base-changed`.

`src/workflow/cli.test.ts`에 추가: stdin이 TTY가 아닐 때 `apply`가 exit 2이고 `apply.json`을 만들지 않는다.

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

- **자동 승인 플래그·환경변수를 만들지 마라(`--yes`, `--force`, `UPTAKE_AUTO_APPROVE` 등). 이유:** 대화형 승인만 두는 것은 ADR-022가 의도한 제약이다(human-in-the-loop). 무인 실행을 가능하게 하는 통로를 만들면 그것이 곧 공식 경로가 된다. 테스트는 `ApprovalPrompt` 포트를 주입해 검증하고, 그 주입은 `cli.ts` 배선을 거치지 않는다.
- **`apply`에서 `instantiate`를 다시 부르지 마라. 이유:** `verify`가 검증한 **정확한 파일들**을 적용하는 것이 이 결속의 전부다(ARCHITECTURE 'verify → apply 결속'). 재생성하면 검증된 것과 적용된 것이 다를 수 있고 해시 대조가 무의미해진다.
- **해시를 apply 시점에 다시 계산해 `ApprovalInput`에 넣지 마라. 이유:** 세 방어가 전부 항상 통과하게 된다. 고정된 값을 넘기고 재계산은 엔진이 한다.
- **승인 상태를 파일에 보관하지 마라(`approved: true` 같은 필드). 이유:** 승인이 프로세스보다 오래 살면 복사·되돌리기로 재사용할 수 있다. `apply.json`이 기록하는 것은 "적용됐다"는 사실이지 "승인됐다"는 권한이 아니다.
- **`approval-store.ts`(웹의 인메모리 승인 저장소)를 CLI에서 쓰지 마라. 이유:** 프로세스가 다른 표면이 그 저장소에 가짜 승인을 심는 것이 ADR-022가 끊으려던 바로 그 결합이다.
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
