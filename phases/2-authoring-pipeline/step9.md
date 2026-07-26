# Step 9: authoring-e2e

> **먼저 읽어라 — 이 step에서 절대 하지 않는 것**
>
> 이 step 안에서 **리뷰나 remediation loop를 돌리지 마라.** `$remediate` 호출,
> `scripts/execute.py` 재귀 실행, 새 phase 디렉터리(`phases/*-fix-c*`) 생성,
> `remediation/` 아래 산출물 작성이 모두 금지다.
>
> 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase
> 완료 후 **독립 세션**의 `$remediate`가 맡는다. step 7에서 이 금지를 어긴 전례가 있으니
> 결함을 발견하더라도 리뷰 절차를 열지 말고, 이 step 문서가 요구한 작업만 하라.
> 범위 밖의 결함을 발견하면 고치지 말고 step summary에 한 줄로 적어라.

PRD "Phase 2 범위"의 마지막 요구사항 — **전체 흐름 연결(앵커 형태)** — 을 실행 가능한 증거로 만든다. 앱이 저작·등재한 앵커 형태 generative 패턴 하나가 곧바로 INSTANTIATE(역할 형태 매칭) → VERIFY로 이식·검증까지 이어지는 것을 E2E 1건으로 증명한다.

## 이 E2E의 결정성

proposer는 **스텁을 주입**한다. 실제 LLM을 부르지 않는다. 증명 대상은 "LLM이 좋은 패턴을 뽑는가"가 아니라 **결정적 기계가 저작→등재→이식→검증을 끝까지 잇는가**이기 때문이다(ADR-015). 실제 어댑터 확인은 step 7의 비차단 eval이 맡는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/PRD.md` — "Phase 2 범위"의 마지막 요구사항(전체 흐름 연결), AC-C9·AC-C10
- `/docs/ARCHITECTURE.md` — "데이터 흐름" 절 전체
- `/e2e/vertical-slice.spec.ts` — 기존 브라우저 E2E. 형태와 단언 방식의 기준
- `/e2e/fixtures.config.ts` — 런타임 fixture 생성 방식 (소스 저장소·타깃 저장소·카탈로그 디렉터리)
- `/e2e/global-teardown.config.ts` — teardown 소유권 규약
- `/playwright.config.ts` — 환경변수 주입 방식(`UPTAKE_CATALOG_DIR`·`UPTAKE_SOURCE_ROOT`·`UPTAKE_E2E_TARGET_ROOT`)
- `/src/__tests__/e2e-teardown.test.ts` — 실행이 소유한 임시 root만 삭제한다는 규약
- 이전 step 산출물 전부: `src/lib/engine/extract.ts`·`abstract.ts`·`oracle-draft.ts`·`self-verify.ts`, `src/lib/catalog/write.ts`, `src/services/authoring-store.ts`·`draft-store.ts`·`proposer-stub.ts`, `src/app/api/authoring/`, `src/components/authoring-wizard.tsx`

## 작업

### 1. fixture 확장

`e2e/fixtures.config.ts`에 저작용 fixture를 추가한다.

- **소스 저장소 2개**: 서로 다른 `independenceGroup`으로 등록될 저장소. 앵커 3역할(`spec-artifact`·`spec-check`·`blocking-gate`)에 해당하는 파일을 각각 가지고 있어야 하고, 최소 하나는 타깃과 다른 스택이어야 한다(ADR-013).
- **빈 카탈로그 디렉터리**: 저작이 새 패턴을 쓸 곳. 씨앗 패턴 파일을 함께 두어 **등재가 기존 파일을 건드리지 않는다**는 것도 확인할 수 있게 하라.
- **타깃 저장소**: 기존 JS/TS + vitest fixture를 재사용한다.

기존 vertical-slice fixture를 깨뜨리지 마라. 정리는 **실행이 만든 임시 root만** 삭제한다.

### 2. 스텁 proposer 주입 경로

E2E는 실행 중인 서버를 상대로 돌기 때문에, 서버가 어떤 proposer를 쓸지 **테스트에서 결정할 수 있어야** 한다.

- 환경변수 하나로 "스텁 proposer + 스크립트 파일 경로"를 지정할 수 있게 하라(예: `UPTAKE_PROPOSER=stub`, `UPTAKE_PROPOSER_STUB_SCRIPT=<json 경로>`).
- **이 경로는 명시적으로 지정했을 때만 활성화된다.** 설정이 없으면 step 6의 규칙대로 실제 어댑터를 요구하고, 어댑터 설정도 없으면 명시적 오류다. 스텁이 기본값이 되면 프로덕션에서 저작이 되는 것처럼 보이는 성공 위장이 된다.
- 스크립트에는 fixture 저장소의 실재 파일 경로가 담긴다 — 그래야 provenance가 resolve되고 근거로 확정된다.

### 3. `e2e/authoring-pipeline.spec.ts` — 브라우저 E2E 1건

한 번의 실행으로 다음을 통과해야 한다.

1. 저작 화면에서 소스 2개(각각 다른 `independenceGroup`, 하나는 non-target stack)와 intent·`patternId`·`capability: generative`·`evidenceStatus: corroborated`를 입력한다.
2. 초안이 생성되고 화면에 다음이 나타난다: 앵커 3역할, provenance 경로, corroboration 계산 결과, **자기검증 통과(양성 green + 음성 red 확인)**.
3. 승인 후 등재하면 `catalog/<patternId>.json`이 **새 파일로** 생긴다.
4. 이어서 **기존 이식 흐름**으로 그 패턴을 선택해 타깃 repo에 이식하고, VERIFY가 `awaiting-approval`에 도달한 뒤 승인·적용까지 간다.
5. 파일시스템 단언: 등재된 패턴 파일이 실재하고 유효한 JSON이며, **기존 씨앗 패턴 파일의 내용이 변하지 않았다**(AC-C10).

4단계가 이 step의 존재 이유다 — 저작이 부여한 **새 patternId**로 이식이 성공한다는 것이 step 1의 역할 형태 매칭이 실제로 동작한다는 증거다.

### 4. 환각 봉쇄 E2E 단언 (AC-C9)

같은 spec 파일 안에 두 번째 케이스를 넣거나 별도 테스트로 만들어라. 스텁이 **resolve되지 않는 경로**를 후보로 내도록 스크립트를 구성하면:

- 그 후보는 초안에 담기지 않고,
- 화면에 폐기 사유(`provenance-unresolved`)가 표시되며,
- 카탈로그에는 아무 파일도 늘지 않는다.

### 5. `playwright.config.ts` / teardown

새 fixture와 환경변수를 기존 방식대로 주입한다. teardown은 **실행이 소유한 임시 root만** 삭제한다 — 외부에서 제공된 경로를 지우는 경로를 만들지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npm run test:e2e
python3 -m pytest scripts/ -q
```

