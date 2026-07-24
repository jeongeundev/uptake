# Step 3: seed-catalog

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「패턴 스키마」·「직렬화 계약」·「추상 오라클 → 실행 오라클」. **패턴 JSON의 형태와 marker 계약이 여기 있다.**
- `/docs/ADR.md` — ADR-005(대조·독립성·생존자 편향 라벨)·ADR-006(서술적 태도)·ADR-008(자기채점 방지)·ADR-013(소스≠타깃).
- `/AGENTS.md` — provenance·서술적 태도 CRITICAL 규칙.
- 이전 step 산출물: `src/types/pattern.ts`(스키마 타입), `src/lib/catalog/load.ts`(로더).

## 배경

이 step은 **큐레이션**이다. 독립성·본질 판정은 이미 사람(큐레이터)이 내렸고, 아래에 그 판정이 전부 명시돼 있다. **너의 일은 이 판정을 정확한 JSON으로 직렬화하고, step 2 로더로 실제 로드되는지 검증하는 것이다.** 판정을 새로 내리거나 씨앗을 바꾸지 마라 — 그것은 환각이며 이 도구가 막으려는 것 자체다(ADR-005·009).

씨앗 repo는 이미 로컬에 받아져 있다 (`.uptake/sources/` 아래). 아래 revision·경로는 모두 `git show`로 resolve됨이 확인됐다.

## 작업

`catalog/spec-change-declaration-gate.json` **하나**를 만든다. `Pattern` 타입(`src/types/pattern.ts`)을 정확히 따른다.

### 패턴 명세 (큐레이터 판정 — 그대로 직렬화)

- `schemaVersion`: `1`
- `patternId`: `"spec-change-declaration-gate"` (파일명과 일치)
- `name`: `"변경 선언 게이트 (Change Declaration Gate)"`
- `capability`: `"generative"`
- `evidenceStatus`: `"corroborated"`
- `intent`: "선언되지 않은 변경의 병합을 막는다 — 모든 실질 변경은 사람이 읽는 선언 파일로 기록되고, 기계 검사가 그 존재를 강제한다." (문구는 다듬어도 되나 의도는 유지)

**roles (불변 구조 — 두 씨앗의 공통점):**
- `spec-artifact`: 변경을 사람이 읽는 형태로 선언하는 파일
- `spec-check`: 선언 파일의 존재·형식을 기계적으로 검사하는 규칙
- `blocking-gate`: 검사가 실패하면 병합/커밋을 차단하는 게이트

**bindingPoints (파라미터 — 씨앗 간 차이):**
- `spec-format` (kind: `"spec-format"`): 선언 파일 형식 (md / rst / …)
- `checker` (kind: `"checker"`): 검사 도구 (towncrier.check / pre-commit 정규식 / vitest …)
- `gate-location` (kind: `"gate-location"`): 게이트 위치 (CI workflow / pre-commit hook / …)
- `naming` (kind: `"naming"`): 선언 파일 네이밍 규약 (`<번호>.<type>.<ext>`)

**sources:**
```
id="backendai"
  repository="github.com/lablup/backend.ai"
  revision="ec253a618baa6a5a8f12885426c3ea7b8c2dea03"
  stack="python/towncrier+gha"   isTargetStack=false
  independenceGroup="lablup-backendai"
  independenceNote="lablup 조직 단독 유지. pytest와 fork·스캐폴딩 템플릿 관계 없음. 검사 도구(towncrier.check)와 게이트 위치(GitHub Actions PR job)가 pytest와 다르다. 단 towncrier 도구는 공유한다(tradeoffs에 명시)."

id="pytest"
  repository="github.com/pytest-dev/pytest"
  revision="a53a4d99c4ded7f30b712d57068d92243a731ce7"
  stack="python/towncrier+pre-commit"   isTargetStack=false
  independenceGroup="pytest-dev"
  independenceNote="pytest-dev 조직. lablup과 무관한 별개 프로젝트. 검사가 pre-commit 정규식(language: fail), 게이트가 pre-commit hook이라 backend.ai(GHA)와 결합점이 다르다."
```

**provenance (6개 — 각 role이 두 그룹 모두에서 관찰되어야 AC-2b 통과):**
```
{ sourceId="backendai", path="changes/12359.feature.md",                 observedRole="spec-artifact" }
{ sourceId="pytest",    path="changelog/12624.improvement.rst",          observedRole="spec-artifact" }
{ sourceId="backendai", path=".github/workflows/timeline-check.yml",     observedRole="spec-check" }
{ sourceId="pytest",    path=".pre-commit-config.yaml",                  observedRole="spec-check" }
{ sourceId="backendai", path=".github/workflows/timeline-check.yml",     observedRole="blocking-gate" }
{ sourceId="pytest",    path=".pre-commit-config.yaml",                  observedRole="blocking-gate" }
```
(backend.ai는 검사·차단이 한 워크플로우 파일에, pytest는 한 pre-commit 설정 파일에 있으므로 같은 path가 두 role의 근거가 된다 — 서로 다른 observedRole이면 정상이다.)

