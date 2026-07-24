# Remediation Loop — 계약 (CONTRACT)

이 문서는 review-remediation loop의 **동결된 계약**이다. `scripts/remediate.py`(결정적 엔진)와
`scripts/test_remediate.py`(수용 테스트)는 이 문서를 스펙으로 삼아 구현한다.
이 문서는 **하네스 기능**의 계약이며, 제품(`docs/PRD.md`·`ARCHITECTURE.md`·`ADR.md`)과 무관하다 — 섞지 마라.

## 0. 목표 흐름

```
implementation complete
→ review artifact 입력            (reviews/review-N.json — 사람/Codex가 생성, v1은 수동)
→ finding 구조화 + triage(분류)    (remediate.py ingest + Claude가 category 판정)
   ├─ bug/contract/test  → remediation fix phase (이 루프)
   ├─ missing_feature     → deferred → 새 구현 phase(/harness로 넘김, 이 루프 밖)
   └─ design_issue        → requires-human (ADR/사람, escalate)
→ (remediation 대상만) fix phase 생성  (Claude가 phases/{loop}-fix-cN 직접 작성)
→ execute.py로 수정                (기존 execute.py 그대로 호출)
→ closure review용 packet 생성      (remediate.py closure-packet)
→ Ready 또는 Escalate 판정          (remediate.py rule — hard gate + 자문 score)
```

**category가 두 하네스 사이의 라우팅 스위치다.** remediation은 "기존 코드의 버그 수정 루프"이고,
구현되지 않은 요구사항(`missing_feature`)은 같은 코드를 계속 고치는 게 아니라 **다음 개발 단계**(`/harness`의 새 구현 phase)로 분기한다.

## 0.1 계층 경계 (구현 하네스 ↔ 리뷰 하네스는 겹치지 않는다)

세 계층으로 나뉜다. 두 **스킬(워크플로우)**은 책임이 겹치지 않고, `execute.py`는 둘 중 어느 스킬도 아닌 **공용 실행기**다.

| 계층 | 정체 | 책임 |
|------|------|------|
| `execute.py` + phase/step 파일 형식 | 공용 **실행기**(runner) — 스킬 아님 | Codex step 실행·3회 자가교정·2단계 커밋 |
| `/harness` 스킬 | 구현 전용 워크플로우 | 문서 탐색·기능 논의·phase/step 설계·구현결과 Claude 검토 |
| `/remediate` 스킬 | 리뷰 루프 워크플로우 | 독립리뷰 ingest·triage·fix phase 생성(finding→)·독립 재리뷰·Ready/Escalate |

- **`/remediate`는 `/harness` 스킬을 호출하지 않는다.** fix phase를 직접 생성하고 `execute.py`를 직접 호출한다.
  재사용하는 것은 파일 형식과 실행기뿐이다(스킬이 아니다). 고칠 대상은 이미 accepted finding으로 확정돼 있어 /harness의 계획 단계가 불필요하다.
- **두 종류의 리뷰는 주체가 다르다.** /harness 말미의 "구현결과 Claude 검토"(구현자 자기점검)와, /remediate 입구의 **독립 Codex 리뷰**(제3자·적대적)는 별개다. 후자가 이 루프의 입력이다.

## 1. 역할 분리 (불변식)

| 주체 | 책임 | 하지 않는 것 |
|------|------|------------|
| `remediate.py` (결정적 스크립트) | ID 부여·fingerprint·manifest 기록·상태 전이 검증·hard gate·score·중단조건 | LLM 판단(triage), step 문서 작성 |
| Claude 메인 에이전트 (`/remediate` 스킬) | finding 검증·triage 결정(근거 필수)·remediation step 작성·클로저 해석 | manifest 직접 편집 |
| Codex 서브에이전트 (`execute.py`) | fix phase 구현 | triage·판정 |

