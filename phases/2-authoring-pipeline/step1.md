# Step 1: instantiate-role-shape

`instantiate`가 `patternId` 문자열로 템플릿을 매칭하는 하드코딩을 **역할 형태(role shape) 매칭**으로 바꾼다. 저작이 부여한 새 `patternId`를 가진 앵커 형태 패턴도 이식·자기검증되게 하기 위한 부채 청산이다. **합성의 범용화가 아니다.**

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약 (phase 2)"의 **INSTANTIATE 매칭 — 역할 형태** 문단, "패턴 스키마" 절
- `/docs/ADR.md` — ADR-008(자기검증·자기채점 금지), ADR-014(앵커 형태 한정)
- `/src/lib/engine/instantiate.ts` — 변경 대상
- `/src/lib/engine/instantiate.test.ts` — 기존 테스트
- `/src/lib/engine/verify.ts` — `freezeArgv`가 생성물의 `role === "spec-check"`에 의존한다는 사실을 확인하라
- `/catalog/spec-change-declaration-gate.json` — 씨앗 패턴 (roles가 앵커 3역할이다)
- `/src/services/proposer.ts` — step 0이 만든 `ANCHOR_ROLE_IDS`

## 작업

### 현재 상태

`src/lib/engine/instantiate.ts`에는 다음 하드코딩이 있다.

```ts
const supportedPatternId = "spec-change-declaration-gate";
...
if (pattern.patternId !== supportedPatternId || pattern.oracle === undefined) {
  return { ok: false, reason: "generation-failed", detail: `no fixed template is available for pattern ${pattern.patternId}` };
}
```

`patternId`가 정확히 저 문자열일 때만 생성한다. 저작이 새 patternId를 부여하면 이식도 자기검증도 불가능하다.

### 변경 계약

`patternId` 비교를 **역할 형태 매칭**으로 교체한다. 앵커 템플릿이 적용되는 조건은 다음 전부다.

1. `pattern.oracle`가 존재한다.
2. `pattern.roles`의 id 집합이 `ANCHOR_ROLE_IDS`(`spec-artifact`·`spec-check`·`blocking-gate`)와 **정확히 일치**한다 — 부분집합도, 초과 집합도 아니다.
3. `pattern.oracle.injection.targetRole === "spec-artifact"`.

하나라도 어긋나면 기존과 같이 `{ ok: false, reason: "generation-failed" }`를 반환한다. `detail` 문구는 patternId가 아니라 **역할 형태가 맞지 않는다는 사실**을 말하도록 고쳐라.

생성물의 내용·경로·역할·marker 처리 로직은 **바꾸지 마라.** 생성된 두 파일의 `role`은 지금처럼 각각 `spec-artifact`(=`injectionTemplate.targetRole`)와 `spec-check`여야 한다 — `verify.ts`의 `freezeArgv`가 `role === "spec-check"` 생성물을 찾아 argv를 동결하므로, 이 값이 바뀌면 VERIFY가 깨진다.

`supportedPatternId` 상수는 쓰이지 않게 되므로 제거한다. `ANCHOR_ROLE_IDS`는 `@/services/proposer`에서 import하라 — 같은 상수를 두 번 적지 마라.

### 테스트

`src/lib/engine/instantiate.test.ts`에 다음을 추가한다(기존 테스트는 유지·필요 시 최소 수정).

- **새 patternId + 앵커 3역할 → 생성 성공.** 씨앗 패턴을 복제해 `patternId`만 다른 값으로 바꾼 fixture로, 기존 성공 케이스와 동일한 산출물이 나오는지 확인한다. 이 테스트가 이 step의 핵심 근거다.
- **앵커 역할 하나가 빠진 패턴 → `generation-failed`.** (예: `blocking-gate` 없음)
- **앵커 3역할 + 추가 역할 하나 → `generation-failed`.** (정확히 일치가 아님)
- **`injection.targetRole`이 `spec-artifact`가 아님 → `generation-failed`.**

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

`npm test`에는 기존 `src/lib/engine/verify.test.ts`, `src/services/workflow-store.test.ts`, `src/__tests__/pipeline.integration.test.ts`가 포함된다. **이 셋이 전부 그대로 통과해야 한다** — 리팩터가 기존 이식 경로를 깨뜨리지 않았다는 증거다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **임의 패턴을 합성하려 하지 마라. 이유: 이 step은 하드코딩 부채 청산이지 합성 범용화가 아니다(ADR-014). 앵커 형태를 벗어난 `generative` 패턴은 여전히 `generation-failed`가 정답이다.**
- **역할 형태 매칭을 "roles가 3개면 통과" 같은 개수 기준으로 완화하지 마라. 이유: 의미가 다른 역할 3개짜리 패턴에 앵커 템플릿이 적용되면 근거 없는 생성물이 나온다.**
- **생성물의 `role` 값이나 marker 심기 로직을 바꾸지 마라. 이유: `verify.ts`의 `freezeArgv`가 `spec-check` 역할 생성물로 argv를 동결하고, marker 1회 등장 보장이 `injection-failed` 판정의 근거다(ADR-008).**
- **`instantiate`가 oracle을 만들어내게 하지 마라. 이유: 생성기가 자기 오라클을 지어내면 자기채점이다(ADR-008). oracle은 패턴에서 온다.**
- 기존 테스트를 깨뜨리지 마라.
