# HANDOFF — phase 2 착수 (카탈로그 저작 파이프라인)

> 이 문서는 새 세션이 현재 저장소 상태를 오해하지 않고 이어가기 위한 실행 계약이다. 이미 정본에 있는 요구사항·아키텍처·리뷰 상세를 반복하지 않고 경로로 참조한다.
>
> 기준 시각: 2026-07-26
> 현재 브랜치: `feat-2-authoring-pipeline`

## 1. 새 세션이 할 일

phase 2의 스코프·설계·step 문서가 전부 확정돼 있다. **다음 명령으로 구현을 시작하면 된다.**

```bash
python3 scripts/execute.py 2-authoring-pipeline
```

execute.py가 자동으로 처리하는 것: 브랜치 checkout(이 브랜치를 그대로 이어받는다), 가드레일 주입(AGENTS.md + docs/*.md를 매 step 프롬프트에 포함), step summary 누적, 실패 시 최대 3회 자가 교정, 코드/메타데이터 2단계 커밋, 타임스탬프 기록.

새 기능을 임의로 고르지 마라 — 범위는 아래 3절이 정본이다.

## 2. 현재 판정

- phase 0 엔진(INSTANTIATE·VERIFY), phase 1 UI/API/E2E 완료. 독립 review-remediation loop 최종 판정 **Ready** (score 100, open findings 0) — `remediation/1-ui-vertical-slice/cycle-1/ruling.json`
- phase 2 스코프를 정본 문서에 확정 (커밋 `9fa7977`) — 설계·결정만 반영했고 코드는 아직 손대지 않았다
- phase 2 하네스 step 0~9 설계 완료 — `phases/2-authoring-pipeline/`

## 3. phase 2 범위 — 정본 위치

- `docs/PRD.md` — "Phase 2 범위 — 카탈로그 저작 (EXTRACT·ABSTRACT)" + AC-C9(환각 봉쇄)·AC-C10(씨앗 보호)
- `docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약 (phase 2)"
- `docs/ADR.md` — ADR-014(저작을 앱 안으로 / 대상 지정 추출), ADR-015(결정성 경계: LLM 후보 + 결정적 게이트 + 사람 승인), ADR-016(자기검증 oracle)

한 줄 요약: EXTRACT·ABSTRACT를 오프라인 손 큐레이션에서 **앱의 런타임 기능**으로 들인다. 사용자가 소스 저장소 ≥2개와 의도를 지정하면 앱이 근거를 수집·대조해 초안을 제안하고, 사용자가 승인한 뒤에만 카탈로그에 기록한다.

## 4. step 설계에서 확정한 결정 (문서가 phase 2로 유예해 둔 항목)

step 문서에 녹아 있지만, **왜 그렇게 정했는지**는 여기가 정본이다.

| 결정 | 내용 | 근거 |
|---|---|---|
| 범위 | 엔진 + API + UI + E2E 풀 슬라이스 (step 0~9) | PRD의 "전체 흐름 연결(E2E 1건)" 요구를 이번 phase에서 닫는다 |
| proposer | 포트 + 결정적 스텁 + 실제 Anthropic 어댑터 | ARCHITECTURE 유예 표가 "EXTRACT의 LLM 경계"를 phase 2 확정 항목으로 지정 |
| generative role id | 앵커 vocabulary(`spec-artifact`·`spec-check`·`blocking-gate`) 고정. descriptive는 자유 | `instantiate`의 역할 형태 매칭이 결정적으로 성립하려면 role id가 고정돼야 한다 (ADR-014의 앵커 형태 한정과 일치) |
| oracle 초안 | `gateTestId`·`marker`·`replacement`는 결정적 템플릿, `violation` 서술만 LLM | 실행에 쓰이는 문자열이 LLM 산출이면 결정성 경계가 흐려진다 (ADR-015) · 자기채점 위험 최소 (ADR-008) |
| 모델 ID | `UPTAKE_PROPOSER_MODEL` 설정값으로 고정. **코드 폴백 기본값 금지**, 미설정 시 명시적 실패. 저작 세션 메타데이터에 기록 | 어떤 모델이 초안을 냈는지 기록으로 남아야 한다 |
| 실제 LLM 호출 | AC에서 제외. `npm run eval:proposer`(비차단) 또는 수동 smoke로 분리 | "LLM이 좋은 패턴을 뽑는가"는 게이트가 아니라 eval의 몫 (ADR-015) |
| 등재 | 스테이징에서 기록 전·후 하드 게이트를 모두 통과한 뒤에만 최종 경로로 원자적 이동. 실패 시 기존 catalog 완전 불변 | 최종 경로에 먼저 쓰면 검증 실패 시 이미 오염된 뒤이고 롤백이 또 실패할 수 있다 (AC-C10) |
| E2E | 스텁 proposer 주입, 결정적·오프라인. 스텁은 명시적 환경변수로만 활성화 | 증명 대상은 결정적 기계가 저작→등재→이식→검증을 잇는가다. 스텁이 기본값이면 성공 위장 |

## 5. step 구성

| # | name | 다루는 것 |
|---|---|---|
| 0 | `authoring-contract` | 저작 도메인 타입, proposer 포트, 앵커 role 상수, 불신 데이터 경계 블록, 결정적 스텁 |
| 1 | `instantiate-role-shape` | `patternId` 하드코딩 → 역할 형태 매칭 (부채 청산) |
| 2 | `source-extract` | HEAD SHA 고정, provenance resolve 재사용, 환각 후보 폐기 |
| 3 | `abstract-contrast` | 공통=role / 차이=binding, 사용자 입력 `independenceGroup`으로 corroboration 계산·강등 |
| 4 | `oracle-selfverify` | 앵커 oracle 템플릿 + 번들 fixture 타깃에 실제 VERIFY |
| 5 | `catalog-write` | 초안 승인 저장소 + 스테이징 검증 후 원자적 등재 |
| 6 | `authoring-api` | 저작 세션 저장소 + Route Handlers |
| 7 | `proposer-adapter` | Anthropic 어댑터, 모델 ID 설정 고정, 비차단 eval |
| 8 | `authoring-ui` | 초안 검토·승인 화면, UI_GUIDE 갱신 |
| 9 | `authoring-e2e` | 저작→등재→이식→VERIFY 관통 1건 + AC-C9 단언 |

step 1이 앞에 있는 이유: step 4의 자기검증은 저작이 부여한 **새 patternId**로 INSTANTIATE가 돌아야 성립한다.

## 6. 에러 복구

- **error**: `phases/2-authoring-pipeline/index.json`에서 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한 뒤 재실행한다.
- **blocked**: `blocked_reason`을 해결한 뒤 같은 방식으로 되돌려 재실행한다.
- **API 키 부재는 blocked 사유가 아니다.** step 7의 AC는 네트워크를 요구하지 않는다(`npm test`가 네트워크에 나가지 않는 것 자체가 AC다).

## 7. 완료된 제품 표면 (phase 1까지)

```text
catalog → target 적격성 → binding 탐지/입력 → generated add diff + frozen argv/cwd/timeout 사전 표시
→ positive/negative VERIFY → 서버측 승인 → apply
```

핵심 위치:

- UI: `src/components/catalog-bindings-wizard.tsx` (phase 1 확정 계약 — 재구조화 금지)
- Route Handlers: `src/app/api/`
- 서버 workflow/session: `src/services/workflow-store.ts`
- VERIFY/log: `src/lib/engine/verify.ts`, `src/services/gate-runner.ts`
- 브라우저 E2E: `e2e/vertical-slice.spec.ts` (회귀 방지 증거 — 수정해서 통과시키지 마라)
- 확정 UI 계약: `docs/UI_GUIDE.md`

## 8. phase 완료 후

1. Claude 자기점검 1회 — step 문서가 요구한 것과 실제 산출물 일치, AC 증거(성공 위장 없는지), CRITICAL 규칙, 범위 이탈.
2. 새 세션에서 `$remediate feat-2-authoring-pipeline` — 독립 리뷰 → triage → fix phase → 재리뷰 → Ready/Escalate.

자기점검과 독립 리뷰를 겹치지 마라. 깊은 적대적 리뷰는 remediate 입구의 독립 리뷰가 맡는다.