- **INV-1 (단독 기록자):** `manifest.json`은 `remediate.py`만 쓴다. Claude는 `cycle-N/triage.json`으로 의사만 전달하고, 스크립트가 검증 후 반영한다. (execute.py가 index.json 단독 기록자인 것과 동형.)
- **INV-2 (무검증 수용 금지):** finding을 `rejected`로 옮기려면 비어있지 않은 `evidence`가 필요하다. 근거 없는 rejection은 스크립트가 거부한다.
- **INV-3 (자기주장 금지):** `resolved`는 **클로저 리뷰**(`ingest-closure`)로만 도달한다. fix 구현자가 스스로 resolved로 만들 수 없다.
- **INV-4 (점수 불가침):** quality score는 어떤 hard gate도 덮지 못한다. Ready는 hard gate 전부 통과가 **필요충분**.

## 2. 디렉터리 레이아웃

```
remediation/{loop-id}/
  manifest.json                # finding 원장 + 사이클 로그 — 단일 진실원 (스크립트 단독 기록)
  reviews/
    review-1.json              # 라운드 1 리뷰 아티팩트 (입력)
    review-2.json              # 라운드 2 = 사이클 1 클로저 리뷰 (입력)
  cycle-1/
    triage.json                # Claude의 triage 결정 + 근거 (입력 → 스크립트가 검증·반영)
    closure-packet.md          # 생성물: 사이클 1이 고친 finding만 재검토용
    ruling.json                # 생성물: Ready | Escalate + gate 결과 + score
  cycle-2/ ...
phases/{loop-id}-fix-c1/       # 실제 수정 = 일반 하네스 phase (execute.py가 실행). 0-fix 선례 그대로.
phases/{loop-id}-fix-c2/
```

`loop-id`는 remediation 대상 구현을 가리킨다(예: `0-mvp`).

## 3. review 아티팩트 스키마 (입력: `reviews/review-N.json`)

```jsonc
{
  "reviewId": "review-1",                 // 파일 식별자. 유일.
  "round": 1,                             // 1부터. 라운드 = 리뷰 회차.
  "kind": "full" | "closure",            // full=신규 전체 리뷰, closure=지정 finding 재검토
  "target": {
    "phase": "0-mvp",                     // 리뷰 대상 구현 phase
    "branch": "feat-0-mvp",
    "baseCommit": "c75691c"
  },
  "reviewer": "codex",                    // 리뷰 주체 (향후 자동 리뷰의 seam)
  "createdAt": "2026-07-24T15:00:00+0900",
  "findings": [
    {
      "id": null,                         // ingest 시 부여. 이미 있으면 그 값 고정.
      "severity": "blocker" | "major" | "minor" | "nit",
      "title": "양성 error taxonomy 오분류",
      "detail": "...",                    // 문제 서술
      "evidence": {
        "files": ["src/lib/engine/verify.ts"],   // provenance. files[0]=주근거.
        "spec": ["AC-7b"]                          // 위반 스펙/AC 참조 (없으면 [])
      },
      "suggestedFix": "...",              // 리뷰어 제안 (선택)
      "suggestedCategory": null,          // 리뷰어 제안 category (자문·선택). 권위 있는 값은 triage가 정한다(§5.1).
      "reviewerConfidence": "high" | "med" | "low",
      "closureVerdict": null             // closure 리뷰에서만: "resolved" | "still-open"
    }
  ]
}
```

- **full** 리뷰: 신규 finding을 제기한다. `closureVerdict`는 항상 `null`.
- **closure** 리뷰: `closure-packet.md`가 지정한 finding **만** 담고, 각 finding에 `closureVerdict`를 채운다. 신규 finding 금지.
- `suggestedCategory`는 리뷰어의 힌트일 뿐이다. 무검증 수용 금지(INV-2) — **권위 있는 category는 Claude가 triage에서 근거와 함께 확정**한다.

## 4. finding 안정 ID + fingerprint

