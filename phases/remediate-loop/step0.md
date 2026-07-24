# Step 0: manifest-ingest

## 이 phase의 성격 (모든 step 공통 — 반드시 지켜라)

이것은 **하네스 도구**를 만드는 작업이다. Python이며, `scripts/execute.py`와 같은 계열의 결정적 CLI다.

- **제품 코드(`src/`)·제품 문서(`docs/`)를 절대 건드리지 마라.** 이 작업은 TypeScript/Next.js 제품과 무관하다.
- **AC는 `pytest`다. `npm`이 아니다.**
- 가드레일로 주입되는 `docs/PRD.md`·`ARCHITECTURE.md`·`ADR.md`의 CRITICAL 규칙은 *제품*에 대한 것이다. 다만 그 **정신**(자기검증·성공 위장 금지·실패는 정직하게)은 네가 짤 테스트에 그대로 적용한다.

## 읽어야 할 파일

- `/.agents/skills/remediate/CONTRACT.md` — **이 도구의 동결된 계약. 스펙 정본.** 특히 §2(레이아웃)·§3(review 스키마)·§4(fingerprint·매칭 규칙)·§5(상태 기계)·§10(CLI)·§1(불변식 INV-1~4).
- `/scripts/execute.py` — 같은 저장소의 결정적 하네스 도구. 코드 스타일·JSON I/O·타임스탬프(KST)·단일 기록자 패턴을 참고하라(흉내낼 대상).
- `/scripts/test_execute.py` — pytest 관례 참고.
- `/scripts/fixtures/remediation/review-1.json` — 실제 리뷰 fixture(5 findings). 이 step 테스트 입력. **수정하지 마라.**

## 작업

`scripts/remediate.py`를 새로 만든다. argparse 기반 서브커맨드 CLI이며, 이 step에서는 **`ingest`** 와 보조용 **`status`** 만 구현한다(나머지 서브커맨드는 이후 step에서 추가된다 — 지금 만들지 마라).

### 경로 규칙 (CONTRACT §10)

- 모든 명령은 `--root <dir>`를 받는다. 기본값은 repo 루트(이 파일 기준 `../`). `remediation/`·`phases/`는 이 루트 아래에서 resolve.
- manifest 경로: `<root>/remediation/<loop-id>/manifest.json`.
- ingest한 리뷰 파일은 provenance로 `<root>/remediation/<loop-id>/reviews/<reviewId>.json`에 보존(복사)한다.

### 핵심 함수 (시그니처 수준 — 구현은 재량)

```python
def fingerprint(evidence_files: list[str], spec: list[str], title: str) -> str: ...
    # CONTRACT §4의 알고리즘을 정확히 따른다:
    # sha1(normalizePath(files[0]) + "|" + ",".join(sorted(spec)) + "|" + slug(title)).hexdigest()[:12]
    # normalizePath: strip, ":" 뒤 라인번호 제거, "./" 접두 제거. files 비면 "".
    # slug: 소문자화, 영숫자/한글 외 → "-", 연속 "-" 축약, 앞뒤 "-" 제거.

def load_manifest(root, loop_id) -> dict | None: ...   # 없으면 None
def save_manifest(root, loop_id, manifest) -> None: ... # remediate.py만 쓴다(INV-1). indent=2, ensure_ascii=False.

def cmd_ingest(root, loop_id, review_path) -> int: ...  # 반환=exit code
```

### `ingest` 동작 (CONTRACT §3·§4)

1. review.json을 읽고 스키마를 검증한다. 위반(필수 필드 누락·severity/kind 값 오류 등)이면 **비영 종료 + stderr에 사유**. 성공 위장 금지.
2. manifest가 없으면 생성한다(`loopId`·`target`·`createdAt`·`state:"triaging"`·`currentCycle:1`·`maxCycles:2`·`findings:[]`·`cycles:[]`). `target`은 리뷰의 `target`에서 채운다.
3. 리뷰의 각 finding에 대해 `fingerprint`를 계산하고 manifest의 기존 finding과 대조해 **§4 매칭 규칙**을 적용한다:
   - 매칭 없음 → 새 `F-NNN`(순차, zero-pad 3) 부여, 상태 `unresolved`, `category:null`, `raisedInReview`·`firstSeenCycle:currentCycle` 기록.
   - 매칭 + 기존 상태 진행형(`unresolved`/`accepted`/`requires-human`) → 기존 ID 재사용, `detail` 갱신, 상태 유지(중복 계상 금지).
   - 매칭 + 기존 `resolved` → **재발**: `resolved → requires-human` 전이(history 기록, `by:"ingest"`, evidence에 "재발").
   - 매칭 + 기존 `rejected` → **불일치**: `rejected → requires-human` 전이.
   - 매칭 + 기존 `duplicate` 또는 `deferred` → 그대로 둔다.
