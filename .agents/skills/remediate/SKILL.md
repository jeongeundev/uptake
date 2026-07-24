---
name: remediate
description: uptake 저장소의 구현 브랜치 또는 기존 Codex 리뷰 결과를 대상으로 review-remediation loop를 끝까지 구동한다. 독립 리뷰를 생성·구조화하고 finding을 triage한 뒤, 대상 브랜치에서 fix phase를 실행하고 독립 closure review로 Ready/Escalate를 판정한다. 사용자가 "$remediate branch-or-phase", "remediation", "리뷰 결과 반영", "finding 처리", "Ready 판정"을 언급할 때 사용한다. 신규 기능 계획에는 /harness를, 단순 코드 수정에는 사용하지 않는다.
---

구현 완료 후 **review-remediation loop**를 대상 브랜치에서 끝까지 수행하라.
작업 전에 계약 정본 [`CONTRACT.md`](./CONTRACT.md)를 전부 읽어라.

`remediate.py`(결정적 부기)와 너(판단)의 역할이 분리돼 있다. **manifest를 직접 편집하지 마라** — 스크립트만 쓴다.

## 워크플로우

### A. 대상 확정 + 독립 full review

입력이 JSON 리뷰 파일이면 그 파일을 사용한다. 입력이 branch/phase이면 다음 순서로 리뷰를 자동 생성한다.

1. exact branch가 있으면 그것을 target branch로 쓴다. 없고 `feat-<입력>`이 있으면 그것을 쓴다. 둘 다 없으면 중단한다.
2. target branch를 checkout한다. 다른 브랜치에 있으면 tracked/untracked 변경이 하나라도 있을 때 중단하여 사용자 변경을 보호한다.
3. base는 명시값이 없으면 target branch와 `main`의 merge-base로 확정한다. target phase는 `phases/<입력>/` 또는 branch의 `feat-`를 뺀 이름으로 확정한다.
4. **독립 reviewer subagent**를 새로 생성해 `base..HEAD`만 검토시킨다. reviewer에게 구현·파일 수정·triage를 금지하고, 코드·스펙 근거가 실재하는 finding만 계약 §3의 full review JSON으로 반환하게 한다.
5. reviewer 결과를 `remediation/<loop-id>/reviews/review-1.json`에 기록한다. finding이 0개여도 빈 배열의 유효한 리뷰를 기록한다.

리뷰 agent를 만들 수 없는 환경이면 사용자가 리뷰 파일을 만들도록 떠넘기지 말고, 자동 리뷰를 수행할 수 없다고 명확히 Escalate한다. 독립성 보장을 위해 구현자인 메인 agent가 full review를 대신하지 마라.

review JSON을 저장하기 전 모든 evidence file과 spec ref가 target tree에 실재하는지 확인한다. 해소되지 않는 finding은 리뷰에 넣지 않는다.

```
python3 scripts/remediate.py ingest <loop-id> remediation/<loop-id>/reviews/review-1.json
```

스크립트가 ID·fingerprint와 manifest를 만든다.

### B. triage — 각 finding 검증 후 분류(category)

모든 `unresolved` finding을 코드·스펙에 비추어 메인 agent가 다시 검증한다. 유효하면 `category`, 유효하지 않으면 `decision`을 `cycle-N/triage.json`에 근거와 함께 기록한다.

- `implementation_bug` / `contract_violation` / `test_gap` → `accepted`, 이 루프에서 수정
- `missing_feature` → `deferred`, `/harness`의 새 구현 phase로 라우팅
- `design_issue` → `requires-human`, 즉시 Escalate
- 오탐 → `rejected`, 중복 → `duplicate`

버그를 `missing_feature`로 숨기지 마라. 분류 근거가 없으면 스크립트가 거부해야 한다.

```
python3 scripts/remediate.py apply-triage <loop-id> --cycle 1
```

accepted finding이 없으면 fix phase와 closure review를 만들지 말고 바로 `rule`을 실행한다.

### C. 대상 브랜치에서 fix phase 실행

`accepted` finding만 대상으로 `phases/<loop-id>-fix-c<N>/`을 직접 작성한다. `/harness` 스킬은 호출하지 않는다. step마다 finding ID, 근거 파일·스펙, 재현 테스트, 금지사항과 실행 가능한 AC를 명시한다.

실행 직전에 현재 branch가 manifest target branch와 같은지, worktree가 fix phase 파일 외에는 깨끗한지 확인한다. 사용자 변경이 섞여 있으면 중단한다. runner가 새 fix branch를 만들지 않도록 반드시 다음 명령을 쓴다.

```
python3 scripts/execute.py <loop-id>-fix-c<N> --current-branch
```

runner가 `error`/`blocked`로 멈추거나 target branch를 벗어나면 Escalate한다.

### D. 독립 closure review

packet을 만든 뒤 **full reviewer와도, fix 구현 agent와도 다른 새 reviewer subagent**를 생성한다.

```
python3 scripts/remediate.py closure-packet <loop-id> --cycle <N>
```

closure reviewer에게 packet의 finding만 검증시키고 신규 finding 제기·파일 수정을 금지한다. 결과를 `reviews/review-<N+1>.json`의 closure 스키마로 저장하고 ingest한다.

```
python3 scripts/remediate.py ingest-closure <loop-id> remediation/<loop-id>/reviews/review-<N+1>.json --cycle <N>
```

### E. rule — Ready 또는 Escalate

closure ingest 후 `accepted`가 남고 cycle < 2이면 아직 `rule`을 호출하지 말고 다음 cycle로 전이한 뒤 C부터 반복한다.

```
python3 scripts/remediate.py next-cycle <loop-id> --cycle <N>
```

accepted가 없거나 cycle cap에 도달했을 때 판정한다.

```
python3 scripts/remediate.py rule <loop-id> --cycle <N>
```

- Ready면 종료한다.
- cycle 2에도 blocker/major가 남거나 `requires-human`이면 Escalate한다.
- `escalationReasons`와 `deferredToImplementation`을 최종 응답에 그대로 보고한다.

## 원칙

- hard gate를 score로 덮지 마라.
- `resolved`는 closure ingest로만 만든다.
- manifest를 직접 편집하지 마라.
- 리뷰 agent와 구현 agent의 역할을 섞지 마라.
- auto-push·PR 생성은 하지 마라.
