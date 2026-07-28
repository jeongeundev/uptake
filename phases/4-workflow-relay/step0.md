# Step 0: pinned-revision

phase 4는 uptake의 방법론을 다섯 단계 CLI 명령과 디스크 산출물로 물질화한다(ADR-020). 이 step은 그 릴레이가 성립하기 위한 **엔진 계약 하나**를 고친다 — SURVEY가 고정한 revision을 채택 저작이 그대로 쓰게 만드는 것. CLI는 아직 만들지 않는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — 특히 "고정 revision에서 읽는 단계는 HEAD를 다시 읽지 않는다" CRITICAL 항목
- `/docs/ADR.md` — **ADR-021**(고정 revision 계약)이 이 step의 정본이다. ADR-009(provenance 강제) · ADR-023(채택 경로만 태운다)도 읽어라
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 절의 "revision 고정" 단락
- `/docs/PRD.md` — 'Phase 4 범위' 절
- `src/types/authoring.ts` · `src/types/pattern.ts`
- `src/lib/engine/extract.ts` · `src/lib/engine/extract.test.ts`
- `src/lib/engine/survey-adopt.ts` · `src/lib/engine/survey-adopt.test.ts`
- `src/lib/provenance/resolve.ts`

## 작업

### 1. `SourceSpec`에 고정 revision을 선택 필드로 추가한다

`src/types/authoring.ts`:

```ts
export type SourceSpec = {
  id: string;
  repository: string;
  revision?: string; // 이미 고정된 커밋 SHA. 있으면 HEAD를 읽지 않는다 (ADR-021)
  stack: string;
  isTargetStack: boolean;
  independenceGroup: string;
  independenceNote: string;
};
```

### 2. `resolveSources`가 고정 revision을 존중한다

`src/lib/engine/extract.ts`의 `resolveSources`(현재 94-138행)는 지금 **조건 없이** `git rev-parse HEAD`를 읽는다. 이것을 다음과 같이 바꾼다:

- `sourceSpec.revision`이 있으면 그 값을 쓴다. `rev-parse HEAD`를 부르지 않는다.
- `sourceSpec.revision`이 없으면 **종전 그대로** `rev-parse HEAD`로 고정한다.
- 어느 경우든 `revisionPattern`(40자 hex) 형태를 만족해야 하고, `git ls-tree -r --name-only <revision>`으로 커밋 객체를 해석할 수 있어야 한다.

실패 사유를 **가른다**:

| 상황 | reason |
|---|---|
| 저장소 루트를 resolve할 수 없다 | `source-unresolved` (종전 그대로) |
| revision을 주지 않았고 HEAD 고정에 실패했다 | `source-unresolved` (종전 그대로) |
| **고정 revision을 줬는데** 형태가 틀렸거나 커밋을 해석할 수 없다 | **`revision-unresolvable`** (신규) |

`ExtractResult`의 실패 유니온에 `"revision-unresolvable"`을 추가한다. 두 사유를 가르는 이유: 호출자가 조치를 고를 수 있어야 한다 — `revision-unresolvable`은 얕은 클론·gc로 커밋 객체가 없는 경우이므로 **클론을 보충**해야 하고, `source-unresolved`는 저장소 자체가 없는 것이다.

### 3. `adoptSurveyCandidate`가 SURVEY의 revision을 넘긴다

`src/lib/engine/survey-adopt.ts`:

- `initialRequest`의 source에 `revision: input.revision`을 싣는다.
- **`revision-moved` 분기를 제거한다** (현재 129-136행의 `if (source.revision !== input.revision)` 블록). `AdoptResult`의 reason 유니온에서도 `"revision-moved"`를 지운다.
- reason 유니온을 다음으로 바꾼다:

```ts
reason:
  | "source-id-underivable"
  | "revision-unresolvable"
  | "provenance-unresolvable"
  | "extract-failed"
  | "assembly-invalid";
```

