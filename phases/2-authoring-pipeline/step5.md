# Step 5: catalog-write

승인된 초안만 `catalog/<patternId>.json`으로 등재한다. 승인 저장소(pending→approved→consumed)와 **원자적 등재**를 구현한다.

## 이 step의 핵심 계약 — 실패해도 기존 catalog는 완전히 불변

등재는 다음 순서로만 일어난다.

```
1. 기록 전 하드 게이트   초안 객체를 층 1 규칙으로 검증
2. 임시 스테이징        catalog 밖이 아니라 catalog 하위의 임시 디렉터리에 파일을 쓴다
3. 기록 후 하드 게이트   스테이징 상태를 실제 카탈로그 로더로 다시 검증
4. 원자적 이동          최종 경로로 옮긴다. 최종 경로가 이미 있으면 거부한다
5. 정리                 스테이징 잔여물 제거
```

**"최종 경로에 먼저 쓰고 나서 검증한다"는 금지다.** 검증에 실패하면 이미 카탈로그가 오염된 뒤이고, 되돌리는 코드가 또 실패할 수 있다. 어느 단계에서 실패하든 `catalog/`의 기존 `.json` 파일은 **추가·수정·삭제 없이 그대로**여야 한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙, 두 층의 게이트
- `/docs/PRD.md` — "Phase 2 범위"의 요구사항 (승인 전 catalog 미기록 / 씨앗 보호 AC-C10 / 승인된 패턴은 기존 하드 게이트 통과)
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약"의 **초안 수명 · 승인 · 등재** 문단, "두 층의 게이트" 절, "상태 관리" 절
- `/src/services/approval-store.ts` — 재사용할 승인 저장소 패턴 (pending → approved → consumed, 1회 소비)
- `/src/services/approval-store.test.ts` — 그 계약의 테스트 형태
- `/src/lib/catalog/load.ts` — 층 1 하드 게이트의 정본. 여기서 검증 로직을 재사용한다
- `/src/lib/engine/apply.ts` — 기존 파일 쓰기 계약(경로 이탈 검사·기존 파일 덮어쓰기 금지)의 선례
- `/catalog/spec-change-declaration-gate.json` — 절대 덮어써서는 안 되는 씨앗 패턴

## 작업

### 1. `load.ts`에서 단일 패턴 검증을 재사용 가능하게

기록 전 게이트는 **파일을 쓰기 전에** 초안 객체를 검사해야 한다. `load.ts`의 `parsePattern`·`validateReferences`·`validateEvidence`·`validateProvenance`를 묶은 함수를 export하라.

```ts
export type PatternValidation =
  | { ok: true; pattern: Pattern }
  | { ok: false; reason: string };

export function validatePatternValue(
  value: unknown,
  filename: string,      // `<patternId>.json` — 파일명↔patternId 일치 검사에 쓰인다
  sourceRoot?: string,
): PatternValidation;
```

`loadCatalog`가 이 함수를 쓰도록 정리하되, **로더의 외부 동작·반환 형태·거부 사유 문자열은 바꾸지 마라.** 기존 `load.test.ts`가 그대로 통과해야 한다.

### 2. `src/services/draft-store.ts` — 초안 승인 저장소

`approval-store.ts`와 같은 형태로 만든다. 초안은 승인 전까지 **카탈로그에 쓰이지 않고** 서버 프로세스 수명의 in-memory 저장소에 있다.

```ts
export type StoredDraft = {
  sessionId: string;
  pattern: Pattern;                 // oracle 포함, 자기검증까지 통과한 최종 초안
  proposerMetadata: ProposerMetadata;
  status: "pending" | "approved" | "consumed";
};

export function createDraft(input: Omit<StoredDraft, "status">): string;   // draftId
export function approveDraft(draftId: string, sessionId: string): { ok: true } | { ok: false; reason: "unknown-draft" | "invalid-state" };
export function consumeApprovedDraft(draftId: string, sessionId: string): { ok: true; draft: StoredDraft } | { ok: false; reason: "unknown-draft" | "not-approved" | "already-consumed" };
export function __resetDraftStoreForTests(): void;
```

- `sessionId`가 일치하지 않으면 `unknown-draft`로 다룬다 — 다른 세션의 초안 존재 여부를 노출하지 마라.
- 승인은 `pending`에서만 가능하고, 소비는 `approved`에서 한 번만 가능하다.
- 저장된 `pattern`은 방어적으로 복사해 외부 변조를 막아라.

### 3. `src/lib/catalog/write.ts` — 원자적 등재

```ts
export type RegisterResult =
  | { ok: true; path: string }
  | {
      ok: false;
      reason:
        | "pattern-exists"          // 최종 경로에 이미 파일이 있다 (씨앗 보호)
        | "pre-write-rejected"      // 기록 전 하드 게이트 실패
        | "post-write-rejected"     // 스테이징 상태의 하드 게이트 실패
        | "write-failed";
      detail: string;
    };

export function registerPattern(
  pattern: Pattern,
  catalogDir: string,
  sourceRoot?: string,
): RegisterResult;
```

구현 계약:

