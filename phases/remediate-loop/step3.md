# Step 3: rule

## 이 phase의 성격 (반드시 지켜라)

Python 하네스 도구다. **제품 코드(`src/`)·제품 문서(`docs/`)를 건드리지 마라. AC는 `pytest`다.**

## 읽어야 할 파일

- `/.agents/skills/remediate/CONTRACT.md` — 특히 **§8(hard gate G1~G6·중단조건·score·ruling.json)·§1(INV-4 점수 불가침)·§5(차단 상태)·§5.1(deferred는 비차단)**.
- `/scripts/remediate.py` — step 0~2 산출물. manifest I/O 재사용.
- `/scripts/execute.py` — fix phase의 `index.json` 형식(steps[].status, completed_at) 참고.
- `/scripts/test_remediate.py` — 이어서 테스트 추가.
- 이전 step 산출물: step 1(triage 라우팅)·step 2(closure로 resolved 도달).

## 작업

`scripts/remediate.py`에 **`rule`** 서브커맨드를 추가한다.

```python
def cmd_rule(root, loop_id, cycle) -> int: ...
```

### 사이클 캡 (CONTRACT §8)

- `cycle > manifest.maxCycles`(=2)면 **거부**: verdict `Escalate`, `escalationReasons=["cycle cap exceeded: cycle N > maxCycles 2"]`, ruling을 쓰고 manifest `state="escalated"`, **비영 종료**. 3번째 사이클을 자동 진행하지 않는다.

### hard gate 계산 (CONTRACT §8 — 전부 통과 = Ready의 필요충분)

manifest finding들과 fix phase index를 읽어 계산한다:

- **G1**: severity ∈ {blocker, major} 중 상태가 `unresolved` 또는 `accepted`인 finding 0건.
- **G2**: 상태 `requires-human` finding 0건.
- **G3**: 모든 blocker/major finding이 `resolved`/`rejected`/`duplicate`(duplicate면 canonical이 resolved/rejected). deferred는 여기 대상 아님(missing_feature는 blocker/major여도 gate 대상이 아니다 — 비차단).
- **G4**: `<root>/phases/<loop-id>-fix-c<N>/index.json`이 존재하고 `completed_at`이 있으며 error/blocked step이 없다. (없거나 error/blocked면 실패.)
- **G5**: `resolved`인 모든 blocker/major finding이 history에 `to:"resolved", by:"closure"` 항목을 가진다(클로저 리뷰로 닫힘 — 자기주장 아님).
- **G6**: 위 fix phase index의 모든 step `status == "completed"`.

**verdict = 모든 G1~G6 통과면 `Ready`, 아니면 `Escalate`.** (§5.1: `deferred`는 어떤 gate도 막지 않는다.)

### score (CONTRACT §8 — 자문용, 판정 불변 INV-4)

```
open_* = 상태가 unresolved|accepted인 finding을 severity별로 카운트 (deferred/requires-human 제외)
recurrence_count = requires-human 중 history에 to:"requires-human" & from:"resolved"가 있는 것
cycles_used = len(manifest.cycles) 또는 currentCycle 중 실제 진행 사이클 수
score = clamp(0,100, 100 - 8*open_major - 15*open_blocker - 3*open_minor - 1*open_nit - 10*recurrence_count - 5*max(0,cycles_used-1))
```

**score는 ruling에 기록만 한다. verdict를 절대 바꾸지 않는다.**

### ruling.json 생성 (CONTRACT §8)

`<root>/remediation/<loop-id>/cycle-<N>/ruling.json`을 §8 스키마로 쓴다:
- `verdict`·`gates`(G1~G6 bool)·`failedGates`(실패 ID+사유)·`escalationReasons`(requires-human ID·재발·gate 실패 등 구체)·`score`·`openFindings`(unresolved/accepted/requires-human ID)·`deferredToImplementation`(deferred finding의 `{id,title,routedTo}`)·`createdAt`·`readyForHandoff`(=verdict=="Ready")·`handoff`(=null).

manifest: `cycles[]`의 해당 사이클 `verdict`/`reasons` 갱신, `state`를 `Ready`면 `"ready"` / `Escalate`면 `"escalated"`. 저장. verdict를 stdout에 한 줄 출력(예: `Ready` 또는 `Escalate: <사유>`).

## Acceptance Criteria

```bash
python3 -m pytest scripts/test_remediate.py -q
python3 -m pytest scripts/ -q
```

`test_remediate.py`에 추가하라(fix phase index는 tmp root에 시드 — 예: `phases/<loop>-fix-c1/index.json`에 steps 전부 completed + completed_at):

1. **Ready 해피패스(시나리오 ①)**: review-1 ingest → triage(F-001~003 accepted, F-004/005 deferred) → closure-packet → review-2 ingest-closure(F-001~003 resolved) → 완료된 fix phase 시드 → rule --cycle 1 → **verdict Ready**, gates 전부 true, `deferredToImplementation`에 F-004·F-005(routedTo 포함), F-004/005가 Ready를 막지 않음.
2. **open blocker → Escalate(시나리오 ②)**: 한 finding이 blocker이고 accepted(closure 안 함) → rule → **Escalate**, G1 false, escalationReasons에 그 ID.
3. **점수가 blocker를 못 덮음(시나리오 ③, INV-4)**: 다른 조건은 pristine이라 score가 높게 나오도록 구성하되 open major 1건 존재 → **verdict Escalate**(score와 무관). 반대로 gate 전부 통과하지만 2사이클 사용·minor 잔존으로 score가 낮은 경우 → **verdict Ready**. 두 케이스로 "verdict는 gate로만, score는 자문"을 실증.
4. **requires-human → Escalate(시나리오 ⑥)**: design_issue로 requires-human이 된 finding 존재 → rule → **Escalate**, G2 false.
5. **fix phase 미완료 → Escalate**: fix phase index에 error step이 있거나 completed_at이 없음 → G4/G6 false → Escalate.
6. **사이클 캡(시나리오 ⑧)**: rule --cycle 3 → 거부(비영 종료), verdict Escalate, manifest state escalated.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - verdict가 오직 gate로만 결정되고 score가 절대 개입하지 않는가(INV-4)?
   - deferred(missing_feature)가 어떤 gate도 막지 않고 별도로 보고되는가?
   - G5가 "resolved는 클로저로 닫힌 것"만 인정하는가(자기주장 배제)?
3. 결과에 따라 `phases/remediate-loop/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "remediate.py rule — G1~G6 hard gate(deferred 비차단)·score(자문·판정불변 INV-4)·deferredToImplementation·cycle cap 거부·ruling.json(readyForHandoff/handoff seam). test: Ready(①)·open blocker(②)·점수불가침(③)·requires-human(⑥)·fix미완료·캡(⑧)"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`src/`·`docs/`를 수정하지 마라.**
- **score로 gate 결과를 바꾸지 마라.** 이유: INV-4. 총점으로 Blocker를 덮는 순간 hard gate의 의미가 사라진다.
- **deferred를 차단으로 계산하지 마라.** 이유: §5.1. missing_feature는 remediation 결함이 아니라 다음 개발 단계다.
- **G5 없이 resolved를 통과로 인정하지 마라.** 이유: 클로저 검증 없는 resolved는 자기주장이다(INV-3와 짝).
- **3번째 사이클을 자동 진행하지 마라.** 이유: 캡(§8). 무한 수정 루프 방지.
- 기존 테스트를 깨뜨리지 마라.
