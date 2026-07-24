# Step 5: instantiate

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「추상 오라클 → 실행 오라클」·「치환 대상은 marker」·「위반 삽입 계약」·「두 층의 게이트」·「구현 중 결정」표의 **"INSTANTIATE의 LLM 경계"·"생성 산출물·diff 표현"** 행. 이 step이 그 두 행을 확정한다.
- `/docs/PRD.md` — **AC-3**(생성 차단 소프트 게이트).
- `/docs/ADR.md` — ADR-007(생성 게이트=corroborated)·ADR-008(자기채점 방지).
- 이전 step 산출물: `src/types/pattern.ts`, `src/lib/catalog/load.ts`(`generationEnabled`), `src/lib/engine/detect.ts`(`BindingDetection`), `catalog/spec-change-declaration-gate.json`. **step 4가 만든 fixture 타깃 경로**(index.json step 4 summary 참고).

## 작업

로드된 패턴 + 결합점 탐지 결과를 받아 **타깃-네이티브 생성물을 고정 템플릿으로 생성**한다. LLM을 쓰지 않는다(결정적).

### 시그니처

`src/lib/engine/instantiate.ts`:
```ts
type GeneratedFile = { path: string; content: string; role: string }; // path=타깃/워크스페이스 상대
type InstantiateResult =
  | { ok: true; files: GeneratedFile[]; injection: InstantiatedInjection; gateTestId: string }
  | { ok: false; reason: "generation-failed" | "injection-failed" | "generation-blocked"; detail: string };

function instantiate(pattern: Pattern, bindings: BindingDetection[]): InstantiateResult;
```

### 소프트 게이트 (AC-3)

진입 시 `pattern.capability === "generative" && pattern.evidenceStatus === "corroborated"`를 확인한다. 아니면 **생성하지 않고** `{ ok:false, reason:"generation-blocked" }`를 반환한다. `observed`·`descriptive` 패턴은 여기서 막힌다(ADR-007). checker 결합점이 `binding-unresolved`(타깃에 vitest 없음)면 타깃 부적격 → `generation-blocked`.

### 생성물 (고정 템플릿)

패턴 `spec-change-declaration-gate`에 대해 아래 2개 파일을 생성한다. 이식 흔적이 명확하도록 한 디렉토리(예: `uptake-gate/`)에 모은다:

1. **spec-artifact 생성물** — 선언 목록. `oracle.injection.targetRole`(=`spec-artifact`)의 산출물이며 **여기에 marker를 심는다**:
   ```ts
   // 파생: patternId=spec-change-declaration-gate, role=spec-artifact
   // 왜: 모든 실질 변경은 선언 목록에 기록되어야 하며, 게이트가 그 존재를 강제한다.
   export const declaredChanges: string[] = [<MARKER>];
   ```
   `<MARKER>` 자리에 **패턴 `oracle.injection.marker` 문자열을 그대로** 넣는다. 그러면 배열 요소가 되어 유효한 TS다. **marker를 코드에 하드코딩하지 말고 로드된 패턴에서 읽어라**(자기채점 방지 — ADR-008).

2. **spec-check 생성물** — 게이트 테스트. 이름은 **패턴 `oracle.gateTestId`와 일치**시킨다:
   ```ts
   // 파생: patternId=spec-change-declaration-gate, role=spec-check
   import { declaredChanges } from "./declared-changes";
   test("<GATE_TEST_ID>", () => {
     expect(declaredChanges.length).toBeGreaterThan(0);
   });
   ```
   `<GATE_TEST_ID>`는 패턴 `oracle.gateTestId`(=`"declared-change-present"`)에서 읽는다. blocking-gate role은 이 테스트가 vitest 스위트(게이트 커맨드)에 포함된다는 사실로 실현된다 — 별도 CI/hook 파일은 만들지 마라(over-engineering 금지).

각 생성 파일 블록에 **왜-주석 + provenance(patternId + role)**를 단다(ARCHITECTURE).

### marker 심기 계약 (CRITICAL)