**a. 기록 전 게이트.** `validatePatternValue(pattern, \`${pattern.patternId}.json\`, sourceRoot)`가 실패하면 파일을 만들지 않고 `pre-write-rejected`.

**b. 스테이징.** `catalogDir` **안에** 임시 디렉터리를 만든다(예: `.staging-<uuid>/`). 같은 파일시스템이어야 다음 단계의 이동이 원자적이다. 그 안에 `<patternId>.json`을 쓴다.
- 디렉터리 이름은 `.json`으로 끝나지 않아야 한다 — `loadCatalog`는 `.json` 파일만 읽으므로 스테이징 중에도 기존 카탈로그 로드에 영향이 없다. 이 점을 주석으로 남겨라.

**c. 기록 후 게이트.** `loadCatalog(stagingDir, sourceRoot)`를 호출해 `loaded`가 정확히 1건이고 `rejected`가 비어 있는지 확인한다. 아니면 `post-write-rejected`. **실제 로더로 다시 검증하는 것이 요점이다** — 직렬화·역직렬화를 거친 뒤에도 통과하는지 확인해 "등재 후 자기 거부"를 막는다.

**d. 원자적 이동.** 스테이징 파일을 `catalogDir/<patternId>.json`으로 옮긴다. **최종 경로가 이미 존재하면 등재를 거부하고 기존 파일을 건드리지 않는다**(`pattern-exists`). 존재 확인과 이동 사이에 틈이 생기지 않는 방식을 쓰라 — 대상이 있으면 실패하는 링크 연산 후 스테이징 파일을 지우는 방식이 그 성질을 만족한다. 덮어쓰는 이동 연산을 무방비로 쓰지 마라.

**e. 정리.** 성공·실패 어느 경로에서도 스테이징 디렉터리를 제거한다. 정리 실패가 등재 성공 판정을 뒤집지는 않되, 조용히 삼키지 말고 detail에 남겨라.

경로 안전: `patternId`는 이미 `isId`(kebab-case)로 검증되지만, 최종 경로가 `catalogDir` 안인지 다시 확인하라(`apply.ts`의 경로 이탈 검사 방식 참고).

### 4. 테스트 — `src/lib/catalog/write.test.ts`, `src/services/draft-store.test.ts`

`write.test.ts`는 임시 catalog 디렉터리와 소스 fixture로 실행한다.

- **정상 등재**: 파일이 생기고 `loadCatalog`로 다시 읽힌다.
- **씨앗 보호(AC-C10)**: 같은 patternId로 두 번 등재하면 두 번째는 `pattern-exists`이고, **기존 파일의 바이트가 변하지 않는다**. 파일 내용을 등재 전후로 비교해 증명하라.
- **기록 전 거부**: provenance가 resolve되지 않는 패턴은 `pre-write-rejected`이고, **catalog 디렉터리에 `.json` 파일이 하나도 늘지 않는다.**
- **기록 후 거부**: 로더만 잡아내는 위반(예: `capability`↔`oracle` 불일치)을 넣으면 `post-write-rejected`이고, 역시 최종 경로에 파일이 생기지 않는다.
- **스테이징 잔여물 없음**: 성공·실패 모든 경로 후 catalog 디렉터리에 임시 디렉터리가 남지 않는다.
- **기존 카탈로그 불변**: 실패 시 디렉터리 목록이 실행 전과 동일하다.

`draft-store.test.ts`: 승인 전 소비 거부 / 이중 소비 거부 / 다른 세션의 draftId 접근 거부 / 승인 상태 전이.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/catalog/`, `src/services/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **최종 카탈로그 경로에 먼저 쓰고 나서 검증하지 마라. 이유: 검증 실패 시 이미 카탈로그가 오염되고, 되돌리는 코드가 또 실패할 수 있다. 스테이징에서 검증을 끝낸 뒤에만 최종 경로로 옮긴다.**
- **기존 `catalog/` 파일을 덮어쓰거나 삭제하지 마라. 이유: 씨앗 보호(AC-C10). patternId 충돌은 거부가 정답이고, 기존 패턴 편집은 후속 phase다.**
- **덮어쓰기가 기본인 이동 연산을 존재 확인 없이 쓰지 마라. 이유: 확인과 이동 사이에 틈이 있으면 씨앗을 덮어쓸 수 있다.**
- **승인 없이 등재하는 경로를 만들지 마라. 이유: 승인 전 catalog 미기록이 계약이며, 타깃 repo 쓰기의 AC-10과 대칭이다.**
- **클라이언트가 보낸 boolean이나 상태 문자열을 승인 근거로 삼지 마라. 이유: 승인 레코드는 서버측 저장소의 상태 전이로만 성립한다(ARCHITECTURE 상태 관리).**
- **git 커밋·스테이징(`git add`)을 하지 마라. 이유: 작업 트리에 쓰는 데까지가 앱의 몫이고 커밋은 사용자의 판단이다.**
- **`load.ts`의 거부 사유 문자열이나 로더의 외부 동작을 바꾸지 마라. 이유: UI와 기존 테스트가 그 값에 의존한다.**
- 기존 테스트를 깨뜨리지 마라.
