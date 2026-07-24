# Step 4: acceptance-e2e

## 이 phase의 성격 (반드시 지켜라)

Python 하네스 도구다. **제품 코드(`src/`)·제품 문서(`docs/`)를 건드리지 마라. AC는 `pytest`다.** 이 step은 새 서브커맨드를 만들지 않는다 — **실제 데이터로 전체 루프를 한 번 끝까지 돌려 닫는 수용 테스트**를 작성한다.

## 읽어야 할 파일

- `/.agents/skills/remediate/CONTRACT.md` — 전체 흐름(§0)·상태 기계(§5)·§5.1 라우팅·ruling(§8).
- `/.agents/skills/remediate/SKILL.md` — A~E 워크플로우 순서(이 테스트가 그 순서를 재현한다).
- `/scripts/remediate.py` — step 0~3에서 완성된 CLI(ingest·apply-triage·closure-packet·ingest-closure·rule·status).
- `/scripts/fixtures/remediation/review-1.json`·`review-2-closure.json` — 실제 2사이클 데이터. **수정하지 마라.**
- `/scripts/test_remediate.py` — 이어서 e2e 테스트 추가.
- 이전 step 산출물: step 0~3이 모든 서브커맨드를 만들었다.

## 배경 — 이 테스트가 실증하는 것

실제로 두 차례 수동으로 돈 리뷰→remediation 루프(0-mvp의 결함 3건이 0-fix로 수정됨)를 이 도구가 재현하는지 확인한다. 그리고 이번 실제 closure에서 드러난 핵심 분기 — **버그는 remediation으로 닫히고, 미구현 기능(missing_feature)은 remediation을 막지 않고 다음 개발 단계로 라우팅된다** — 를 실증한다.

## 작업

`scripts/test_remediate.py`에 **실제 fixture 기반 end-to-end 테스트**와 **CLI 스모크 테스트**를 추가한다. loop-id는 `0-mvp`, fix phase는 `0-mvp-fix-c1`을 쓴다.

### E2E: 실제 2사이클 → Ready + deferred 라우팅 (시나리오 ①+⑨)

`tmp_path`를 `--root`로 하여 SKILL.md의 A~E를 순서대로 실행한다:

1. **A. ingest**: `review-1.json`을 ingest → finding 5건(F-001~005) `unresolved`.
2. **B. triage**: `cycle-1/triage.json`을 구성해 apply-triage:
   - F-001 → `contract_violation`, F-002 → `implementation_bug`, F-003 → `test_gap` (근거 포함, 각 accepted)
   - F-004 → `missing_feature`, `routedTo:"1-user-ui-slice"` / F-005 → `missing_feature`, `routedTo:"1-argv-preview-ui"` (각 deferred)
   - 결과: F-001~003 accepted, F-004~005 deferred.
3. **C. fix phase(시드)**: 실제 execute.py 실행 대신, `<root>/phases/0-mvp-fix-c1/index.json`을 **완료 상태로 시드**한다(steps 전부 `completed`, `completed_at` 존재). 이 테스트의 목적은 remediation 루프의 부기·판정이지 실제 코드 수정이 아니다.
4. **D. closure**: `closure-packet --cycle 1` → `cycle-1/closure-packet.md` 생성(F-001~003 섹션, deferred 제외 확인). 이어 `review-2-closure.json`을 `ingest-closure --cycle 1` → F-001~003 `resolved`.
5. **E. rule**: `rule --cycle 1` → **verdict `Ready`**.

검증(assert):
- 최종 verdict `Ready`, gates G1~G6 전부 true.
- F-001~003 상태 `resolved`, 각 history에 `by:"closure"`.
- `ruling.deferredToImplementation`에 F-004·F-005가 `routedTo`와 함께 있고, 이들이 verdict를 `Ready`에서 끌어내리지 **않는다**.
- `ruling.openFindings`에 blocker/major accepted/unresolved가 없다.
- manifest `state == "ready"`.

### CLI 스모크

`subprocess`로 `python3 scripts/remediate.py <subcommand> ... --root <tmp>`를 최소 한 경로(예: ingest → status) 실행해 **argparse 배선이 실제로 동작**하고 exit code가 0이며 manifest가 생성됨을 확인한다(함수 직접 호출만이 아니라 CLI 진입점도 검증).

## Acceptance Criteria

```bash
python3 -m pytest scripts/test_remediate.py -q   # e2e + 스모크 포함 전체
python3 -m pytest scripts/ -q                    # 전체 회귀 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 실제 fixture로 전체 루프가 `Ready`로 닫히는가?
   - missing_feature 2건이 `deferred`로 라우팅되고 Ready를 막지 않으며 ruling에 명시되는가(조용히 사라지지 않는가)?
   - CLI 진입점이 subprocess로 동작하는가?
3. 결과에 따라 `phases/remediate-loop/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "test_remediate.py e2e — 실제 review-1→triage(bug/contract/test=accepted, missing_feature=deferred)→closure-packet→review-2 ingest-closure(resolved)→rule=Ready(①), deferred 2건 라우팅 비차단(⑨). CLI 스모크(argparse 배선)"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`src/`·`docs/`를 수정하지 마라.**
- **새 서브커맨드나 엔진 로직을 추가하지 마라.** 이유: 이 step은 수용 테스트만. 로직이 부족해 테스트가 안 되면 그것은 이전 step의 결함이니 error로 표면화하라(성공 위장 금지).
- **fixture를 테스트가 통과하도록 수정하지 마라.** 이유: fixture는 실제 데이터의 golden 근거다. 테스트가 실패하면 도구를 고쳐야지 데이터를 고치면 안 된다.
- **실제 execute.py를 이 테스트에서 호출하지 마라.** 이유: Codex 서브에이전트 실행은 느리고 비결정적이다. fix phase는 완료 상태로 시드해 판정 로직만 검증한다.
- 기존 테스트를 깨뜨리지 마라.
