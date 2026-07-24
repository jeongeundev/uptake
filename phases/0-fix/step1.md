# Step 1: verify-integration

## 읽어야 할 파일

먼저 아래 파일들을 읽고 각 모듈의 실제 시그니처를 파악하라:

- `/docs/ARCHITECTURE.md` — 「데이터 흐름」의 이식 블록·「VERIFY 실행 계약」.
- `/docs/PRD.md` — **AC-5·AC-6·AC-7·AC-9·AC-10·AC-11**(AC-11의 **엔진 부분**을 이 테스트가 실증한다).
- `/docs/ADR.md` — ADR-008(양성+음성 판별로만 "루프를 닫았음"이 증명된다).
- `/AGENTS.md` — 자기검증·성공 위장 금지.
- 기존 구현: `src/lib/catalog/load.ts`(`loadCatalog`), `src/lib/engine/detect.ts`(`detectBindings`), `src/lib/engine/instantiate.ts`(`instantiate`), `src/lib/engine/verify.ts`(**step 0에서 분리된 `prepareVerification`/`executeVerification`**), `src/lib/engine/apply.ts`(`applyGenerated`·`hashTargetBase`·`ApprovalRecord`), `catalog/spec-change-declaration-gate.json`.
- 이전 step 산출물: step 0이 `verify()`를 `prepareVerification()`/`executeVerification()`로 분리했다(index.json step 0 summary 참고). 이 테스트는 **새 API**를 쓴다.

## 배경 — 왜 이 테스트가 필요한가 (코드 리뷰에서 확인됨)

현재 `verify.test.ts`는 `runGate`를 전역 mock한다. 그래서 검증되는 것은 "mock이 pass/fail을 반환하면 상태 머신이 그것을 소비한다"는 **구현 세부**일 뿐, 아래 실제 연결은 한 번도 증명되지 않는다:

```
catalog oracle → instantiate marker/replacement → 워크스페이스 복제
→ 생성물 적용 → 실제 vitest JSON → 같은 gateTestId의 positive pass / negative fail → apply
```

`gate-runner.test.ts`는 실제 vitest를 돌리지만 임시 `gate.test.js`만 실행하고 INSTANTIATE 산출물을 쓰지 않는다. 즉 **runner와 상태 머신 사이 연결부가 깨져도 두 테스트 모두 통과할 수 있다.** 이 step은 그 연결을 mock 없이 한 번 끝까지 실행해 닫는다.

## 작업

`src/__tests__/pipeline.integration.test.ts`를 만든다. **`runGate`를 mock하지 마라 — 실제 vitest subprocess가 돌아야 한다.**

### 실행할 실제 파이프라인

1. **로드**: `loadCatalog("catalog", <sourceRoot>)` → `spec-change-declaration-gate` 패턴이 `loaded`에 있고 `generationEnabled === true`.
2. **타깃 준비**: 테스트 안에서 **임시 git repo 타깃**을 만든다. 이유: `verify`의 워크스페이스 복제는 `git ls-files`(tracked 파일)에 의존하므로 타깃은 git repo여야 한다.
   - `package.json`에 `vitest`를 `devDependencies`로 적는다(실제 설치 불필요 — `detectBindings`가 checker=vitest를 탐지하기 위한 근거일 뿐, 게이트는 uptake 자체 vitest로 실행된다).
   - `git init` → 파일 추가 → `git commit` (tracked 상태로 만든다).
3. **탐지**: `detectBindings(pattern, 임시타깃)` → checker가 `detected`(value `"vitest"`), gate-location `detected`. (spec-format·naming은 `binding-unresolved`가 정상이며 생성에 지장 없다.)
4. **생성**: `instantiate(pattern, bindings)` → `ok:true`, files 2개(`uptake-gate/declared-changes.ts`·`uptake-gate/spec-gate.test.ts`), injection, gateTestId `"declared-change-present"`.
5. **검증 (실제 실행)**: `prepareVerification(...)` → `executeVerification(prepared)`. **실제 runGate가 실제 vitest subprocess를 띄워** 워크스페이스에서 게이트 테스트를 돌린다. 결과가 `awaiting-approval`(양성 pass + 음성 fail이 실제로 일어남)인지 확인한다.
6. **적용**: `awaiting-approval`의 `contentHash`·`frozenArgv`로 `ApprovalRecord`를 만들고(`targetBaseHash = hashTargetBase(타깃)`), `applyGenerated(approval, files, 타깃)` → `completed`. 타깃에 생성물이 실제로 쓰였는지 확인한다.

