# HANDOFF — phase 3 완료 / phase 4 방향 미정

> 이 문서는 새 세션이 현재 저장소 상태를 오해하지 않고 이어가기 위한 실행 계약이다. 이미 정본에 있는 요구사항·아키텍처·결정 상세를 반복하지 않고 경로로 참조한다.
>
> 기준 시각: 2026-07-27
> 현재 브랜치: `main` (PR #9 phase 3 · PR #10 하네스 개편 머지 완료)

## 1. 새 세션이 할 일

**phase 3까지 끝났다. 다음 phase가 무엇인지는 아직 정해지지 않았다.**

구현을 바로 시작하지 마라. 방향을 먼저 정한다 — 4절이 후보를 적어둔 곳이고, `$grilling`으로 압박한 뒤 `docs/PRD.md`·`docs/ADR.md`에 물질화하고 나서 `$harness`로 넘어간다.

**미해소 리스크가 하나 있다 (3절 말미).** phase 3은 유효한 독립 리뷰를 받지 않은 채 main에 있다.

## 2. 현재 판정

phase 0(엔진 INSTANTIATE·VERIFY) · phase 1(UI/API/E2E) · phase 2(저작 파이프라인) · phase 3(SURVEY) 모두 완료.

검증 상태 (2026-07-27, `main` = `5c80c2f` 기준 실측):

| 검증 | 결과 |
|---|---|
| `npm test` | 260 passed / 41 files |
| `npm run lint` | clean |
| `npm run build` | 성공 |
| `python3 -m pytest scripts/` | 99 passed |
| `npm run test:e2e` | 기본 3 passed + unresolved 1 passed |

## 3. phase 3 결과 — SURVEY가 제품 루트가 됐다

phase 2까지의 제품은 **사용자가 intent(찾을 방법론)를 지정할 수 있다**는 전제 위에 서 있었다. 무엇을 찾을지 아는 사용자는 이미 도구가 필요 없다는 판단으로 이 전제를 걷어냈다.

```
[신규] SURVEY   repo 1개 → 개발 체계 후보 N건 (각 후보 = intent 문자열 + 근거 경로)
                             ↓ 사용자가 고른다
[기존] EXTRACT → ABSTRACT → observed/descriptive 초안 → 승인 → 등재
[기존] (독립 근거 ≥2로 corroborated 승급) → INSTANTIATE → VERIFY
```

intent를 없앤 것이 아니라 **자동 생성**한다. `extractEvidence` 이하는 그대로 재사용되고, 사용자의 역할이 "무엇을 찾을지 떠올리기"에서 "제시된 것 중 고르기"로 바뀌었다.

결정은 `docs/ADR.md`에 물질화됐다 — **ADR-017**(제품 루트 = SURVEY), **ADR-018**(수집 규칙 = 확장 가능한 데이터), **ADR-019**(자생/상속 축은 판정 신호 확보 전까지 쓰지 않는다).

### 남아 있는 미검증

스파이크(브랜치 `proto-survey-spike`, main 미병합)는 세 저장소에서 환각 0건·provenance 100%를 확인했지만 다음은 열려 있다:

- 각 대상 **1회씩** — 재현·변동폭 미측정
- recall은 uptake에서만 측정 가능했다(정답지가 있는 유일한 대상)
- 자생/상속 구분 신호는 아이디어일 뿐 (ADR-019가 축 도입을 보류한 이유)
- 모노레포, 문서가 위키에만 있는 저장소, 비영어권 저장소 미검증

### CRITICAL: phase 3은 독립 리뷰를 받지 않았다

`remediation/archive/README.md`가 기록한 대로, phase 3의 리뷰는 **자기채점**이었다 — step 8 세션이 자기 코드를 리뷰하고 `phases/3-survey-fix-c1/`로 고친 뒤 스스로 closure review까지 해 Ready를 기록했다(ADR-008 위반). 그 findings 3건(major 2·minor 1)의 코드 수정은 유지했고, minor를 해소하며 낮춘 `isId(independenceGroup)` 하드 게이트는 `049eca6`에서 복원했다. **나머지는 검증되지 않았다.**

이 phase 위에 새 기능을 쌓기 전에 소급 리뷰를 돌릴지 정해야 한다:

```
/code-review 8c5062c     # PR #9 직전 커밋 = phase 3 diff 전체 (50파일)
$review 8c5062c
```

같은 사고가 재발하지 않도록 실행기가 `--disable-slash-commands`로 step 세션의 스킬 호출 능력을 제거했다(5절).

## 4. phase 4 후보 — 아직 결정 아님

정본은 `docs/PRD.md`의 Phase 범위 절이다. 아래는 미정 상태의 후보이며, 착수 전에 `$grilling`으로 압박하고 문서에 물질화해야 한다.

- **카탈로그 확충** — 실물이 씨앗 1건뿐이다(`catalog/spec-change-declaration-gate.json`). **카탈로그를 넓게 채우는 것이 세 기능 전부의 전제다.** SURVEY→채택 경로가 열렸으니 이제 실제로 채울 수 있다.
- **SURVEY 신뢰도 보강** — 위 "남아 있는 미검증" 항목. 재현 측정, 모노레포·비영어권 대응.
- **이식 경험 정리** — SURVEY가 루트가 되면서 기존 이식 UI의 진입 동선이 재배치됐다. `docs/UI_GUIDE.md`가 잠정 상태다.

## 5. 완료된 제품 표면

```text
[발견]  repo 지정 → 고정 revision에서 규칙별 라운드로빈 수집 → LLM 후보 제안
        → 수집 파일 밖 근거·형태 불량·중복 폐기(사유 보존) → 후보 선택
        → 재제안 없이 observed/descriptive 패턴 조립 → 서버측 승인 → 등재

[이식]  catalog → target 적격성 → binding 탐지/입력 → generated add diff + frozen argv/cwd/timeout 사전 표시
        → positive/negative VERIFY → 서버측 승인 → apply

[저작]  소스 repo ≥1 + intent → 파일 후보 제안(LLM) → provenance resolve 폐기 → 대조(공통=role/차이=binding)
        → corroboration 계산·강등 → oracle 초안 + 자기검증 → 초안 검토 → 승인 → 스테이징 검증 후 원자적 등재
```

핵심 위치:

| 대상 | 경로 | 비고 |
|---|---|---|
| SURVEY 수집 규칙 | `survey-rules.json` · `src/lib/engine/survey-rules.ts` | **데이터다. 코드에 박지 마라**(ADR-018) |
| SURVEY 엔진 | `src/lib/engine/survey-collect.ts`, `survey.ts`, `survey-adopt.ts` | 고정 revision의 수집 파일만 근거로 허용 |
| SURVEY 서비스 | `src/services/survey-service.ts`, `survey-store.ts` | 세션 결속 저장소 |
| 이식 UI | `src/components/catalog-bindings-wizard.tsx` | phase 1 확정 계약 — 재구조화 금지 |
| 저작 UI | `src/components/authoring-wizard.tsx` | |
| Route Handlers | `src/app/api/` | `survey/`(발견) · `workflows/`(이식) · `authoring/`(저작) |
| 저작 엔진 | `src/lib/engine/extract.ts`, `abstract.ts` | SURVEY 채택 경로가 붙은 지점 |
| proposer 포트 | `src/services/proposer.ts` | 불신 데이터 경계 `untrustedBlock` 포함 |
| proposer 구현 | `proposer-stub.ts`(결정적) · `proposer-anthropic.ts`(실제) | 스텁은 명시적 env로만 활성 |
| 초안 저장소 | `src/services/draft-store.ts` | 입력 fingerprint 결속 — `2-fix`의 성과, 되돌리지 마라 |
| VERIFY/log | `src/lib/engine/verify.ts`, `src/services/gate-runner.ts` | |
| 브라우저 E2E | `e2e/` | 회귀 방지 증거 — 수정해서 통과시키지 마라 |
| 확정 UI 계약 | `docs/UI_GUIDE.md` | ※ 잠정 |

## 6. 워크플로우 규약

작업 흐름은 **한 방향**이다. 리뷰 결과를 `phases/`로 되먹이지 않는다 — 되먹임이 만든 사고 기록은 `remediation/README.md`(2026-07-27 폐지)에 있다.

```
아이디어 → $grilling → docs/ 갱신 → $harness → 독립 세션에서 리뷰 한 번 → 끝
```

- 구현 phase: `$harness`로 step 설계 → `python3 scripts/execute.py <phase-dir>`
- 리뷰: phase 구현이 **전부 끝난 뒤 독립 세션에서** 한 번 — 범용은 내장 `/code-review <base>`, uptake 고유 검증 축(성공 위장·provenance)은 `$review <base>`. 판정만 하고 끝난다.
- 자기채점 리뷰는 무효다(ADR-008). step 실행기가 `--disable-slash-commands`로 스킬 호출 능력을 제거해 구현 세션이 자기 리뷰를 열지 못하게 한다.
- 에러 복구는 **종료코드로 갈린다**(정본: `.agents/skills/harness/SKILL.md`의 「에러 복구」).
  - `exit 1`(step 실패): `phases/<phase>/index.json`에서 해당 step의 `status`를 `"pending"`으로 되돌리고 `error_message`를 삭제한 뒤 재실행.
  - `exit 3`(하네스 오류): **index.json을 고치지 마라** — status는 이미 `pending`이고 커밋도 없다. 원인을 해소하고 같은 명령을 재실행한다. 타임아웃이었다면 실행기가 출력한 미커밋 목록을 먼저 확인한다.
- `stop-verify`의 차단은 세션당 1회다. **게이트를 통과하지 못한 채 `completed`로 끝난 step이 존재할 수 있으며**, 그 사실은 stderr의 `GATE STILL RED`에만 남는다. step이 `completed`로 커밋됐다는 것이 lint/build/test 통과를 뜻하지는 않는다.
