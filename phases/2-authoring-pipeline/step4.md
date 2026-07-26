# Step 4: oracle-selfverify

`generative` 초안에 `oracle`을 붙이고, **등재 전에 실제 VERIFY(양성 green + 음성 red)를 돌려 판별력을 입증**한다. 판별력을 보이지 못한 초안은 등재 후보가 되지 못한다(ADR-016).

## 이 step의 결정 사항 (문서가 phase 2에 유예해 둔 항목)

`oracle`의 실행 계약 부분 — `gateTestId`·`injection.marker`·`injection.replacement`·`injection.operation`·`expect` — 는 **앵커 형태에 대한 결정적 템플릿**에서 파생한다. LLM이 만들지 않는다.

LLM이 내는 것은 `oracle.violation` **서술 문장 하나뿐**이다(step 3에서 `proposeNarrative`로 이미 받았다).

이유: 실행에 쓰이는 문자열이 LLM 산출이면 결정성 경계가 흐려지고(ADR-015), 판별력 없는 oracle이 대량 생산되어 자기검증 게이트에 부하가 걸린다. 앵커 형태는 이미 알려진 형태이므로 템플릿으로 충분하다 — over-engineering 금지.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 (특히 자기검증: 양성 green **그리고** 음성 red / red는 exit code가 아니다)
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약"의 **oracle 초안 + 자기검증** 문단, "VERIFY 실행 계약" 절 전체, "게이트 결과 판별 — red의 정의"
- `/docs/ADR.md` — ADR-008(자기검증·성공 위장 금지), ADR-016(자기검증 oracle)
- `/catalog/spec-change-declaration-gate.json` — 씨앗 패턴의 `oracle` 값 (템플릿의 기준)
- `/src/lib/engine/verify.ts` — `prepareVerification`·`executeVerification`. 재사용 대상
- `/src/lib/engine/instantiate.ts` — step 1에서 역할 형태 매칭으로 바뀐 상태
- `/src/lib/engine/detect.ts` — `detectBindings`
- `/src/services/gate-runner.ts` — 게이트 실행과 리포터 판정
- `/tests/fixtures/target-vitest/` — 기존 타깃 fixture (형태 참고)
- `/e2e/fixtures.config.ts` — 런타임에 git 저장소 fixture를 만드는 기존 방식 (참고)
- `/src/__tests__/e2e-teardown.test.ts` — 임시 root 소유권 결속 teardown의 기존 규약 (반드시 지켜라)
- `/src/lib/engine/abstract.ts` — step 3의 `ContrastResult`

## 작업

### 1. `src/lib/engine/oracle-draft.ts` — 앵커 oracle 템플릿

```ts
export function draftAnchorOracle(
  pattern: Pattern,           // step 3의 초안 (oracle 없음)
  violation: string,          // proposeNarrative가 낸 서술
): { ok: true; pattern: Pattern } | { ok: false; reason: "not-anchor-shape"; detail: string };
```

- 초안의 role 형태가 앵커 3역할과 정확히 일치할 때만 oracle을 붙인다(step 1의 매칭 조건과 같은 기준을 쓰되, 판단 로직을 복제하지 말고 공용 헬퍼로 뽑아 양쪽이 같은 함수를 쓰게 하라).
- `gateTestId`·`injection`(operation/targetRole/marker/replacement)·`expect`는 상수 템플릿에서 온다. 씨앗 패턴 `catalog/spec-change-declaration-gate.json`의 `oracle` 값과 동일한 실행 계약이어야 한다.
- `violation`은 인자로 받은 서술을 그대로 넣는다. 비었으면 실패로 다루지 말고 템플릿 기본 서술을 쓰되, 서술이 규범적 단정("이렇게 해야 한다")이 되지 않도록 기본 문구를 서술형으로 적어라(ADR-006).
- `descriptive` 초안에는 절대 oracle을 붙이지 마라 — `capability`↔`oracle` 불일치는 층 1 로드 거부 사유다.

### 2. 번들 자기검증 fixture 타깃

`tests/fixtures/authoring-selfverify-target/`에 최소 JS/TS + vitest 저장소를 **저장소에 커밋되는 파일로** 만든다. `tests/fixtures/target-vitest/`와 같은 형태면 충분하다(`package.json`에 vitest devDependency, `vitest.config.ts`).

`verify.ts`는 타깃을 `git ls-files`로 복제하므로 **fixture는 실행 시점에 git worktree여야 한다.** 커밋된 fixture 디렉터리를 임시 위치로 복사한 뒤 `git init`+`commit`하는 헬퍼를 만들어라.

```ts
// src/lib/engine/selfverify-target.ts
export async function materializeSelfVerifyTarget(): Promise<{
  root: string;
  dispose: () => Promise<void>;
}>;
```