4. finding 필드는 CONTRACT §9 manifest 스키마를 따른다(`severity`·`title`·`detail`·`specRefs`(=evidence.spec)·`evidenceFiles`(=evidence.files)·`category:null`·`canonicalId:null`·`routedTo:null`·`remediationStep:null`·`history:[]`).
5. `suggestedCategory`는 **자문일 뿐 저장하되 상태/category에 반영하지 마라**(권위 있는 category는 triage가 정한다 — INV-2).
6. 리뷰 파일을 reviews/ 로 보존한다. manifest를 저장한다(INV-1 단독 기록).

### `status` 동작

`<loop-id>`의 manifest를 읽어 finding별 `id·severity·category·state`와 사이클 요약을 사람이 읽을 형태로 stdout에 출력한다(디버깅·수동 확인용).

## Acceptance Criteria

```bash
python3 -m pytest scripts/test_remediate.py -q   # 이 step에서 추가하는 ingest 테스트
python3 -m pytest scripts/ -q                    # 기존 test_execute.py·test_tdd_guard.py 회귀 없음
```

`scripts/test_remediate.py`를 만들고 아래를 검증하는 테스트를 작성하라(`tmp_path`를 `--root`로 쓰거나 함수 직접 호출, 둘 다 가능):

1. **ingest 기본**: review-1.json ingest → manifest에 finding 5개, 전부 `unresolved`·`category:null`, ID `F-001`~`F-005`(순서대로), `state:"triaging"`.
2. **fingerprint 중복제거(시나리오 ⑦)**: 같은 review-1.json을 두 번 ingest → finding 여전히 5개(새 ID 생성 안 됨). 같은 (files[0],spec,title)은 같은 fingerprint.
3. **ID 안정**: 두 번째 ingest 후에도 각 finding의 ID·fingerprint가 최초와 동일.
4. **스키마 위반 거부**: 필수 필드가 빠진 리뷰 → 비영 종료(또는 예외), manifest가 오염되지 않음.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - fingerprint가 CONTRACT §4 알고리즘과 정확히 일치하는가(라인번호 제거·정렬된 spec·slug)?
   - manifest를 `remediate.py`만 쓰는가(테스트가 직접 manifest를 편집하지 않는가)?
   - `suggestedCategory`가 상태에 반영되지 않았는가?
3. 결과에 따라 `phases/remediate-loop/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "scripts/remediate.py — fingerprint()·manifest I/O(단독기록)·ingest(§4 매칭: 신규/진행형/재발/불일치/중복). status 커맨드. test_remediate.py: ingest·중복제거·ID안정·스키마거부. review-1 fixture 5 findings→unresolved"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **`src/`·`docs/` 제품 코드를 수정하지 마라.** 이유: 이건 Python 하네스 도구다. 제품과 무관.
- **이후 step의 서브커맨드(apply-triage·closure-packet·ingest-closure·rule)를 지금 만들지 마라.** 이유: scope 최소화. 각 서브커맨드는 자기 step에서 테스트와 함께 추가된다.
- **`suggestedCategory`를 권위 있는 category로 승격하지 마라.** 이유: 무검증 수용 금지(INV-2). category는 triage가 근거와 함께 정한다.
- **fixture(`scripts/fixtures/remediation/*.json`)를 수정하지 마라.** 이유: 실제 리뷰 데이터의 정합성이 수용 시나리오의 근거다.
- **manifest를 테스트에서 손으로 편집해 상태를 만들지 마라.** 이유: INV-1(단독 기록자). 상태는 커맨드를 통해서만 만든다.
- 기존 테스트를 깨뜨리지 마라.
