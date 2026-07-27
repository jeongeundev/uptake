# phases 대장

`/harness`가 설계하고 `scripts/execute.py`가 실행하는 step 묶음이 phase 단위로 쌓인다.

**`phases/`에는 정방향 구현만 들어간다.** `/harness`로 설계하고 사람이 착수를 결정하며, `phases/index.json`에 등재된다.

리뷰 결과를 phase로 되먹이지 않는다 — 리뷰(`$review`)는 판정만 하고 끝난다. 고칠지는 사람이 정하고,
고친다면 그것은 새 작업이지 그 phase의 연장이 아니다.

아래 `*-fix-c<N>` 디렉터리들은 **remediation 루프를 쓰던 시기(~2026-07-27)의 기록**이며 새로 만들지 않는다.
그 루프의 스킬·엔진(`.agents/skills/remediate/`·`scripts/remediate.py`)은 제거됐고, 산출물(`remediation/`)과
아래 디렉터리는 실제 커밋을 만든 실행 기록이라 남겼다.

**아래 phase들의 step 파일에는 죽은 참조가 남아 있다** — `$remediate` 호출, `.agents/skills/remediate/CONTRACT.md`,
`scripts/remediate.py`, `scripts/fixtures/remediation/*.json`. 전부 2026-07-27에 제거된 것들이다.
해당 디렉터리: `remediate-loop` · `2-authoring-pipeline` · `2-authoring-pipeline-final-fix-c1` ·
`2-authoring-pipeline-step-8-fix-c1` · `3-survey` · `3-survey-fix-c1`.
step 파일은 실행 당시의 지시문 기록이라 소급 수정하지 않는다. 다만 `scripts/execute.py`의 `_invoke_agent`가
step 파일 **전문을 프롬프트에 붙이므로**, 위 phase의 step을 `pending`으로 되돌려 재실행하면 폐지된 지시가
그대로 주입된다. 전부 `completed`인 동안은 실행기가 에이전트를 다시 부르지 않아 무해하다 — 되돌리지 마라.

`step*-output.json`은 step 실행기의 raw 로그이며 `.gitignore` 대상이다(로컬에만 존재).
실행기가 실패했을 때 **진짜 원인이 남는 유일한 곳**이므로, 중단 시 `index.json`의 `error_message`가 아니라 이 파일의 `stderr`를 본다.

## 구현 phase

| 디렉터리 | 다룬 것 |
|---|---|
| `0-mvp` | 엔진 — INSTANTIATE·VERIFY |
| `0-fix` · `0-fix2` | 0-mvp 리뷰 후속 |
| `remediate-loop` | `/remediate` 하네스 자체 구축 — **역사**: 만든 것이 2026-07-27에 제거됐다 |
| `1-ui-vertical-slice` | UI·API·E2E 수직 슬라이스 |
| `2-authoring-pipeline` | 저작 파이프라인 (EXTRACT·ABSTRACT) step 0~9 |
| `2-fix` | `-final` 루프 F-001 해소 — `draft-store` 계약 변경 (**역사**: remediation 루프가 촉발한 phase) |
| `3-survey` | 발견 (SURVEY) — 저장소 1개 → 후보 → `observed`/`descriptive` 등재 step 0~8 |

## fix phase (역사 — 더 만들지 않는다)

| 디렉터리 | 만든 루프 | 상태 |
|---|---|---|
| `1-ui-vertical-slice-fix-c1` | `remediation/1-ui-vertical-slice` | 유효 |
| `2-authoring-pipeline-final-fix-c1` | `remediation/2-authoring-pipeline-final` | 유효 |
| `2-authoring-pipeline-final-fix-c2` | 동 | 유효 |
| `2-authoring-pipeline-step-3-fix-c1` | `remediation/archive/2-authoring-pipeline-step-3` | **보관 루프 소산** |
| `2-authoring-pipeline-step-7-fix-c1` | `remediation/archive/2-authoring-pipeline-step-7` | **보관 루프 소산** |
| `2-authoring-pipeline-step-8-fix-c1` | `remediation/archive/2-authoring-pipeline-step-8` | **보관 루프 소산** |
| `3-survey-fix-c1` | `remediation/archive/3-survey` | **보관 루프 소산** — 자기채점 |

보관 루프 소산인 세 개도 **실제 커밋을 만든 실행 기록**이라 지우거나 옮기지 않았다. 루프 자체가
무효라는 것과 그 루프가 고친 코드가 무효라는 것은 별개다 — step-3·step-7이 잡은 major는 실제로
resolved됐고, step-8의 findings는 `-final` 루프가 재리뷰해 흡수했다. 경위는
[`../remediation/README.md`](../remediation/README.md).

## 규약

- 리뷰는 phase 구현이 **전부 끝난 뒤 독립 세션에서** 한 번 돈다 — 범용은 내장 `/code-review <base>`, uptake 고유 검증 축은 `$review <base>`. 결과는 판정이지 새 phase가 아니다.
- 구현 세션은 자기 리뷰를 돌리지 않는다(자기채점 = ADR-008 위반). step 실행기가 `--disable-slash-commands`로 스킬 호출 능력을 제거해 이를 강제한다.
- 실행이 끊겨 phase가 열린 채면 `python3 scripts/execute.py <phase-dir> --current-branch`로 마감시킨다.
