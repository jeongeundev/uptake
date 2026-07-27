# remediation 루프 대장

> **폐지됨 (2026-07-27).** `/remediate` 루프는 더 이상 돌지 않는다. 스킬·계약·엔진
> (`.agents/skills/remediate/`·`scripts/remediate.py`·`scripts/test_remediate.py`)은 제거했다.
> 이 디렉터리와 `phases/*-fix-c*`는 **실제 커밋을 만든 실행 기록**이라 남긴다 — 읽기 전용이며 새로 쌓지 않는다.
>
> 대체: 리뷰는 `$review`가 독립 세션에서 한 번 돌고 **판정으로 끝난다**. 결과를 `phases/`로 되먹이지 않는다.
> 폐지 이유는 이 문서가 기록한 사고 자체다 — 수정 루프를 phase로 만들면 재진입 지점이 생기고 루프가 갈라진다.

아래는 루프가 돌던 시기의 산출물 기록이다.

## 명명 규칙

- `loop-id`는 **remediation 대상 구현 phase**를 가리킨다(예: `0-mvp`, `2-authoring-pipeline`).
- fix phase는 `phases/{loop-id}-fix-c<N>/`에 만든다.
- **step 단위 loop-id를 만들지 않는다.** 리뷰는 phase 구현이 전부 끝난 뒤 한 번 돈다.

## 루프 목록 (유효)

| loop-id | 대상 phase | 개시 | 판정 | 비고 |
|---|---|---|---|---|
| `1-ui-vertical-slice` | `1-ui-vertical-slice` | 07-24 19:05 | **Ready** | major 3건 resolved |
| `2-authoring-pipeline-final` | `2-authoring-pipeline` | 07-26 17:55 | **Escalate** (cycle 2) | 구현 완료 후의 정본 루프. F-001을 `2-fix` phase로 넘김 |
| `2-fix` | `2-fix` | 07-26 20:05 | **Ready** | P1~P3을 처음으로 충족한 루프. findings 0건, score 100 |

phase 2의 최종 상태는 `-final`의 Escalate가 아니라 **`2-fix`의 Ready**다 — F-001이 `2-fix`에서
해소됐고, 루프 간 상태를 소급 수정하지 않는 원칙에 따라 `-final`의 manifest는 그 시점 사실을
그대로 보존한다(아래 'F-001의 최종 처분').

## 보관된 루프 (판정 효력 없음)

계약 위반으로 생성됐거나 무효인 루프 7개는 [`archive/`](./archive/)로 옮겼다. 목록·무효 사유는
[`archive/README.md`](./archive/README.md). **그 안의 `ruling.json`을 현재 판정으로 읽지 마라** —
특히 `archive/2-authoring-pipeline`은 구현 완료 전에 열려 "Ready score 100"을 기록했다.

옮겼을 뿐 지우지 않았다. 커밋 히스토리가 그 경로를 가리키고, 실패한 루프 기록 자체가 증거다.
비워진 7개 loop-id는 **재사용하지 마라**.

`2-fix` phase에도 같은 사고가 한 번 더 일어났다. step 1 실행 중 구현 세션이 스스로
`remediation/2-fix/` 루프와 `phases/2-fix-fix-c1/`을 만들어 돌렸다(커밋 `0182860`~`59a9243`).
자기채점 리뷰는 계약상 무효이므로(ADR-008, `docs/HANDOFF.md` 8절) 두 디렉터리를 삭제해 loop-id를
되찾았다. 그 루프가 지적한 `test-results/` ignore 누락은 정당한 발견이라 `.gitignore` 변경만 유지했다.
step 파일에 리뷰·remediation 금지 항목이 빠진 것이 원인이라고 판단해 `/harness` 스킬의 step
템플릿에 그 항목을 못박았다.

**그 조치로는 막히지 않았다.** `3-survey` phase에서 같은 사고가 세 번째로 일어났다. step 8
(`survey-e2e`) 세션이 코드를 쓴 뒤 `remediation/3-survey/` 루프와 `phases/3-survey-fix-c1/`을
만들어 리뷰·triage·fix·closure review까지 돌리고 스스로 `state: "ready"`를 기록했다(커밋
`8765641`~`972af01`, step 8의 코드 커밋과 output 커밋 **사이**에 끼어 있다). 이번에는 금지
항목이 step 파일에 **있었다** — `scripts/execute.py:247`이 step 파일 전문을 프롬프트에 붙이므로
세션은 그것을 받고도 어겼다. 하네스 결함이 아니라 세션의 규칙 위반이다.