### 검증할 계약 (mock 없이 실제로)

- **AC-6/AC-7 (실제 green/red)**: 5단계가 `awaiting-approval`이라는 것 = 실제 vitest에서 양성 게이트가 통과하고, marker→replacement 위반을 심은 음성 게이트가 실패했다는 것. mock이 아니라 subprocess 결과다.
- **AC-5 (타깃 불변)**: 4~5단계(검증) 전후로 타깃 repo 작업 트리가 동일한지(적용 6단계 **전까지** 타깃에 쓰기 없음). `hashTargetBase` 또는 git status로 확인.
- **AC-9 (승인=검증)**: 검증된 산출물 해시로 적용이 `completed`. 산출물을 변조하면 `diff-mismatch`.
- **AC-10 (승인 결속)**: 잘못된 `contentHash`를 담은 `ApprovalRecord`로는 적용이 거부되고 타깃에 쓰기가 없음.

### 씨앗 부재 처리

`loadCatalog`는 씨앗(`.uptake/sources/`의 backend.ai·pytest)이 있어야 패턴을 로드한다. 씨앗 디렉토리가 없으면 이 테스트 전체를 `describe.skip` 또는 조건부 `test.skip`으로 건너뛴다. **단 skip 사유를 로그로 남겨라**(조용히 통과로 위장하지 마라 — 이 프로젝트의 성공 위장 금지 원칙). 씨앗이 있으면 반드시 실제로 실행된다.

## Acceptance Criteria

```bash
npm run build
npm run test    # 통합 테스트 포함 전체 (씨앗 있으면 실제 vitest subprocess 실행)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 씨앗이 있는 이 환경에서는 통합 테스트가 **실제로 실행**되어야 한다(skip이 아니라).
2. 아키텍처 체크리스트:
   - `runGate`가 **mock되지 않고** 실제 vitest subprocess가 도는가?
   - catalog→instantiate→verify→apply가 **하나의 테스트에서 실제 데이터로** 연결되는가?
   - 음성이 실제 위반 삽입으로 red가 되는가(mock된 fail이 아니라)?
   - 타깃이 적용 전까지 불변인가?
3. 결과에 따라 `phases/0-fix/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/__tests__/pipeline.integration.test.ts — mock 없는 실제 파이프라인(loadCatalog→detectBindings→instantiate→prepare/executeVerification 실제 vitest→applyGenerated). AC-5/6/7/9/10을 실제 subprocess로 실증(AC-11 엔진 부분). 씨앗 부재 시 사유 로그 후 skip"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`runGate`를 mock하지 마라.** 이유: 이 테스트의 존재 이유가 "실제 vitest 연결 실증"이다. mock하면 step 0 이전의 문제로 되돌아간다.
- **씨앗 부재를 조용한 통과로 위장하지 마라.** 이유: 성공 위장 금지(ADR-008). skip이면 skip임을 사유와 함께 드러낸다.
- **타깃 원본에 검증 단계에서 쓰지 마라.** 이유: AC-5. 쓰기는 6단계 apply(사용자 승인 결속)에만.
- **기존 단위 테스트(`verify.test.ts` 등)를 이 통합 테스트로 대체하거나 삭제하지 마라.** 이유: 단위 테스트(빠른 상태 머신 검증)와 통합 테스트(느린 실제 실행)는 역할이 다르다. 둘 다 남긴다.
- 기존 테스트를 깨뜨리지 마라.