- **ID**: `F-NNN`(3자리 zero-pad). 최초 제기하는 리뷰의 ingest에서 순차 부여, 이후 **불변**.
- **fingerprint** (같은 finding을 라운드 간 동일 인식):
  ```
  fingerprint = sha1(
      normalizePath(evidence.files[0]) + "|" +
      ",".join(sorted(evidence.spec)) + "|" +
      slug(title)
  ).hexdigest()[:12]
  ```
  - `normalizePath`: 앞뒤 공백 제거, `:` 뒤 라인번호 제거(`verify.ts:42`→`verify.ts`), `./` 접두 제거.
  - `slug(title)`: 소문자화, 영숫자/한글 외 문자를 `-`로 치환, 연속 `-` 축약, 앞뒤 `-` 제거.
  - `evidence.files`가 비면 `normalizePath` 자리에 `""`.
- ingest 시 새 리뷰의 각 finding fingerprint를 manifest의 기존 finding과 대조한다:
  - **매칭 없음** → 새 `F-NNN` 부여, `unresolved`.
  - **매칭 있고 기존 상태가 진행형(`unresolved`/`accepted`/`requires-human`)** → 기존 ID 재사용, `detail` 갱신, 상태 유지(중복 계상 금지).
  - **매칭 있고 기존 상태가 종결-무해 `resolved`** → **재발**. 기존 ID로 `resolved → requires-human` 전이(escalate).
  - **매칭 있고 기존 상태가 `rejected`** → **리뷰어 불일치**. `rejected → requires-human` 전이(escalate).
  - **매칭 있고 기존 상태가 `duplicate`** → 그대로 둔다(canonical로 흡수됨).
  - **매칭 있고 기존 상태가 `deferred`** → 그대로 둔다(재발 아님 — 아직 미구현이라 재검출되는 게 정상. escalate하지 않는다).
- fingerprint 안정성은 리뷰어가 근거(file+spec+title)를 일관되게 인용하는 데 의존한다 — v1의 알려진 한계.

## 5. 상태 기계

상태(7개): `unresolved` · `accepted` · `rejected` · `duplicate` · `resolved` · `requires-human` · `deferred`

```
(ingest)                        → unresolved
unresolved  --triage-->           accepted | deferred | rejected(근거필수) | duplicate(canonical필수) | requires-human
accepted    --ingest-closure-->   resolved            (closureVerdict=resolved)
accepted    --ingest-closure-->   accepted            (closureVerdict=still-open; 다음 사이클로)
resolved    --ingest(재발)-->      requires-human      (fingerprint 재출현)
rejected    --ingest(불일치)-->    requires-human      (fingerprint 재출현)
```

- **차단 상태**(remediation Ready 불가): `unresolved`, `accepted`, `requires-human`.
- **종결-무해**(remediation을 막지 않음): `resolved`, `rejected`, `duplicate`, `deferred`.
- `deferred`는 "유효하지만 remediation 대상이 아니라 새 구현 phase로 넘긴" finding이다(§5.1 missing_feature). remediation Ready를 막지 않지만 ruling에 별도로 기록된다.
- 허용되지 않는 전이는 스크립트가 거부한다(예: `unresolved → resolved` 직접 금지 — 반드시 accepted 경유).
- 모든 전이는 finding의 `history[]`에 `{cycle, from, to, by, evidence, at}`로 기록된다.

## 5.1 category — triage가 정하는 라우팅 스위치

triage에서 Claude가 각 유효 finding에 **category**(근거 필수)를 부여하고, category가 상태(disposition)를 **결정적으로** 정한다.
category는 finding의 *성격*(무엇인가), 상태는 *생애주기*(어디까지 왔나)로 직교한다.

| category | 뜻 | disposition | 상태 | remediation Ready |
|----------|-----|------------|------|-------------------|
| `implementation_bug` | 기존 코드가 의도대로 동작 안 함 | remediation fix phase | `accepted`→…→`resolved` | blocker/major면 **차단** |
| `contract_violation` | 계약·AC 위반(기존 코드가 스펙 어김) | remediation fix phase | `accepted`→…→`resolved` | blocker/major면 **차단** |
| `test_gap` | 기능은 맞으나 검증 부재/약함 | remediation fix phase | `accepted`→…→`resolved` | blocker/major면 **차단** |
| `missing_feature` | PRD에 있으나 아직 미구현(기존 코드 결함 아님) | **새 구현 phase → `/harness`로 넘김** | `deferred` (`routedTo` 기록) | **차단 안 함** (별도 기록) |
| `design_issue` | 새 ADR·신뢰경계 재정의 등 설계 판단 필요 | ADR/사람 | `requires-human` | **차단(Escalate)** |