- `root`는 **이 호출이 생성한 임시 디렉터리**여야 한다.
- `dispose`는 **자신이 만든 root만** 삭제한다. 외부에서 받은 경로를 지우는 경로를 만들지 마라 — 과거 리뷰에서 실제로 발견된 결함이다(`src/__tests__/e2e-teardown.test.ts` 참조).
- 커밋된 fixture 원본은 절대 수정·삭제하지 않는다.

### 3. `src/lib/engine/self-verify.ts` — 저작-시점 자기검증

```ts
export type SelfVerifyResult =
  | { ok: true; frozenArgv: string[]; positiveLog: string; negativeLog: string }
  | { ok: false; status: string; detail: string };   // status는 VerifyOutcome의 실패 상태
```

```ts
export async function selfVerifyOracle(pattern: Pattern): Promise<SelfVerifyResult>;
```

동작:

1. fixture 타깃을 materialize한다.
2. `detectBindings(pattern, root)` → `instantiate(pattern, bindings)` → `prepareVerification(...)` → `executeVerification(...)`.
3. **`awaiting-approval`일 때만 `ok: true`**다. 그 밖의 모든 상태(`positive-failed`·`injection-failed`·`gate-error`·`negative-not-caught`·`timeout`)는 실패이며, status와 detail을 그대로 올려보낸다.
4. 성공·실패와 무관하게 fixture 타깃을 dispose한다.

`negative-not-caught`가 특히 중요하다 — 위반을 심었는데 게이트가 green이면 그 oracle은 판별력이 없다. **이 경우를 성공으로 계산하는 코드를 절대 만들지 마라.**

`descriptive` 패턴이 들어오면 자기검증을 건너뛰라는 판단은 **호출자(step 6)의 몫**이다. 이 함수는 oracle 없는 패턴을 받으면 실패를 반환하면 된다.

### 4. 테스트

- `oracle-draft.test.ts`: 앵커 초안에 oracle이 붙는다 / 앵커 아닌 형태는 `not-anchor-shape` / descriptive에는 붙지 않는다.
- `self-verify.test.ts`:
  - **정상**: 앵커 형태 + 템플릿 oracle이면 `ok: true`이고 양성 green·음성 red가 실제로 확인된다.
  - **판별력 없는 oracle 거부**: `injection.replacement`를 위반이 되지 않는 값으로 바꾼 패턴(예: 심어도 게이트가 여전히 통과하는 치환)을 넣으면 `negative-not-caught`로 실패한다. **이 테스트가 이 step의 핵심 증거다** — green만 보고 통과시키지 않는다는 것을 증명한다.
  - **정리**: 실행 후 임시 워크스페이스와 fixture 임시 root가 남지 않는다. 커밋된 fixture 원본이 변경되지 않았다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

자기검증 테스트는 실제 vitest를 하위 프로세스로 돌리므로 느리다. timeout이 필요하면 vitest의 per-test timeout을 늘려라. **테스트를 skip하거나 자기검증을 mock으로 대체하지 마라** — 실제로 red가 나오는지가 증명 대상이다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (green만으로 성공 처리하지 않았는가)
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`gate-error`·`timeout`을 음성 성공으로 계산하지 마라. 이유: 인프라 오류를 "위반을 잡았다"로 세는 것이 성공 위장의 가장 위험한 형태다(AGENTS.md CRITICAL · ADR-008).**
- **자기검증을 mock·스텁으로 대체하지 마라. 이유: 실제로 red가 나오는지를 증명하는 것이 이 게이트의 존재 이유다. mock된 자기검증은 아무것도 보장하지 않는다.**
- **`marker`·`replacement`·`gateTestId`를 LLM 산출로 채우지 마라. 이유: 실행에 쓰이는 값이 LLM에서 오면 결정성 경계가 무너진다(ADR-015). LLM 몫은 `violation` 서술뿐이다.**
- **`instantiate`가 oracle을 재생성하게 하지 마라. 이유: oracle은 저작 시점에 동결되어 파일로 남고 INSTANTIATE는 그것을 소비할 뿐이다 — 시간·파일 분리가 자기채점을 막는 구조다(ADR-016).**
- **fixture 원본 디렉터리나 외부에서 받은 경로를 dispose에서 삭제하지 마라. 이유: 실행이 소유하지 않은 디렉터리 삭제는 이미 한 번 발생한 결함이다.**
- **자기검증 실패를 "경고"로 낮춰 등재를 허용하지 마라. 이유: 검증 없이 등재된 oracle은 이식 때 `negative-not-caught`로 터진다. 비용을 저작 시점으로 앞당기는 것이 이 게이트의 목적이다.**
- 기존 테스트를 깨뜨리지 마라.
