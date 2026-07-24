# Step 1: integration-gate

## 읽어야 할 파일

먼저 아래 파일들을 읽고 각 모듈의 실제 시그니처를 파악하라:

- `/docs/PRD.md` — **MVP 수용 기준 서두**("하나라도 red면 MVP는 완성이 아니다")·**AC-5·6·7·9·10·11**.
- `/docs/ADR.md` — ADR-008(성공 위장 절대 금지, 실패는 정직하게 표면화).
- `/AGENTS.md` — "생성물은 자기검증을 통과해야 한다 … green만으론 증명이 아니다. 성공 위장 절대 금지".
- 기존 구현: `src/lib/catalog/load.ts`(`loadCatalog`), `src/lib/engine/detect.ts`(`detectBindings`), `src/lib/engine/instantiate.ts`(`instantiate` — 지원 patternId·oracle 사용법), `src/lib/engine/verify.ts`(`prepareVerification`/`executeVerification`), `src/services/approval-store.ts`(step 0: `createApproval`/`approveVerification`), `src/lib/engine/apply.ts`(step 0: `applyGenerated(verificationId, …)`), `catalog/spec-change-declaration-gate.json`(oracle 값 참조용), `src/__tests__/pipeline.integration.test.ts`(재작성 대상).
- 이전 step 산출물: step 0이 apply를 **verificationId 기반**으로 바꿨다(index.json step 0 summary 참고). 이 테스트는 새 승인 결속 API를 쓴다.

## 배경 — 고쳐야 할 결함 (코드 리뷰에서 확인됨)

현재 `pipeline.integration.test.ts`는 실제 씨앗 저장소(`.uptake/sources/`의 backend.ai·pytest)에 의존한다. 그런데 `.uptake/sources/`는 `.gitignore` 대상이라 저장소에 없다. 그래서 **깨끗한 checkout(CI·다른 개발자)에서는 씨앗이 없어 통합 테스트가 `describe.skip`으로 조용히 건너뛰어지고, AC-11 수용 게이트가 실행되지 않아도 전체가 green이 된다.**

이는 이 프로젝트가 설파하는 원칙("green만으론 증명이 아니다 · 성공 위장 절대 금지")을 **자기 테스트가 어기는 것**이다. dogfooding 계약("하나라도 red면 MVP 미완성")상 필수 수용 게이트가 조용히 skip되면 안 된다.

## 작업

`pipeline.integration.test.ts`를 **자기완결적 fixture 기반**으로 재작성해, 실제 씨앗 유무와 무관하게 **항상 실행**되도록 한다. 실제 backend.ai 60MB를 저장소에 커밋하지 않고, 테스트가 런타임에 경량 씨앗을 구성한다.

### fixture 씨앗·카탈로그를 런타임에 구성

테스트 setup에서:
1. 임시 디렉토리에 **씨앗 git repo 2개**를 만든다(서로 다른 `independenceGroup`). 각 repo에 3개 역할 파일(spec-artifact·spec-check·blocking-gate에 해당하는 아무 파일)을 두고 `git init` → `git add` → `git commit`. 각 repo의 **커밋 SHA**를 확보한다. 이유: provenance resolve는 `git show <rev>:<path>`이므로 씨앗은 실재하는 git repo·고정 revision이어야 한다.
2. 그 SHA·경로로 **fixture 패턴 JSON**을 구성해 임시 catalogDir에 쓴다. 이 패턴은:
   - `patternId`는 `"spec-change-declaration-gate"`(instantiate가 지원하는 값), 파일명도 동일.
   - `roles`·`bindingPoints`·`oracle`(marker·replacement·gateTestId·targetRole)은 **실제 `catalog/spec-change-declaration-gate.json`과 동일하게** 둔다(instantiate/injection이 그대로 동작하도록). 실제 카탈로그를 읽어 그 값을 복사하라.
   - `sources`(2개, 둘 다 `isTargetStack: false`, 서로 다른 `independenceGroup`)·`provenance`(각 role이 두 repo 모두에서 관찰 = 6개)만 **fixture 씨앗**을 가리키게 한다.
3. 이 fixture 씨앗 root를 `loadCatalog(catalogDir, seedRoot)`의 `sourceRoot`로 넘긴다.