- **remediation 대상은 `implementation_bug`·`contract_violation`·`test_gap`뿐이다.** 이들만 fix phase에 들어가 같은 코드를 고친다.
- `missing_feature`는 remediation이 처리하지 않는다 — `deferred`로 두고, ruling이 "다음 구현 단계로 라우팅"으로 보고한다. 실제 구현은 `/harness`의 새 phase가 맡는다(이 루프 밖).
- `design_issue`는 `requires-human`으로 escalate한다.
- category 오분류로 진짜 버그를 `deferred`에 숨기는 것을 막기 위해, **모든 category 판정은 triage.json의 `evidence`로 정당화**되어야 한다(§6). 근거 없으면 스크립트가 거부한다(INV-2).

## 6. triage.json 스키마 (입력: `cycle-N/triage.json`)

Claude가 작성 → `remediate.py apply-triage`가 검증 후 manifest 반영.
각 항목은 **유효 finding이면 `category`를**, 유효하지 않으면 **`decision`(rejected/duplicate)을** 준다. **모든 항목에 `evidence` 필수.**

```jsonc
{
  "cycle": 1,
  "decisions": {
    // 유효 finding — category가 라우팅을 결정(§5.1)
    "F-001": { "category": "contract_violation", "evidence": "verify.ts:88 — 양성 error가 positive-failed로 뭉개짐. AC-7b 위반 실재." },
    "F-002": { "category": "implementation_bug",  "evidence": "argv가 실행 후에만 반환됨(verify.ts). 표시 전 공개 불가." },
    "F-003": { "category": "test_gap",            "evidence": "runGate 전역 mock — 실제 파이프라인 미검증." },
    "F-007": { "category": "missing_feature",     "evidence": "PRD 「사용자 주도 UI」에 있으나 미구현. 기존 코드 결함 아님.",
               "routedTo": "1-user-ui-slice" },   // 새 구현 phase 제안명 (선택)
    "F-008": { "category": "design_issue",        "evidence": "신뢰경계 재정의 — 새 ADR 필요." },
    // 유효하지 않음
    "F-004": { "decision": "rejected",  "evidence": "해당 경로는 이미 X로 처리됨(파일:라인). 오탐." },
    "F-005": { "decision": "duplicate", "canonicalId": "F-001", "evidence": "F-001과 동일 원인." }
  }
}
```

category → 상태 매핑(스크립트가 적용):
- `implementation_bug`·`contract_violation`·`test_gap` → `accepted`(remediation 대상).
- `missing_feature` → `deferred`(+`routedTo` 기록). remediation fix phase에 넣지 않는다.
- `design_issue` → `requires-human`.

검증 규칙:
- **모든 결정에 비어있지 않은 `evidence` 필수**. 없으면 거부(INV-2 — category 오분류로 버그를 숨기는 것 방지 포함).
- 항목은 `category` 또는 `decision` **정확히 하나**를 가진다. 둘 다이거나 둘 다 없으면 거부.
- `category`는 §5.1의 5개 중 하나여야 한다.
- `decision: duplicate` → `canonicalId` 필수, 대상이 실재해야 함.
- 결과 상태가 현재 상태에서 허용되는 전이가 아니면 거부.
- triage 대상은 해당 사이클 시점에 `unresolved`인 finding만.

## 7. closure-packet.md (생성물)

`remediate.py closure-packet {loop-id} --cycle N` — 사이클 N에서 `accepted`이고 그 사이클 fix phase가 다뤘다고
기록된 finding **만** 담는다.