`npm run test:e2e`에는 기존 `e2e/vertical-slice.spec.ts`가 포함된다. **기존 E2E도 그대로 통과해야 한다.**

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 데이터 흐름과 실제 실행 경로가 일치하는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
   - E2E가 실제로 저작→등재→이식→VERIFY를 관통하는가, 아니면 중간을 mock했는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **E2E에서 실제 Anthropic API를 호출하지 마라. 이유: E2E는 결정적·오프라인이어야 하고, 증명 대상은 결정적 기계이지 LLM 품질이 아니다(ADR-015).**
- **스텁 proposer를 기본값으로 만들지 마라. 이유: 프로덕션에서 저작이 동작하는 것처럼 보이는 성공 위장이다. 명시적 환경변수로만 활성화된다.**
- **자기검증이나 VERIFY를 mock으로 대체하지 마라. 이유: 실제로 양성 green·음성 red가 나오는지가 이 E2E의 증명 내용이다(ADR-008).**
- **저장소에 커밋된 `catalog/` 아래에 테스트가 파일을 쓰지 마라. 이유: 씨앗 카탈로그를 오염시킨다. 임시 카탈로그 디렉터리를 `UPTAKE_CATALOG_DIR`로 주입하라.**
- **실행이 만들지 않은 디렉터리를 teardown에서 삭제하지 마라. 이유: 외부 제공 fixture root까지 지운 결함이 이미 한 번 발생했다.**
- **기존 `e2e/vertical-slice.spec.ts`를 수정해 통과시키지 마라. 이유: phase 1의 회귀 방지 증거다. 이 E2E는 새 파일로 추가한다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라.