- marker는 **spec-artifact 생성물에 정확히 1회** 나타나야 한다. 생성 후 실제로 세어서 확인하라. **0회 또는 2회 이상이면 `injection-failed`**로 반환한다(ARCHITECTURE·AC-7). marker의 등장은 uptake가 통제하므로 1회가 결정적으로 보장되어야 한다.
- `marker`/`replacement`는 **패턴에서 오지 생성 단계에서 지어내지 않는다**(ADR-008).

### 실행 오라클 산출 (같은 결속에서)

생성과 **같은 결속으로** `InstantiatedInjection`을 산출한다 — 따로 만들어 어긋나면 안 된다(ARCHITECTURE):
```
operation:   "replace"
path:        <spec-artifact 생성물의 워크스페이스 상대 경로>   // targetRole 산출물 경로 해석
marker:      pattern.oracle.injection.marker
replacement: pattern.oracle.injection.replacement
```

### 유예 항목 확정 (이 step에서 결정)

`/docs/ARCHITECTURE.md`「구현 중 결정」표의 **"INSTANTIATE의 LLM 경계"**(= 고정 템플릿, LLM 미사용, 결정적)와 **"생성 산출물·diff 표현"**(= `GeneratedFile[]` 파일 목록, 이 phase는 신규 파일 생성만 — 기존 파일 수정·삭제는 범위 밖)을 코드로 확정하고 summary에 명시한다. docs는 수정하지 마라.

### 테스트 (AC-3을 테스트로)

- `spec-change-declaration-gate` 패턴 + `target-vitest` fixture 바인딩 → `ok:true`, `files` 2개, spec-artifact 생성물에 marker **정확히 1회**, `gateTestId === "declared-change-present"`, `injection.marker`가 패턴 값과 일치.
- **결정성**: 같은 입력 두 번 → 동일 출력.
- **marker가 패턴에서 온다**: 패턴 marker를 다른 값으로 바꾼 fixture → 생성물의 marker도 따라 바뀌는지.
- **소프트 게이트**(AC-3): `evidenceStatus:"observed"`·`capability:"descriptive"`·둘 다인 패턴 fixture 각각 → `generation-blocked`.
- **injection-failed**: marker가 생성물에 0회/2회 되도록 조작한 케이스가 `injection-failed`인지.

## Acceptance Criteria

```bash
npm run build
npm run test    # instantiate 테스트 전부
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - marker·gateTestId가 **패턴에서 읽히는가**(하드코딩 아님)?
   - marker 1회 보장이 검사되고, 위반 시 `injection-failed`인가?
   - `InstantiatedInjection`이 생성물과 **같은 결속**에서 나오는가?
   - 소프트 게이트가 `observed`/`descriptive`를 차단하는가(AC-3)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/lib/engine/instantiate.ts — instantiate(pattern, bindings): 고정 템플릿 생성(declared-changes.ts + spec-gate.test.ts, uptake-gate/). marker는 패턴 oracle에서 읽어 spec-artifact에 1회 심기, InstantiatedInjection 동시 산출, gateTestId='declared-change-present'. 소프트게이트(AC-3), injection-failed 검사. LLM 미사용·GeneratedFile[] 확정"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **marker/replacement/gateTestId를 하드코딩하거나 생성 단계에서 지어내지 마라.** 이유: 생성기가 자기가 통과시킬 오라클을 함께 지으면 자기채점(tautology)이다(ADR-008). 반드시 로드된 패턴에서 읽어라.
- **LLM·Anthropic SDK를 쓰지 마라.** 이유: 이 MVP는 결정적 고정 템플릿으로 확정했다. 같은 입력에 같은 출력이어야 marker 1회 보장이 성립한다.
- **기존 파일 수정·삭제 생성물을 만들지 마라.** 이유: 이 phase의 생성물은 신규 파일뿐(범위 확정). 삽입 대상은 생성물뿐이며 타깃 기존 파일은 변조하지 않는다.
- **소프트 게이트를 우회하지 마라.** 이유: `observed`/`descriptive` 생성은 ADR-007 위반이다.
- 기존 테스트를 깨뜨리지 마라.
