# Step 4: relay-integration

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 전부
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 전부, 'CLI 호출 규약', "cwd가 저장소 밖이면 `--tsconfig`가 필요하다"
- `/docs/ADR.md` — ADR-020(릴레이), ADR-022(승인), ADR-023(CLI는 descriptive/observed만 만든다), ADR-025(층 1 재검증)
- `/docs/PRD.md` — 'Phase 5 범위'의 "전체 흐름 연결"
- `/src/__tests__/workflow-relay.integration.test.ts` — **phase 4가 만든 관통 테스트. 이번 step이 확장한다.** 별개 `tsx` 자식 프로세스로 CLI를 부르는 방식, 임시 소스 저장소 생성, 스텁 proposer 배선을 그대로 따른다
- `/e2e/fixtures.config.ts` — 씨앗 카탈로그 패턴을 fixture 소스로 재구성하는 코드. 이번 step의 generative fixture가 같은 일을 한다
- `/src/workflow/steps/verify.ts`, `/src/workflow/steps/apply.ts`, `/src/workflow/artifacts.ts` — 이전 step들의 산출물
- `/catalog/spec-change-declaration-gate.json` — 씨앗 패턴(generative · corroborated)
- `/tests/fixtures/target-vitest` — 이식 타깃 fixture

**이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.**

## 배경 — 두 관통을 나눠 증명한다

**CLI로 저작한 패턴은 이식 대상이 될 수 없다.** `uptake author`는 SURVEY 채택 경로만 태우므로 산출물이 항상 `descriptive`/`observed`인데(ADR-023), `instantiate`는 `generative` AND `corroborated`만 통과시킨다(층 2 게이트). 스키마상 `descriptive`는 `oracle`을 가질 수 없어 검증할 게이트 자체가 없다. **이것은 버그가 아니라 문서화된 비대칭이며, 이번 step이 그 사실을 정직하게 고정한다.**

따라서 관통 증명은 둘로 나뉜다:

| 테스트 | 증명하는 것 |
|---|---|
| 릴레이 관통 (기존 파일 확장) | `init`→`survey`→`author`→`verify`가 프로세스 경계를 넘어 이어지고, CLI 저작 패턴이 층 2 게이트에서 **정직하게 차단**된다 |
| 검증·적용 관통 (새 파일) | `generative`/`corroborated` 패턴이 담긴 `authoring.json`에서 `verify`→`apply`가 실제 게이트를 돌려 적용까지 가고, 재적용이 두 겹으로 막힌다 |

두 번째 테스트가 `authoring.json`을 fixture로 조립하는 것은 계약 위반이 아니다 — 산출물 직접 편집 금지는 **승인·검증 산출물 한정**이고(ARCHITECTURE), 저작 산출물은 소비 시점에 `validatePatternValue`를 다시 통과해야 하는 것이 ADR-025의 설계다. 즉 이 입력은 층 1 게이트를 **실제로 통과해야만** 다음으로 간다.

## 작업

### (a) 릴레이 관통 확장 — `src/__tests__/workflow-relay.integration.test.ts`

기존 `init` → `survey` → `author` 흐름 뒤에 이어 붙인다(같은 `projectRoot`, 같은 방식으로 별개 프로세스 호출):

- `uptake verify --target <타깃 절대경로>` → **exit 1**, `verify.json`의 `status`가 `generation-blocked`.
- `bindings.json`이 기록돼 있다(탐지는 돌았다).
- `generated.json`은 없다.
- `uptake apply` → **exit 2**(성공한 검증 산출물이 없다), `apply.json` 없음.
- 씨앗 `catalog/`가 그대로다(기존 테스트의 스냅샷 비교를 유지한다).

타깃은 `tests/fixtures/target-vitest`를 임시 디렉터리로 복사한 뒤 git init + commit해서 쓴다(`verify`가 `targetEligibility`와 `git ls-files`를 쓴다).

### (b) 검증·적용 관통 — `src/__tests__/workflow-verify-apply.integration.test.ts` (신규)

**fixture 준비** (`e2e/fixtures.config.ts`의 방식을 따른다):

1. 임시 `sourceRoot` 아래에 소스 저장소 **2개**를 만들고 각각 git commit해 revision을 얻는다. 두 저장소는 **서로 다른 `independenceGroup`**을 갖고, 최소 하나는 `isTargetStack: false`여야 한다(`corroborated` 요구).
2. **각 소스가 패턴의 세 역할(`spec-artifact`·`spec-check`·`blocking-gate`) 파일을 전부** 갖게 한다 — 역할마다 독립 그룹이 2개 이상이어야 `validateEvidence`의 `role-evidence-invalid`를 통과한다.
3. `catalog/spec-change-declaration-gate.json`을 읽어 `sources`·`provenance`만 위 fixture로 교체한다. **`oracle`·`roles`·`bindingPoints`는 그대로 둔다** — 실제 게이트를 돌리는 것이 이 테스트의 목적이다.
4. 임시 `projectRoot`에 run 디렉터리(`.uptake/runs/001-fixture/`)를 만들고 `runs/current`를 쓴 뒤, `authoring.json`을 `{ status: "drafted", candidateId, pattern, discarded: [], targetStackFacts: [] }` 형태로 기록한다.
5. 타깃은 `tests/fixtures/target-vitest` 복사 + git init/commit.