형식:
```markdown
# Closure Review — loop {loop-id}, cycle {N}

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] 양성 error taxonomy 오분류
- Spec: AC-7b
- 원문: {detail}
- 주장된 수정: phases/{loop}-fix-c1/step0 — {step summary} (commit {sha})
- 변경 파일: src/lib/engine/verify.ts, verify.test.ts
- 검증 항목: 양성 error가 gate-error/timeout으로 분류되는가 / 회귀 테스트 통과?
- Verdict: [ ] resolved  [ ] still-open (사유: ___)
...

## 출력
review-{N+1}.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
```

## 8. ruling.json 스키마 + hard gate + score (생성물)

`remediate.py rule {loop-id} --cycle N` — hard gate와 자문 score를 계산해 기록·출력한다.

### Hard gate (전부 통과 = 필요충분, INV-4)

| ID | 조건 |
|----|------|
| G1 | severity ∈ {blocker,major} 중 상태가 `unresolved`/`accepted`인 finding 0건 |
| G2 | 상태 `requires-human` finding 0건 |
| G3 | 모든 blocker/major finding이 `resolved`/`rejected`/`duplicate`(canonical이 resolved/rejected) |
| G4 | 최신 fix phase(`phases/{loop}-fix-cN`)의 index.json 상태가 `completed` |
| G5 | `resolved`인 blocker/major는 모두 클로저 리뷰 verdict `resolved`를 근거로 함(history에 `by:"closure"`) |
| G6 | 최신 fix phase의 모든 step이 `completed`(G4 재확인 — AC 실행 성공) |

- 판정: **모든 gate 통과 → `Ready`**. 하나라도 실패 → `Escalate`.
- `Ready`여도 minor/nit 잔존은 허용(보고만).
- **`deferred`(missing_feature)는 어떤 gate도 막지 않는다.** remediation의 Ready는 "리뷰된 코드의 결함이 해소됨"을 뜻하지 "제품이 기능 완성"을 뜻하지 않는다. 단, `Ready`여도 `deferred` finding은 `ruling.deferredToImplementation`에 반드시 **명시적으로 나열**되어 조용히 사라지지 않는다("다음 개발 단계: /harness로 N건 라우팅").

### 중단·escalation 조건

- Ready 판정 → 종료(Ready).
- 최대 **2 사이클**. `--cycle 3` 이상 요청 → 거부 후 Escalate.
- 재발(§4) / 리뷰어 불일치(§4) / `requires-human` 존재(G2) → Escalate.
- fix phase가 execute.py에서 `error`/`blocked`(G4/G6 실패) → Escalate.
- 캡 도달했는데 blocker/major 잔존 → Escalate.

### quality score (자문용, 판정 불변)

```
score = clamp(0, 100,
  100
  - 8  * open_major_count      // open = 상태가 unresolved|accepted
  - 15 * open_blocker_count
  - 3  * open_minor_count
  - 1  * open_nit_count
  - 10 * recurrence_count      // requires-human 중 history에 resolved→requires-human 있는 것
  - 5  * max(0, cycles_used - 1)
)
```
score는 `ruling.json`에 기록만 한다. **어떤 값이어도 gate 결과를 바꾸지 않는다.**

### ruling.json

```jsonc
{
  "loopId": "0-mvp",
  "cycle": 1,
  "verdict": "Ready" | "Escalate",
  "gates": { "G1": true, "G2": true, "G3": true, "G4": true, "G5": true, "G6": true },
  "failedGates": [],                    // 실패한 gate ID + 사유
  "escalationReasons": [],              // Escalate 시 구체 사유 (재발 finding ID 등)
  "score": 84,                          // 자문용
  "openFindings": [],                   // 차단 상태 finding ID (unresolved/accepted/requires-human)
  "deferredToImplementation": [         // missing_feature — 다음 구현 단계(/harness)로 라우팅. Ready를 막지 않음.
    { "id": "F-007", "title": "사용자 주도 UI vertical slice", "routedTo": "1-user-ui-slice" }
  ],
  "createdAt": "...",
  "readyForHandoff": false,             // 확장 seam (decision 9): Ready면 true
  "handoff": null                       // 확장 seam: 향후 auto-commit/PR 생성기가 채움
}
```