**oracle (generative 필수) — step 5·6과의 계약이므로 정확히:**
```
violation:  "선언 목록이 비어(선언 누락) 있는데도 게이트가 통과하는 상태. 올바른 이식은 이를 red로 거부해야 한다."
gateTestId: "declared-change-present"
injection:
  operation:   "replace"
  targetRole:  "spec-artifact"
  marker:      "/* @uptake:marker:begin */ \"seed-change\" /* @uptake:marker:end */"
  replacement: ""
expect: "red"
```
이 `marker`/`replacement`/`gateTestId`는 **패턴에서 오는 값**이다. step 5의 생성기가 이 marker를 spec-artifact 생성물에 심고, step 7(verify-orchestrator)이 `gateTestId`로 판정한다(step 6 gate-runner는 실행만 하고 오라클을 모른다). **자기채점 방지를 위해 이 값들은 생성 단계에서 지어내지 않는다**(ADR-008) — 그러니 여기서 확정한다.

**tradeoffs (서술적 태도의 물질적 형태 — ADR-006):**
"관찰 대상은 둘 다 성숙한 성공 OSS다(**생존자 편향** — 이 관습이 성공의 원인이라는 보장은 없다). 두 씨앗 모두 Python이고 towncrier를 공유한다: 스택-불변 본질(선언→검사→차단)은 대조로 확인됐으나, '변경을 fragment 파일로 선언한다'는 구체 형태가 towncrier 생태계의 공통 관습일 가능성은 배제하지 못한다. 다만 검사 도구·게이트 위치가 서로 다른 것(towncrier.check+GHA vs pre-commit 정규식+hook)이 '복사가 아님'의 기계적 증거다."

### 검증

- `.uptake/sources/`에 씨앗 repo가 있는 환경에서, step 2의 `loadCatalog("catalog", <sourceRoot>)`가 이 패턴을 **`loaded`에 담고 `generationEnabled === true`**로 계산하는지 확인하는 테스트를 추가한다.
- 씨앗이 없는 CI를 위해: 이 로드 통과 테스트는 **씨앗 부재 시 skip**하도록 가드하라 (예: source root의 두 repo 디렉토리 존재를 확인하고 없으면 `test.skip`). 단, **패턴 JSON의 구조 자체**(스키마 타입 적합, 참조 무결성 정합)는 씨앗 없이도 검사할 수 있으니 그 부분은 skip하지 마라.

## Acceptance Criteria

```bash
npm run build
npm run test    # 패턴 구조 테스트 통과 + (씨앗 있으면) 로드 통과 테스트
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 각 role의 provenance가 **두 independenceGroup 모두**에 있는가? (AC-2b)
   - 모든 source가 provenance에서 참조되는가? 모든 role이 참조되는가? (고아 없음)
   - `oracle.marker`/`replacement`/`gateTestId`가 위 명세와 **정확히 일치**하는가?
   - `tradeoffs`에 생존자 편향과 towncrier 공유가 정직하게 적혔는가? (ADR-006)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "catalog/spec-change-declaration-gate.json — corroborated/generative 패턴 1개(backend.ai@ec253a6 + pytest@a53a4d9). roles: spec-artifact/spec-check/blocking-gate. oracle marker='/* @uptake:marker... */', gateTestId='declared-change-present'. step2 로더로 로드 통과"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 (씨앗 부재 등) → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **씨앗·revision·경로·판정값을 바꾸지 마라.** 이유: 독립성·본질 판정은 큐레이터의 몫이고 이미 확정됐다(ADR-005). 임의로 다른 repo나 파일을 넣는 것은 근거 없는 승급 = 환각이다.
- **`oracle`의 marker/replacement/gateTestId를 새로 짓지 마라.** 이유: 자기채점 방지(ADR-008). 이 값들은 step 5 생성기와 step 7 판정기가 공유하는 계약이며 위에 고정돼 있다.
- **tradeoffs에서 생존자 편향·towncrier 공유를 빼지 마라.** 이유: 서술적 태도(ADR-006)는 약점을 숨기지 않는다. green만 보여주는 것이 성공 위장이듯, 정직한 라벨을 지우는 것도 위장이다.
- **패턴을 여러 개 만들지 마라.** 이유: 이 phase는 앵커 하나(변경 선언 게이트)만 깊게 간다(ADR-002). descriptive 패턴은 이 phase 밖이다.
- 기존 테스트를 깨뜨리지 마라.