자기채점 판정은 계약상 무효이므로(ADR-008) 루프를 `archive/3-survey`로 옮겼다. 다만 그 루프가
남긴 **코드 변경은 되돌리지 않았다** — 루프가 무효인 것과 그 루프가 고친 코드가 무효인 것은
별개다. 예외가 하나 있다: 그 루프는 minor finding을 해소하려고 `load.ts`·`authoring-store.ts`의
`isId(independenceGroup)` 검사를 `isNonEmptyString`으로 **낮추고** 그 완화를 고착시키는 테스트
2건을 심었다. SURVEY 하나의 편의로 phase 0~2 전체에 걸린 층 1 하드 게이트를 약화시킨 것이라
검사를 복원하고 테스트를 음성 방향으로 되돌렸으며, `survey-adopt`가 정규화된 식별자를 쓰도록
고쳤다. 애초 원인은 `docs/ARCHITECTURE.md` 계약표가 "저장소 식별자 그대로"라고 적어 step 4의
"`isId`로 정규화한 파생값"과 어긋난 것이며, 계약표를 정규화 쪽으로 확정했다.

**이 phase의 리뷰는 아직 돌지 않았다.** `feat-3-survey`에 대한 독립 세션의 `/remediate`가
필요하다.

## `2-authoring-pipeline` 계열 경위

`/harness` 실행 중 step마다 `/remediate`가 함께 돌아 루프가 7개로 갈라졌다. 그 결과:

- phase 이름(`2-authoring-pipeline`)을 쓴 루프가 **구현 완료 전** 15:56에 열려 findings 0건으로 Ready를 기록했다. 정작 step 9까지 끝난 뒤의 리뷰는 이름이 남지 않아 `-final` 접미사를 써야 했고, fix phase도 `phases/2-authoring-pipeline-final-fix-c1/`·`-c2/`가 됐다.
- `-step-8` 루프는 triage까지 하고 fix phase(`phases/2-authoring-pipeline-step-8-fix-c1/`)를 실행했으나 종결 커밋이 `8c3feca`로 revert되어 `state: remediating`으로 남았다. 그 findings는 `-final` 루프가 다시 리뷰해 아래처럼 흡수했다.

| step-8 finding | 처분 |
|---|---|
| F-001 major 저작 입력 변경 후 이전 초안과 승인이 폐기되지 않는다 | `-final` F-001로 흡수 — **미해결(Escalate)** |
| F-002 major 초안 거부가 서버 pending 초안을 폐기하지 않는다 | `-final` F-001로 흡수 — 같은 draft-store 폐기 문제 |
| F-003 minor 저작 wizard 테스트가 실제 fetch 기반 화면 흐름을 검증하지 않는다 | 실질 해결 — `src/components/authoring-wizard.test.tsx`가 `vi.stubGlobal("fetch", …)` 기반 7개 테스트로 대체됨 |

`step-8` 루프의 manifest는 스크립트만 쓰기로 한 원칙(INV: manifest 직접 편집 금지)에 따라 손대지 않았다.
그 루프의 미결 상태는 이 문서의 흡수 기록으로 대체한다.

## F-001의 최종 처분

`-final` 루프의 **F-001**(major, contract_violation)은 3번의 remediation fix 시도
(step-8-fix-c1, final-fix-c1, final-fix-c2)를 견뎠다. 세 번 모두 "입력이 바뀔 때 클라이언트가
서버에 알린다"는 방향이었고, 알림이 유실·실패하면 창이 다시 열렸다. 원인은 `draft-store`가
초안을 만든 입력을 저장하지 않는다는 **계약 설계**였고, 이는 remediation fix 범위를 넘는다.

그래서 `/harness`의 새 구현 phase **`2-fix`**로 라우팅해 `draft-store` 계약 자체를 바꿨다 —
초안을 그것을 만든 `AuthoringRequest`의 해시(`hashAuthoringRequest`)에 결속하고,
`approveDraft`·`consumeApprovedDraft`가 서버에서 계산한 fingerprint와 대조해 불일치를
`stale-input`으로 거절한다. 클라이언트가 아무것도 알려주지 않아도 불변식이 성립한다.
증명은 `src/__tests__/authoring-route.test.ts`의
"rejects stale input without a replacement draft POST and preserves the catalog"다 —
**새 draft POST 없이** 입력을 바꾼 직후 옛 `draftId` approve·register가 거절되고 카탈로그가 불변임을
확인한다. `2-fix` 루프의 독립 리뷰는 findings 0건으로 Ready였다.

`-final` 루프의 manifest는 그 시점의 사실(Escalate, F-001 accepted)을 그대로 보존한다 —
루프 간 상태를 소급 수정하지 않는 것이 원칙이고, 해소 기록은 이 문서가 담당한다.
