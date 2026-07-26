# Step 8: survey-e2e

저장소 지정 → 후보 제시 → 선택 → 등재 → 카탈로그에서 읽기를 **브라우저에서 관통하는** E2E 1건을 만든다. PRD가 phase 3의 완료 조건으로 요구한 "가장 얇은 end-to-end"의 증거다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 성공 위장 금지
- `/docs/PRD.md` — "Phase 3 범위"의 "전체 흐름 연결 … 결정적·오프라인(스텁 proposer)으로 돈다"
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)" 전체
- `/docs/ADR.md` — ADR-008(자기검증·성공 위장 금지), ADR-015(수용 테스트는 스텁 주입)
- `/e2e/authoring-pipeline.spec.ts` — 같은 성격의 기존 E2E. 카탈로그 디렉터리·씨앗 불변 검사 방식을 그대로 따른다
- `/e2e/authoring-unresolved.spec.ts` — 폐기 경로를 검사하는 기존 E2E
- `/e2e/fixtures.config.ts` — fixture 저장소를 `git init`/`add`/`commit`으로 만드는 기존 방식
- `/e2e/global-teardown.config.ts` · `/playwright.config.ts` · `/playwright.unresolved.config.ts` — 실행 설정과 정리
- `/src/components/survey-wizard.tsx` — step 7이 만든 화면. 셀렉터의 근거
- `/src/app/api/survey/proposer.ts` — step 5가 만든 proposer 선택. 스텁을 **명시적 환경변수로** 켠다

## 작업

### 1. fixture 저장소

`e2e/fixtures.config.ts`에 SURVEY용 fixture 저장소를 추가한다. 요건:

- git 저장소여야 하고 커밋이 있어야 한다(revision 고정 대상).
- `survey-rules.json`의 여러 카테고리에 걸리는 파일을 담는다 — 최소한 지침 문서 하나, 자동화 스크립트 하나, 훅 또는 CI 설정 하나. **한 카테고리만 있는 fixture로는 라운드로빈 경로가 검증되지 않는다.**
- 기존 fixture와 **디렉터리를 공유하지 마라.** 각 fixture는 자기 것만 만들고 정리한다.

### 2. `e2e/survey.spec.ts`

스텁 proposer를 명시적으로 켠 상태로 다음을 관통한다.

1. SURVEY 화면에서 fixture 저장소 식별자를 입력하고 조사한다.
2. 후보 목록이 나오고, 각 후보에 **근거 경로가 표시**된다.
3. **환각 후보의 폐기가 화면에 보인다** — 스텁 스크립트에 존재하지 않는 경로를 근거로 단 후보를 하나 넣고, 그것이 폐기 사유와 함께 표시되는지 확인한다. 조용히 사라지면 실패다.
4. **한계 고지**(자생/상속 미구분 · `observed`의 주장 범위)가 결과 화면에 있다.
5. 후보 하나를 골라 채택하면 초안이 렌더되고, 초안의 `capability`가 `descriptive`, `evidenceStatus`가 `observed`, role이 1개, `bindingPoints`가 비어 있다.
6. 승인 후 등재하면 `catalog/<patternId>.json`이 **실제로 생긴다**(파일시스템에서 확인).
7. 등재된 파일이 카탈로그 API로 다시 **읽힌다** — 층 1 하드 게이트를 통과했다는 증거다. 로드되지 않으면 등재는 실패다.
8. **씨앗 파일이 변하지 않았다**(`catalog/spec-change-declaration-gate.json`의 내용 해시 또는 원문 비교).

### 3. 실행 설정

`playwright.config.ts`의 webServer 환경에 SURVEY fixture 경로와 스텁 활성 변수를 추가한다. 기존 저작·이식 E2E의 환경 설정을 **깨뜨리지 마라.**

전체 실행이 **결정적·오프라인**이어야 한다. 네트워크나 실제 API 키에 의존하는 경로가 있으면 안 된다.

### 4. 정리

`e2e/global-teardown.config.ts`가 이미 하는 정리 방식을 따라, 이 spec이 만든 카탈로그 파일과 fixture를 정리한다. **저장소에 커밋된 씨앗 카탈로그를 지우지 마라.**

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:e2e`가 기존 spec들과 함께 통과해야 한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`e2e/`)
   - ADR 기술 스택을 벗어나지 않았는가? (Playwright 외 새 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (실패를 통과시키는 완화가 없는가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **기존 E2E spec을 수정해서 통과시키지 마라. 이유: 기존 spec은 회귀 방지 증거다. 그것이 깨졌다면 이 step의 변경이 무언가를 부순 것이고, 고칠 대상은 spec이 아니라 코드다.**
- **assertion을 약화시키거나 `test.skip`으로 넘기지 마라. 이유: 성공 위장 금지(ADR-008). 통과하지 못하면 `error` 상태로 보고하는 것이 정직하다.**
- **실제 LLM API를 호출하지 마라. 스텁 proposer를 명시적 환경변수로 켠다. 이유: 수용 기준은 결정적·오프라인이어야 한다(ADR-015).**
- **스텁이 기본값으로 켜지게 만들지 마라. 이유: 실제 사용 경로에서 스텁이 조용히 도는 것은 결과 전체를 무의미하게 만든다.**
- **커밋된 씨앗 카탈로그(`catalog/spec-change-declaration-gate.json`)를 수정하거나 삭제하지 마라. 이유: 씨앗 보호는 하드 게이트의 검사 대상이며, E2E가 그것을 깨면 다른 테스트가 전부 무너진다.**
- **환각 폐기 검사를 빼지 마라. 이유: 그 검사가 이 제품이 링크 모음집과 갈리는 지점이다. 통과하는 후보만 확인하는 E2E는 게이트가 죽어도 green이다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