`ExtractResult` 실패를 `AdoptResult`로 옮기는 매핑(현재의 `extractionFailure`):

| `ExtractResult` | `AdoptResult` |
|---|---|
| `revision-unresolvable` | `revision-unresolvable` |
| `no-evidence`이고 폐기 사유가 **전부** `provenance-unresolved` | `provenance-unresolvable` |
| 그 밖의 `no-evidence` · `source-unresolved` | `extract-failed` |

`no-evidence`의 폐기 사유를 판정하려면 실패 결과에서 폐기 목록을 볼 수 있어야 한다. 현재 `ExtractResult`의 `no-evidence` 분기는 `detail` 문자열에만 사유를 담고 있다 — **`discarded: DiscardedCandidate[]`를 그 분기에 추가하라.** 문자열 파싱으로 판정하지 마라(형식이 바뀌면 조용히 틀린다).

`detail` 문자열은 사람이 읽는 진단이므로 지금 형식을 유지해도 좋다.

### 4. 테스트를 교체한다

`src/lib/engine/survey-adopt.test.ts:173`의 `revision-moved` 단언은 **삭제하고 새 계약을 검사하는 테스트로 교체한다**:

- **SURVEY 이후 HEAD가 움직여도 채택이 성공한다** — fixture 저장소를 커밋해 revision을 얻고, 그 revision으로 SURVEY 후보를 만든 뒤, 저장소에 새 커밋을 하나 더 넣고(HEAD가 이동), `adoptSurveyCandidate`가 `ok: true`이며 조립된 패턴의 `sources[0].revision`이 **SURVEY의 고정 revision**임을 확인한다.
- **고정 revision을 해석할 수 없으면 `revision-unresolvable`이다** — 저장소에 존재하지 않는 40자 hex SHA를 넘기고 그 reason을 확인한다.

`src/lib/engine/extract.test.ts`:

- 기존 테스트(revision 미지정 → HEAD 고정)는 **그대로 통과해야 한다**. 직접 저작 경로의 동작은 바뀌지 않는다.
- `SourceSpec.revision`을 준 경우 그 값이 `Source.revision`으로 그대로 나오는 테스트를 추가한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/lib/engine/survey-adopt.test.ts src/lib/engine/extract.test.ts
```

추가로 아래가 **0건**이어야 한다 (죽은 계약이 남지 않았는지):

```bash
grep -rn "revision-moved" src/ e2e/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-workflow-relay/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`extractEvidence`(직접 저작 경로)의 동작을 바꾸지 마라. 이유: ADR-021이 그 경로는 "저작 개시 시점 HEAD 고정"을 정상으로 둔다. `SourceSpec.revision`이 `undefined`일 때 종전과 한 바이트도 다르지 않아야 한다.**
- **`revision-moved` 테스트를 `skip`하거나 주석 처리하지 마라. 삭제하고 위의 새 테스트로 교체하라. 이유: skip된 테스트는 계약이 사라졌다는 사실을 숨긴다.**
- **`resolveProvenance`의 시그니처를 바꾸지 마라. 이유: 이미 `Source.revision`으로 `git show <rev>:<path>`를 부르므로, source에 고정 revision을 실으면 근거 읽기는 자동으로 그 revision을 쓴다.**
- **`no-evidence` 판정을 `detail` 문자열 파싱으로 하지 마라. 이유: 진단 문구가 바뀌면 조용히 틀린 분기를 탄다.**
- **웹 UI 컴포넌트(`src/components/`)와 Route Handler(`src/app/api/`)를 건드리지 마라. 이유: 이 step은 엔진 계약만 바꾼다. `AdoptResult`의 reason은 `survey-service.ts`가 문자열로 합쳐 전달하므로 라우트 수정이 필요 없다.**
- **CLI(`bin/`)·워크플로우 층(`src/workflow/`)을 만들지 마라. 이유: 다음 step들의 범위다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
