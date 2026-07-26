# remediation 루프 대장

`/remediate` 루프의 산출물이 루프별 디렉터리로 쌓인다. 계약 정본은
[`.agents/skills/remediate/CONTRACT.md`](../.agents/skills/remediate/CONTRACT.md)다.

## 명명 규칙

- `loop-id`는 **remediation 대상 구현 phase**를 가리킨다(예: `0-mvp`, `2-authoring-pipeline`).
- fix phase는 `phases/{loop-id}-fix-c<N>/`에 만든다.
- **step 단위 loop-id를 만들지 않는다.** 리뷰는 phase 구현이 전부 끝난 뒤 한 번 돈다.

## 루프 목록

| loop-id | 대상 phase | 개시 | 판정 | 비고 |
|---|---|---|---|---|
| `1-ui-vertical-slice` | `1-ui-vertical-slice` | 07-24 19:05 | Ready | major 3건 resolved |
| `2-authoring-pipeline` | `2-authoring-pipeline` | 07-26 15:56 | Ready | **무효** — step 3도 끝나기 전에 개시돼 findings 0건으로 Ready. `-final`이 정본 |
| `2-authoring-pipeline-step-1` | 동 phase step 1 | 07-26 16:01 | Ready | **규칙 위반**(step 단위 루프). findings 0건 |
| `2-authoring-pipeline-step-2` | 동 phase step 2 | 07-26 16:08 | Ready | **규칙 위반**. findings 0건 |
| `2-authoring-pipeline-step-3` | 동 phase step 3 | 07-26 16:19 | Ready | **규칙 위반**. major 1건 resolved |
| `2-authoring-pipeline-step-7` | 동 phase step 7 | 07-26 16:59 | Ready | **규칙 위반**. major 1건 resolved |
| `2-authoring-pipeline-step-8` | 동 phase step 8 | 07-26 17:22 | 없음 | **미결 방치 → `-final`로 흡수**(아래) |
| `2-authoring-pipeline-final` | `2-authoring-pipeline` | 07-26 17:55 | **Escalate** (cycle 2) | 구현 완료 후의 정본 루프. F-001 미해결 |

`2-fix` phase에도 같은 사고가 한 번 더 일어났다. step 1 실행 중 구현 세션이 스스로
`remediation/2-fix/` 루프와 `phases/2-fix-fix-c1/`을 만들어 돌렸다(커밋 `0182860`~`59a9243`).
자기채점 리뷰는 계약상 무효이므로(ADR-008, `docs/HANDOFF.md` 8절) 두 디렉터리를 삭제해 loop-id를
되찾았다. 그 루프가 지적한 `test-results/` ignore 누락은 정당한 발견이라 `.gitignore` 변경만 유지했다.
step 파일에 리뷰·remediation 금지 항목이 빠진 것이 원인이며, `/harness` 스킬의 step 템플릿에
그 항목을 못박아 재발을 막았다.

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

## 남은 blocker

`-final` 루프의 **F-001**(major, contract_violation) 하나다. 3번의 수정 시도(step-8-fix-c1,
final-fix-c1, final-fix-c2)를 견뎠고, 원인은 저작 입력 변경이 서버를 거치지 않아
`draft-store`가 폐기 시점을 알 수 없다는 구조다. `draft-store` 계약 변경이 필요해
remediation fix 범위를 넘으며, 새 구현 phase로 처리한다.
