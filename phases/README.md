# phases 대장

`/harness`가 설계하고 `scripts/execute.py`가 실행하는 step 묶음이 phase 단위로 쌓인다.

디렉터리는 **두 종류**이며 이름만으로는 구분되지 않는다. 판별 기준은 `index.json` 등재 여부다.

- **구현 phase** — `phases/index.json`에 등재된다. `/harness`로 설계하고 사람이 착수를 결정한다.
- **fix phase** — `*-fix-c<N>` 접미사. `/remediate` 루프가 triage 결과로 만든다. `phases/index.json`에 등재하지 않는다.

`step*-output.json`은 codex 실행 raw 로그이며 `.gitignore` 대상이다(로컬에만 존재).

## 구현 phase

| 디렉터리 | 다룬 것 |
|---|---|
| `0-mvp` | 엔진 — INSTANTIATE·VERIFY |
| `0-fix` · `0-fix2` | 0-mvp 리뷰 후속 |
| `remediate-loop` | `/remediate` 하네스 자체 구축 |
| `1-ui-vertical-slice` | UI·API·E2E 수직 슬라이스 |
| `2-authoring-pipeline` | 저작 파이프라인 (EXTRACT·ABSTRACT) step 0~9 |
| `2-fix` | `-final` 루프 F-001 해소 — `draft-store` 계약 변경 |

## fix phase

| 디렉터리 | 만든 루프 | 상태 |
|---|---|---|
| `1-ui-vertical-slice-fix-c1` | `remediation/1-ui-vertical-slice` | 유효 |
| `2-authoring-pipeline-final-fix-c1` | `remediation/2-authoring-pipeline-final` | 유효 |
| `2-authoring-pipeline-final-fix-c2` | 동 | 유효 |
| `2-authoring-pipeline-step-3-fix-c1` | `remediation/archive/2-authoring-pipeline-step-3` | **보관 루프 소산** |
| `2-authoring-pipeline-step-7-fix-c1` | `remediation/archive/2-authoring-pipeline-step-7` | **보관 루프 소산** |
| `2-authoring-pipeline-step-8-fix-c1` | `remediation/archive/2-authoring-pipeline-step-8` | **보관 루프 소산** |

보관 루프 소산인 세 개도 **실제 커밋을 만든 실행 기록**이라 지우거나 옮기지 않았다. 루프 자체가
무효라는 것과 그 루프가 고친 코드가 무효라는 것은 별개다 — step-3·step-7이 잡은 major는 실제로
resolved됐고, step-8의 findings는 `-final` 루프가 재리뷰해 흡수했다. 경위는
[`../remediation/README.md`](../remediation/README.md).

## 규약

- 리뷰는 phase 구현이 **전부 끝난 뒤** 한 번 돈다. **step 단위 루프를 만들지 마라** — phase 2에서 루프가 7개로 갈라진 사고의 원인이다.
- 구현 세션은 자기 리뷰를 돌리지 않는다(자기채점 = ADR-008 위반). `/harness` SKILL.md의 step 템플릿 금지 항목이 이를 강제한다.
- 실행이 끊겨 phase가 열린 채면 `python3 scripts/execute.py <phase-dir> --current-branch`로 마감시킨다. 이 마감이 `/remediate` 개시 전제조건이다.