### 실행할 실제 파이프라인 (mock 없음, skip 없음)

`loadCatalog` → `detectBindings`(임시 vitest 타깃 git repo) → `instantiate` → `prepareVerification` → `executeVerification`(**실제 vitest subprocess**) → `awaiting-approval` → `createApproval` → `approveVerification` → `applyGenerated(verificationId)` → `completed`.

- **타깃**도 임시 git repo(package.json에 vitest devDependency, `git commit`). 이유: verify의 워크스페이스 복제가 `git ls-files`에 의존한다.

### 검증할 계약 (항상 실행)

- **AC-6/7**: `awaiting-approval` = 실제 vitest에서 양성 pass + marker 위반 음성 fail. mock 아님.
- **AC-5**: 검증 전후 타깃 불변.
- **AC-10 (승인 결속, 실제 경로)**: `approveVerification`을 **생략**하고 `applyGenerated`를 부르면 `not-approved`로 거부되고 **타깃에 쓰기가 없음**. 그 다음 정상적으로 approve→apply → `completed`.
- **AC-9**: 승인된 산출물 해시로 적용이 `completed`. 변조 시 `diff-mismatch`.

### skip 금지

- 이 테스트는 **씨앗을 스스로 구성하므로 skip할 이유가 없다.** `describe.skip`·조건부 skip을 두지 마라. 반드시 실행된다.
- 실제 씨앗(`.uptake/sources/`)에 의존하지 마라. (실제 backend.ai/pytest provenance 실증은 별도인 `catalog/spec-change-declaration-gate.test.ts`가 담당하며, 그것은 환경 의존이라 씨앗 없으면 skip이 허용된다. 이 통합 게이트는 그와 달리 항상 실행이다.)

## Acceptance Criteria

```bash
npm run build
npm run test    # 통합 게이트가 skip 없이 실제로 실행되어 통과
npm run lint
```

추가 확인 — 씨앗이 없어도 통합 게이트가 도는지 명시적으로 검사한다:

```bash
UPTAKE_SOURCE_ROOT=/nonexistent npm run test -- src/__tests__/pipeline.integration.test.ts
# → skip이 아니라 실제 실행되어 pass 해야 한다 (fixture 씨앗을 자체 구성하므로)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. **통합 테스트가 skip이 아니라 실제로 실행**되는지 확인한다(vitest 출력에 skip 표시가 없어야 한다).
2. 아키텍처 체크리스트:
   - 씨앗 부재(`.uptake/sources` 없음/`UPTAKE_SOURCE_ROOT`가 빈 경로)에도 통합 게이트가 **실행**되는가?
   - `runGate`가 mock되지 않고 실제 vitest subprocess가 도는가?
   - `approveVerification` 없이 apply가 거부되고 쓰기가 없는가(AC-10 실제 경로)?
3. 결과에 따라 `phases/0-fix2/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "pipeline.integration.test.ts 재작성 — 런타임 fixture 씨앗(git repo 2개)+fixture 카탈로그로 항상 실행(skip 위장 제거). 실제 vitest로 loadCatalog→…→createApproval→approveVerification→applyGenerated 전 경로, 미승인 apply 거부(AC-10) 포함. .uptake/sources 비의존"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`describe.skip`·조건부 skip으로 수용 게이트를 건너뛰지 마라.** 이유: 그것이 정확히 이 step이 고치는 성공 위장이다. fixture는 항상 구성 가능하므로 skip이 필요 없다.
- **`runGate`를 mock하지 마라.** 이유: 실제 vitest 연결 실증이 이 테스트의 존재 이유다.
- **실제 `.uptake/sources`에 의존하지 마라.** 이유: gitignore 대상이라 깨끗한 checkout에서 없다. fixture 씨앗을 런타임 구성한다.
- **`instantiate`가 지원하지 않는 patternId로 fixture를 만들지 마라.** 이유: 생성이 `generation-failed`가 된다. `spec-change-declaration-gate`와 동일 oracle을 써라.
- **기존 단위 테스트를 삭제하지 마라.** 이유: 단위(빠름)와 통합(느림)은 역할이 다르다. 둘 다 남긴다.
- 기존 테스트를 깨뜨리지 마라.
