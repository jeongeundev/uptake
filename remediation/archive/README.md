# 보관된 루프 — 판정 효력 없음

여기 있는 루프는 **계약 위반으로 생성되었거나 무효**다. 그 안의 `ruling.json`·`manifest.json`을
**현재 판정으로 읽지 마라.** 경위는 [`../README.md`](../README.md)가 정본이다.

지우지 않는 이유: 커밋 히스토리가 이 경로를 가리키고, 실패한 루프 기록 자체가 이 프로젝트가
실제로 어떻게 개발됐는지에 대한 증거다(ADR-008 — 실패는 정직하게 표면화한다).

| 보관 루프 | 기록된 판정 | 무효 사유 |
|---|---|---|
| `2-authoring-pipeline` | Ready (score 100) | **구현 완료 전 개시**. step 3도 끝나기 전에 열려 findings 0건으로 Ready를 기록했다. 이 phase의 정본은 `../2-authoring-pipeline-final` |
| `2-authoring-pipeline-step-1` | Ready | step 단위 루프 — 계약 위반. findings 0건 |
| `2-authoring-pipeline-step-2` | Ready | 동일 |
| `2-authoring-pipeline-step-3` | Ready | 동일. major 1건은 실제로 resolved |
| `2-authoring-pipeline-step-7` | Ready | 동일. major 1건은 실제로 resolved |
| `2-authoring-pipeline-step-8` | 없음 (`state: remediating`) | 동일. 미결 방치 → findings는 `-final` 루프가 재리뷰해 흡수 |

## loop-id 재사용 금지

`remediate.py`는 `remediation/<loop-id>/`가 없으면 새 루프를 열 수 있다(계약 §2.1 P3). 이동으로
위 6개 이름이 비었지만 **재사용하지 마라** — 같은 이름의 새 루프가 생기면 커밋 히스토리와
`../README.md`의 경위 기록이 어느 쪽을 가리키는지 알 수 없게 된다.

## 대응하는 fix phase

`phases/`에 남아 있다. 실제 커밋을 만든 실행 기록이므로 이동하지 않았다 —
[`../../phases/README.md`](../../phases/README.md) 참조.