**검증할 것** (순서대로):

1. `uptake verify --target <abs>`를 **uptake 저장소 밖 cwd에서 별개 `tsx` 프로세스로** 실행 → exit 0.
   - `verify.json`: `status: "verified"`, `verificationId` 존재, 해시 3종이 전부 비어 있지 않음, `frozenArgv`가 기록됨.
   - `generated.json`: 파일 2개(`uptake-gate/declared-changes.ts` · `uptake-gate/spec-gate.test.ts`).
   - `logs/positive.log` · `logs/negative.log` 둘 다 존재하고 비어 있지 않다.
   - **이 실행이 step 0의 vitest 경로 수정을 실증한다** — cwd가 저장소 밖인데 게이트가 실제로 돌아야 한다. 여기서 `gate-error`가 나면 경로 해석이 여전히 cwd에 매여 있다는 뜻이므로 우회하지 말고 원인을 고쳐라.
2. `uptake apply`를 같은 방식으로 서브프로세스 실행(stdin이 TTY가 아니다) → **exit 2**, `apply.json` 없음, 타깃 파일 변화 없음.
3. `runApplyCommand({ confirm: async () => false, root: projectRoot })`를 **in-process로** 호출 → exit 2, `apply.json` 없음, 타깃 불변.
4. `runApplyCommand({ confirm: async () => true, root: projectRoot })` → exit 0, `apply.json`의 `status: "applied"`, 타깃에 생성 파일 2개가 실제로 존재하고 내용이 `generated.json`과 일치.
5. **재적용 차단 ①**: 4를 그대로 다시 호출 → exit 2, `apply.json`이 보존됨(`written`이 그대로), `confirm`이 호출되지 않음.
6. **재적용 차단 ②**: `apply.json`을 지우고 다시 호출(`confirm`은 `true`) → exit 1, `status: "base-changed"`. 타깃 파일은 4에서 쓰인 그대로 남아 있다.
7. 씨앗 `catalog/`가 이 테스트 전후로 그대로다.

3~6을 in-process로 부르는 이유를 파일 상단 주석에 남겨라: **TTY를 흉내내지 않고 승인 포트를 주입해 검증한다.** 자동 승인 플래그는 코드에 존재하지 않으며(ADR-022), 그것을 만들지 않고 검증하는 방법이 포트 주입이다. 프로세스 경계 자체는 1·2가 증명한다.

### (c) 웹 회귀 확인

phase 5의 엔진 변경(`applyGenerated` 순수화 + `bindingsHash`, vitest 경로, `VerifyOutcome` 필드)은 **웹 코드를 건드리지 않아도 웹 동작을 바꾼다.** `stop-verify` 게이트는 E2E를 돌리지 않으므로 여기서 명시적으로 확인한다:

```bash
npm run test:e2e
```

`e2e/`는 회귀 방지 증거다 — **통과시키려고 E2E를 고치지 마라.** 깨지면 원인이 엔진 변경 쪽에 있으므로 그쪽을 고친다.

## Acceptance Criteria

```bash
npm run lint     # 통과
npm run build    # 컴파일 에러 없음
npm test         # 전체 통과
npm run test:e2e # 웹 회귀 통과 (두 config 순차)
```

추가로 두 통합 테스트가 실제로 돌아야 한다:

```bash
npx vitest run src/__tests__/workflow-relay.integration.test.ts src/__tests__/workflow-verify-apply.integration.test.ts
```

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

- **CLI 호출을 모킹으로 대체하지 마라. 이유:** 이 테스트가 증명하는 것은 "프로세스가 끊겨도 디스크로 이어진다"이며, in-process 호출로 바꾸면 증명 대상이 사라진다. 예외는 승인 포트 주입(위 (b) 3~6)뿐이고 그 이유는 주석으로 남긴다.
- **`--tsconfig` 없이 저장소 밖에서 `tsx`를 부르지 마라. 이유:** `tsx`가 `@/*` 별칭을 cwd에서 올라가며 찾은 tsconfig 기준으로 해석하므로 `MODULE_NOT_FOUND`가 난다(ARCHITECTURE 'CLI 호출 규약').
- **`generation-blocked`을 "테스트가 실패한다"로 읽고 우회하지 마라. 이유:** CLI 저작 패턴이 이식 대상이 아닌 것은 ADR-023이 명시한 설계이며, 그것을 고정하는 것이 (a)의 목적이다. 통과시키려고 `author`에 `generative` 승격을 넣지 마라 — 별도 phase의 일이다.
- **게이트가 `gate-error`로 나온 것을 "검증이 돌았다"로 계산하지 마라. 이유:** 리포터를 못 만든 실행은 red가 아니며 인프라 오류다(ADR-008). 이 테스트에서 `gate-error`가 나오면 원인(대개 경로 해석)을 고쳐야 하고, 기대값을 `gate-error`로 낮추는 것은 성공 위장이다.
- **E2E나 기존 테스트를 통과시키려고 수정하지 마라. 이유:** 회귀 방지 증거이며, 깨졌다는 것은 이번 phase의 변경이 무언가를 바꿨다는 신호다.
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
