---
name: remediate
description: uptake 저장소의 review-remediation loop를 구동할 때 사용한다. Codex 코드 리뷰 결과 파일을 입력받아 finding을 구조화·triage하고, 수정 phase를 생성해 execute.py로 고친 뒤, 클로저 리뷰로 Ready/Escalate를 판정한다. 사용자가 "remediation", "리뷰 결과 반영", "finding 처리", "Ready 판정"을 언급할 때 트리거된다. 신규 기능 계획에는 /harness를, 단순 코드 수정에는 쓰지 않는다.
---

이 저장소는 구현 완료 후 **review-remediation loop**로 리뷰 finding을 구조적으로 소화한다.
계약 정본은 [`CONTRACT.md`](./CONTRACT.md)다. 작업 전에 반드시 읽어라.

`remediate.py`(결정적 부기)와 너(판단)의 역할이 분리돼 있다. **manifest를 직접 편집하지 마라** — 스크립트만 쓴다.

---

## 워크플로우

### A. ingest — 리뷰 아티팩트 입력

사용자가 Codex 리뷰 결과(산문이든 표든)를 주면, 그것을 `reviews/review-N.json`(§3 스키마)으로 옮긴다.
**옮기는 것 자체가 검증의 시작이다** — finding을 그대로 받아적지 말고, 각 항목의 근거 파일·스펙 참조가 실재하는지 확인하며 구조화한다.

```
python3 scripts/remediate.py ingest <loop-id> remediation/<loop-id>/reviews/review-1.json
```

스크립트가 `F-NNN` ID·fingerprint를 부여하고 manifest를 만든다(신규 finding은 `unresolved`).

### B. triage — 각 finding 검증 후 분류(category)

**모든 `unresolved` finding을 코드·스펙에 비추어 직접 검증한다.** 리뷰 finding을 무검증 수용하지 마라(INV-2).
유효한 finding에는 **category**를, 유효하지 않으면 **decision**을 `cycle-N/triage.json`(§6)에 **근거와 함께** 적는다.

category가 라우팅을 결정한다(§5.1):

- `implementation_bug` / `contract_violation` / `test_gap` → **remediation 대상**(같은 코드 수정, fix phase로).
- `missing_feature` → **remediation 아님.** PRD에 있으나 미구현인 기능 → `deferred`로 두고 **`/harness`의 새 구현 phase로 넘긴다**(`routedTo`에 제안 phase명). 같은 코드를 계속 고치지 마라.
- `design_issue` → `requires-human`(새 ADR·설계 판단). → Escalate.
- 유효하지 않으면 `decision: rejected`(오탐, 근거 필수) 또는 `decision: duplicate`(canonicalId).

> **핵심 분기:** "버그냐, 아직 안 만든 기능이냐"를 가른다. 버그는 이 루프에서 고치고, 미구현 요구사항은 다음 개발 단계(/harness)로 보낸다. category 오분류로 진짜 버그를 `deferred`에 숨기지 않도록 근거로 정당화한다.

```
python3 scripts/remediate.py apply-triage <loop-id> --cycle 1
```

### C. remediation phase 생성 + 실행

`accepted` finding들을 고칠 fix phase를 **직접** 작성한다: `phases/<loop-id>-fix-c<N>/`.

- **`/harness` 스킬을 호출하지 않는다.** 고칠 대상이 이미 accepted finding으로 확정돼 있으므로, 문서 탐색·기능 논의 같은 /harness의 계획 단계는 거치지 않는다. 재사용하는 것은 `execute.py`가 읽는 **phase/step 파일 형식과 실행기뿐**이다(스킬이 아니라 공용 runner).
- step 문서에 어떤 finding(F-NNN)을 고치는지, 근거 파일·스펙·금지사항을 박는다(0-fix step 문서가 선례).
- 각 finding의 `remediationStep`이 어떤 step인지 manifest에 기록되도록, phase 이름을 `<loop-id>-fix-c<N>`로 맞춘다.
- 실행:

```
python3 scripts/execute.py <loop-id>-fix-c<N>
```

execute.py가 error/blocked로 멈추면 → 사람 개입(Escalate). 계약대로 조용히 넘어가지 마라.

### D. closure packet 생성 + 클로저 리뷰

이 사이클이 고친 finding **만** 재검토하는 packet을 만든다:

```
python3 scripts/remediate.py closure-packet <loop-id> --cycle <N>
```

생성된 `cycle-N/closure-packet.md`를 리뷰어(Codex)에게 넘겨 `review-<N+1>.json`(kind=closure)을 받는다.
v1은 이 리뷰 호출이 수동이다 — 사용자가 Codex를 돌려 결과 파일을 준다.

```
python3 scripts/remediate.py ingest-closure <loop-id> remediation/<loop-id>/reviews/review-<N+1>.json --cycle <N>
```

verdict가 `resolved`면 finding이 `resolved`로, `still-open`이면 `accepted`로 남는다.

### E. rule — Ready 또는 Escalate

```
python3 scripts/remediate.py rule <loop-id> --cycle <N>
```

- **Ready** → 루프 종료. hard gate(§8 G1–G6) 전부 통과. score는 자문일 뿐 판정에 영향 없다.
- **Escalate** → 사람에게 넘긴다. 사유(`escalationReasons`)를 사용자에게 그대로 전달한다.
- **아직 open인 accepted가 있고 사이클 < 2** → C로 돌아가 다음 사이클 phase를 만든다(still-open finding 대상).
- **사이클 2 도달했는데 blocker/major 잔존** → Escalate. 3번째 사이클은 스크립트가 거부한다.
- **`deferred`(missing_feature)가 있으면** — Ready여도 `ruling.deferredToImplementation`를 사용자에게 그대로 보고한다("다음 구현 단계: /harness로 N건"). remediation Ready ≠ 제품 기능 완성. 조용히 넘기지 마라.

---

## 원칙

- **hard gate와 score를 섞지 마라.** Blocker/Major가 남으면 총점이 아무리 높아도 Ready가 아니다(INV-4).
- **resolved는 클로저 리뷰로만.** 구현자가 스스로 resolved로 만들 수 없다(INV-3).
- **이 기능은 하네스 도구다.** 제품(`src/`, `docs/`)을 건드리지 않는다. remediation 대상 코드 수정은 fix phase에서 Codex가 한다.
- **v1 범위 밖**: 리뷰 에이전트 자동 호출, auto-commit, PR 생성. seam만 존재한다(CONTRACT §11).