## 9. manifest.json 스키마 (단일 진실원)

```jsonc
{
  "loopId": "0-mvp",
  "target": { "phase": "0-mvp", "branch": "feat-0-mvp", "baseCommit": "c75691c" },
  "createdAt": "...",
  "state": "triaging" | "remediating" | "closing" | "ready" | "escalated",
  "currentCycle": 1,
  "maxCycles": 2,
  "findings": [
    {
      "id": "F-001",
      "fingerprint": "a1b2c3d4e5f6",
      "severity": "major",
      "category": "contract_violation",         // triage가 확정(§5.1). null이면 아직 미triage.
      "title": "...",
      "detail": "...",
      "state": "resolved",
      "raisedInReview": "review-1",
      "firstSeenCycle": 1,
      "specRefs": ["AC-7b"],
      "evidenceFiles": ["src/lib/engine/verify.ts"],
      "canonicalId": null,                       // duplicate일 때만
      "routedTo": null,                          // deferred(missing_feature)일 때 제안된 새 구현 phase명
      "remediationStep": "phases/0-mvp-fix-c1/step0.md",  // fix가 다룬 step (accepted 경로만)
      "history": [
        { "cycle": 1, "from": "unresolved", "to": "accepted", "by": "triage",  "evidence": "...", "at": "..." },
        { "cycle": 1, "from": "accepted",   "to": "resolved", "by": "closure", "evidence": "review-2 confirms", "at": "..." }
      ]
    }
  ],
  "cycles": [
    {
      "cycle": 1,
      "review": "review-1",
      "fixPhase": "0-mvp-fix-c1",
      "closureReview": "review-2",
      "verdict": "Ready",
      "reasons": []
    }
  ]
}
```

## 10. CLI 계약 (`scripts/remediate.py`)

```
python3 scripts/remediate.py ingest        <loop-id> <review.json>
python3 scripts/remediate.py apply-triage   <loop-id> --cycle N        # cycle-N/triage.json 읽어 반영
python3 scripts/remediate.py closure-packet <loop-id> --cycle N        # cycle-N/closure-packet.md 생성
python3 scripts/remediate.py ingest-closure <loop-id> <review.json> --cycle N
python3 scripts/remediate.py rule           <loop-id> --cycle N        # cycle-N/ruling.json 생성 + verdict 출력
python3 scripts/remediate.py status         <loop-id>                  # manifest 요약 출력 (선택)
```

- 모든 명령은 `--root <dir>`(기본값: repo 루트)를 받는다. `remediation/`·`phases/`는 이 루트 아래에서 resolve된다.
  수용 테스트가 임시 디렉터리에서 hermetic하게 돌 수 있게 하는 최소 장치다(추측 기반 유연성 아님).
- 모든 명령은 결정적이다. 잘못된 입력(스키마 위반·허용 안 되는 전이·근거 없는 rejection·사이클 캡 초과)은
  **비영으로 종료하고 사유를 stderr에 출력**한다. 성공 위장 금지.
- `ingest`/`apply-triage`/`ingest-closure`/`rule`은 manifest를 원자적으로 갱신한다.
- 타임스탬프는 KST(+09:00), execute.py와 동일 형식.

## 11. 확장 지점 (decision 9 — v1 범위 밖, seam만 남긴다)

- `reviews/review-N.json`이 리뷰 에이전트 자동 호출의 seam. v1은 수동 생성, 향후 리뷰 에이전트가 같은 스키마로 출력.
- `ruling.json`의 `readyForHandoff`/`handoff` 슬롯 + manifest의 branch·baseCommit·resolved 목록이 auto-commit/PR 생성기의 입력.
- CLI 서브커맨드 구조에 향후 `handoff` 추가.
- **v1은 auto-commit·PR 생성을 구현하지 않는다.**
