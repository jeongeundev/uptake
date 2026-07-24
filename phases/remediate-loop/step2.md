# Step 2: closure

## 이 phase의 성격 (반드시 지켜라)

Python 하네스 도구다. **제품 코드(`src/`)·제품 문서(`docs/`)를 건드리지 마라. AC는 `pytest`다.** 성공 위장 금지의 정신을 테스트에 적용한다.

## 읽어야 할 파일

- `/.agents/skills/remediate/CONTRACT.md` — 특히 **§7(closure-packet)·§3(closure 리뷰 스키마·closureVerdict)·§5(상태 기계)·§4(재발 규칙 — resolved→requires-human)·INV-3(resolved는 클로저로만)**.
- `/scripts/remediate.py` — step 0·1 산출물. `load_manifest`/`save_manifest`/`ingest`의 fingerprint 매칭을 재사용한다.
- `/scripts/test_remediate.py` — 이어서 테스트 추가.
- `/scripts/fixtures/remediation/review-2-closure.json` — 실제 클로저 리뷰 fixture(F-001~003 resolved). **수정하지 마라.**
- 이전 step 산출물: step 1이 `apply-triage`로 finding을 accepted/deferred/requires-human으로 라우팅했다.

## 작업

`scripts/remediate.py`에 **`closure-packet`** 과 **`ingest-closure`** 두 서브커맨드를 추가한다.

```python
def cmd_closure_packet(root, loop_id, cycle) -> int: ...
def cmd_ingest_closure(root, loop_id, review_path, cycle) -> int: ...
```

### `closure-packet` (CONTRACT §7)

1. manifest에서 상태가 **`accepted`** 인 finding을 모은다(= 이 사이클 fix phase가 고쳐야 했던 대상). 없으면 비영 종료 + 사유("닫을 accepted finding 없음").
2. `<root>/remediation/<loop-id>/cycle-<N>/closure-packet.md`를 §7 형식으로 생성한다. finding마다: ID·severity·title·Spec(specRefs)·원문(detail)·주장된 수정(`phases/<loop-id>-fix-c<N>/` — manifest의 `remediationStep`이 있으면 그 경로)·변경 파일(evidenceFiles)·검증 항목·`Verdict: [ ] resolved  [ ] still-open`.
3. manifest `cycles[]`에 이 사이클 항목(`{cycle, fixPhase:"<loop-id>-fix-c<N>", review:null, closureReview:null, verdict:null, reasons:[]}`)이 없으면 추가한다. `state`를 `"closing"`으로. 저장.
4. **신규 finding 금지 안내 문구**(§7)를 packet 상단에 포함한다.

### `ingest-closure` (CONTRACT §3 closure·§5)

1. review.json을 읽는다. `kind`가 `"closure"`가 아니면 거부. **신규 finding(manifest에 없는 ID)이 있으면 거부**(클로저는 지정 finding만 — 신규는 별도 full 리뷰).
2. 각 finding(ID로 매칭)에 대해 `closureVerdict`를 적용한다:
   - `resolved` → 대상이 `accepted`여야 한다. `accepted → resolved` 전이, history `by:"closure"`, evidence에 리뷰의 detail 요약. (INV-3: resolved는 이 경로로만 도달.)
   - `still-open` → `accepted` 유지. history에 `{from:"accepted", to:"accepted", by:"closure", evidence:"still-open: ...", at}` 기록(다음 사이클 대상임을 남긴다).
   - 그 외 값 → 거부.
   - 대상이 `accepted`가 아니면(예: 이미 resolved) 거부 — 성공 위장 금지.
3. `closureVerdict`가 없는 finding이 있으면 거부(클로저 리뷰는 모든 대상에 verdict를 채워야 함).
4. 리뷰를 reviews/로 보존하고, manifest `cycles[]`의 해당 사이클 `closureReview`를 채운다. 저장.

**재발은 여기서 만들지 않는다.** 재발(resolved→requires-human)은 step 0의 `ingest`(신규 full 리뷰가 resolved fingerprint를 다시 제기)에서 일어난다 — §4. `ingest-closure`는 지정 finding의 verdict만 처리한다.

## Acceptance Criteria

```bash
python3 -m pytest scripts/test_remediate.py -q
python3 -m pytest scripts/ -q
```

`test_remediate.py`에 추가하라(전부 커맨드로 상태 생성):

1. **closure-packet 생성**: review-1 ingest → triage(F-001~003 accepted) → closure-packet --cycle 1 → `cycle-1/closure-packet.md`가 생성되고 F-001·F-002·F-003 섹션과 Verdict 체크박스를 포함. deferred(F-004/005)는 packet에 없다.
2. **ingest-closure resolved(시나리오 ①의 닫힘)**: 위 상태에서 review-2-closure.json ingest-closure --cycle 1 → F-001~003이 `resolved`, history에 by:"closure".
3. **still-open 유지**: F-001만 still-open, F-002/003 resolved인 클로저 리뷰(인라인 구성) → F-001 `accepted` 유지, F-002/003 resolved.
4. **신규 finding 거부**: 클로저 리뷰에 manifest에 없는 ID가 있으면 ingest-closure 거부.
5. **재발 → requires-human(시나리오 ④)**: review-1 ingest → triage accept F-001 → closure resolve F-001(이제 resolved) → **F-001과 같은 (files[0],spec,title)로 fingerprint가 같은 신규 full 리뷰를 인라인 구성해 `ingest`** → F-001이 `resolved → requires-human`이 된다(재발). history에 by:"ingest".
6. **INV-3**: accepted가 아닌 finding을 resolved로 만들려는 클로저(예: unresolved 상태 대상)는 거부.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - resolved가 오직 `ingest-closure`(클로저 리뷰)로만 도달하는가(INV-3)? 구현자 자기주장 경로가 없는가?
   - closure-packet이 accepted만 담고 deferred/rejected를 제외하는가?
   - 재발이 `ingest`에서 requires-human으로 잡히는가?
3. 결과에 따라 `phases/remediate-loop/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "remediate.py closure-packet(accepted만→cycle-N/closure-packet.md, 신규금지 안내)·ingest-closure(closure kind·신규ID거부·resolved는 accepted→resolved by:closure INV-3·still-open 유지). test: packet생성·resolved·still-open·신규거부·재발→requires-human(④)"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`src/`·`docs/`를 수정하지 마라.**
- **resolved를 클로저 리뷰 외의 경로로 만들지 마라.** 이유: INV-3. 구현자가 스스로 "고쳤다"고 선언하는 순간 독립 검증이 무너진다.
- **closure-packet에 deferred·rejected·미구현 finding을 넣지 마라.** 이유: 클로저는 "이 사이클이 고친 것"만 재검토한다(§7).
- **ingest-closure에서 재발을 처리하지 마라.** 이유: 재발은 신규 full 리뷰(ingest)가 잡는다. 역할 분리(§4).
- **다른 서브커맨드(rule)를 만들지 마라.** 이후 step 범위.
- 기존 테스트를 깨뜨리지 마라.
