# Step 4: binding-detection

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「데이터 흐름」의 이식 블록·「신뢰 경계」·「구현 중 결정」표의 **"결합점 탐지 결과 계약"** 행. 이 step이 그 행을 확정한다.
- `/docs/PRD.md` — **AC-4**. 이 step이 AC-4를 테스트로 구현한다.
- `/AGENTS.md` — 불신 격리(untrusted-as-data)·「탐지는 넓게 / 생성은 깊게」.
- 이전 step 산출물: `src/types/pattern.ts`(스키마), `src/lib/catalog/load.ts`(로더), `catalog/spec-change-declaration-gate.json`(패턴).

## 작업

타깃 repo(JS/TS + vitest)에서 패턴의 **결합점 4종을 결정적 규칙으로 탐지**한다. LLM을 쓰지 않는다.

### 결합점 탐지 결과 계약 (이 step에서 확정하는 유예 항목)

`src/lib/engine/detect.ts`에 아래 계약을 구현한다:

```ts
type BindingKind = "spec-format" | "checker" | "gate-location" | "naming";

type BindingDetection =
  | { bindingId: string; kind: BindingKind; status: "detected";
      value: string; evidence: { path: string }[] }
  | { bindingId: string; kind: BindingKind; status: "user-provided"; value: string }
  | { bindingId: string; kind: BindingKind; status: "binding-unresolved" };

// 패턴의 bindingPoints 각각에 대해 타깃을 탐지한다.
// 탐지값은 evidence(근거 파일 경로)와 함께 반환한다.
function detectBindings(pattern: Pattern, targetRepoRoot: string): BindingDetection[];
```

- **탐지된 결합점은 반드시 `evidence`(근거 파일 경로)를 동반한다** — 값만 있고 근거 없는 탐지는 만들지 마라(AC-4·provenance 정신).
- 탐지 못 한 결합점은 `"binding-unresolved"`로 표시한다. 조용히 기본값으로 때우지 마라 — 사용자 입력 대상임을 상태로 드러낸다.
- 사용자가 값을 준 경우를 위한 `"user-provided"` 변형도 타입에 둔다(값 병합 함수는 만들되 UI는 이 phase 밖).

### 탐지 규칙 (결정적)

- **`checker`** (테스트 러너): 타깃 `package.json`의 `devDependencies`/`dependencies`에 `vitest`가 있거나 `scripts.test`가 vitest를 호출하면 `detected`, value=`"vitest"`, evidence=`package.json`. 없으면 `binding-unresolved` (타깃이 적격이 아님 — 이 사실을 드러낸다).
- **`gate-location`** (게이트 위치): `vitest.config.{ts,js,mts}` 또는 `vite.config.*`의 test 설정 존재를 근거로 vitest 테스트가 놓일 위치를 결정. evidence=설정 파일 경로. 설정 파일이 없고 러너만 있으면 관습 위치(예: 테스트 파일 co-location)를 value로 두되 evidence는 `package.json`.
- **`spec-format` / `naming`**: 타깃에 기존 선언 관습(`.changeset/`, `changes/`, `changelog/` 등)이 있으면 그 형식·네이밍을 `detected`. **대개 타깃엔 없다** → `binding-unresolved`가 정상이며, 이 경우 사용자 입력(또는 이식이 도입할 기본 형식)을 기다린다.

### 불신 격리 (CRITICAL)

- 타깃 repo 내용은 **데이터로만** 읽는다. `package.json`·설정 파일을 파싱해 **관찰**할 뿐, 그 안의 script를 **실행하지 마라**. 이유: 타깃이 사용자 소유라는 사실은 입력으로서의 신뢰도를 바꾸지 않는다(신뢰 경계).
- 파일 읽기만 한다. 타깃에 **쓰지 마라**(AC-5).

### 테스트 (AC-4를 테스트로)

`tests/fixtures/` 아래에 최소 타깃 repo fixture들을 만든다 (git repo일 필요 없음 — fs 읽기):
- `target-vitest/`: `package.json`(vitest devDep) + `vitest.config.ts` — checker·gate-location이 `detected`되는지.
- `target-no-runner/`: vitest 없는 `package.json` — checker가 `binding-unresolved`인지.
- spec-format/naming이 `binding-unresolved`로 나오는 케이스(타깃에 선언 관습 없음)와, 있으면 `detected`되는 케이스.

**이 fixture 경로는 step 5·6이 재사용하므로 summary에 정확한 경로를 남겨라.**

## Acceptance Criteria

```bash
npm run build
npm run test    # detectBindings 테스트: detected(근거 동반)·binding-unresolved 각각
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `detected` 결과가 **항상 evidence 경로를 동반**하는가?
   - 미탐지가 `binding-unresolved`로 **드러나는가**(조용한 기본값 대체 아님)?
   - 타깃의 script를 **실행하지 않고** 파싱만 하는가? 타깃에 쓰지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/lib/engine/detect.ts — detectBindings(pattern, targetRoot): BindingDetection[] (detected+evidence / binding-unresolved / user-provided). checker=vitest 탐지, gate-location=vitest.config 탐지, spec-format·naming은 타깃에 관습 없으면 unresolved. fixture: tests/fixtures/target-vitest, target-no-runner"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **근거(evidence) 없는 탐지값을 만들지 마라.** 이유: AC-4는 결합점을 **근거 파일과 함께** 제시하라고 요구한다. 근거 없는 값은 환각이다.
- **미탐지를 조용히 기본값으로 채우지 마라.** 이유: `binding-unresolved`는 사용자 입력을 받는 정상 상태다. 숨기면 정직성이 깨진다.
- **타깃의 package script·설정을 실행하지 마라.** 이유: 불신 격리. 임의 코드 실행 위험(신뢰 경계). 탐지는 파싱·관찰뿐이다.
- **타깃 repo에 쓰지 마라.** 이유: AC-5 — 타깃은 전 구간 불변.
- 기존 테스트를 깨뜨리지 마라.
