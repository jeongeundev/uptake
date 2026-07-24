# Step 1: triage

## 이 phase의 성격 (반드시 지켜라)

Python 하네스 도구다. **제품 코드(`src/`)·제품 문서(`docs/`)를 건드리지 마라. AC는 `pytest`다.** 자기검증·성공 위장 금지의 정신을 테스트에 적용한다.

## 읽어야 할 파일

- `/.agents/skills/remediate/CONTRACT.md` — 특히 **§5(상태 기계)·§5.1(category 라우팅)·§6(triage.json 스키마·검증 규칙)·§1(INV-2 무검증 수용 금지)**.
- `/scripts/remediate.py` — step 0에서 만든 것. `load_manifest`/`save_manifest`/기존 스타일을 재사용한다.
- `/scripts/test_remediate.py` — step 0 테스트. 여기에 이어서 triage 테스트를 추가한다.
- 이전 step 산출물: step 0이 `ingest`·`fingerprint`·manifest I/O를 만들었다(index.json step 0 summary 참고).

## 작업

`scripts/remediate.py`에 **`apply-triage`** 서브커맨드를 추가한다. `<root>/remediation/<loop-id>/cycle-<N>/triage.json`을 읽어 검증한 뒤 manifest에 반영한다(INV-1: manifest는 이 스크립트만 쓴다).

```python
def cmd_apply_triage(root, loop_id, cycle) -> int: ...
```

### triage.json 검증 (CONTRACT §6 — 하나라도 위반이면 비영 종료 + stderr 사유, manifest 미변경)

각 `decisions[F-NNN]` 항목에 대해:

1. **`evidence` 필수** — 비어있거나 없으면 거부(INV-2). category든 decision이든 예외 없다.
2. **`category` XOR `decision`** — 정확히 하나만 있어야 한다. 둘 다이거나 둘 다 없으면 거부.
3. `category`가 있으면 §5.1의 5개(`implementation_bug`·`contract_violation`·`test_gap`·`missing_feature`·`design_issue`) 중 하나여야 한다.
4. `decision`이 있으면 `rejected` 또는 `duplicate`. `duplicate`면 `canonicalId` 필수이고 그 대상이 manifest에 실재해야 한다.
5. 대상 finding은 그 사이클 시점에 상태가 `unresolved`여야 한다(아니면 거부 — triage는 unresolved만 대상).

### 반영 (category → 상태, CONTRACT §5.1)

검증을 모두 통과하면 각 finding에 적용한다:

- `category ∈ {implementation_bug, contract_violation, test_gap}` → 상태 `accepted`, `category` 기록.
- `category = missing_feature` → 상태 `deferred`, `category` 기록, `routedTo`(항목에 있으면) 기록.
- `category = design_issue` → 상태 `requires-human`, `category` 기록.
- `decision = rejected` → 상태 `rejected`.
- `decision = duplicate` → 상태 `duplicate`, `canonicalId` 기록.

모든 전이는 finding `history[]`에 `{cycle, from:"unresolved", to:<새상태>, by:"triage", evidence, at}`로 기록한다(`at`은 KST 타임스탬프). manifest `state`를 `"remediating"`으로 갱신한다(accepted가 하나라도 있으면), 저장.

## Acceptance Criteria

```bash
python3 -m pytest scripts/test_remediate.py -q
python3 -m pytest scripts/ -q
```

`test_remediate.py`에 아래 테스트를 추가하라(각 테스트는 ingest부터 커맨드로 상태를 만든다 — manifest 직접 편집 금지):

1. **정상 라우팅**: review-1 ingest 후, F-001→contract_violation·F-002→implementation_bug·F-003→test_gap·F-004→missing_feature(routedTo 포함)·F-005→missing_feature인 triage.json으로 apply-triage → F-001~003 `accepted`, F-004~005 `deferred`(routedTo 기록), 각 history에 by:"triage".
2. **근거 없는 거부(시나리오 ⑤ 확장)**: 어떤 항목이든 `evidence`가 비면 apply-triage가 비영 종료하고 **manifest가 변경되지 않는다**(전부-실패 원자성). category 항목도, rejected 항목도 동일하게 근거 필수.
3. **category XOR decision**: 한 항목에 category와 decision을 둘 다 주면 거부. 둘 다 없어도 거부.
4. **design_issue → requires-human**: category=design_issue인 finding이 `requires-human`이 된다(이후 Escalate 대상).
5. **rejected/duplicate**: rejected(근거 있음)→`rejected`. duplicate(canonicalId 실재)→`duplicate`+canonicalId 기록. canonicalId가 실재하지 않으면 거부.
6. **unresolved만 대상**: 이미 accepted인 finding을 다시 triage하려 하면 거부.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - category 오분류로 버그를 숨길 여지를 근거 필수로 막았는가(INV-2)?
   - missing_feature가 `deferred`로 가고 fix 대상(accepted)에 들어가지 않는가?
   - 검증 실패 시 manifest가 전혀 변경되지 않는가(원자성)?
3. 결과에 따라 `phases/remediate-loop/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "remediate.py apply-triage — triage.json 검증(evidence 필수·category XOR decision·unresolved만)·category→상태 라우팅(bug/contract/test→accepted, missing_feature→deferred, design_issue→requires-human)·history 기록. test: 라우팅·근거없음거부(원자성)·XOR·duplicate"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`src/`·`docs/`를 수정하지 마라.**
- **근거 없는 결정을 통과시키지 마라.** 이유: INV-2. category든 rejection이든 검증 없는 수용은 이 도구의 존재 이유를 부정한다.
- **missing_feature를 accepted로 만들지 마라.** 이유: remediation은 버그 수정 루프다. 미구현 기능은 deferred → /harness로 간다(§5.1).
- **검증 실패 시 일부만 반영하지 마라.** 이유: 부분 반영은 manifest를 모순 상태로 만든다. 전부 통과 아니면 전부 미반영(원자성).
- **다른 서브커맨드(closure-packet·ingest-closure·rule)를 만들지 마라.** 이유: 이후 step 범위.
- 기존 테스트를 깨뜨리지 마라.
