# Step 4: survey-adopt

사용자가 고른 후보 하나를 **결정적으로** `observed`/`descriptive` 패턴으로 조립한다. 이 step에서 LLM 호출은 **0회**다 — 후보에 이미 필요한 것이 다 들어 있기 때문이다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 provenance 강제·서술적 태도·두 층의 게이트
- `/docs/PRD.md` — "Phase 3 범위"의 "등재물은 기존 하드 게이트를 통과한다", "승인 전 catalog 미기록"
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **채택 — LLM 호출은 0회다** · **채택은 ABSTRACT를 거치지 않는다** · **`AuthoringRequest` 자동 조립**(조립표) · **근거는 재추출하지 않는다** · **role은 하나다** · **revision 이동은 거부한다** 문단. 그리고 "패턴 스키마" 절의 층 1 하드 게이트 목록
- `/docs/ADR.md` — ADR-005(독립성 판정·공통=본질/차이=결합점), ADR-006(서술적 태도), ADR-017(제품 루트)
- `/src/lib/engine/extract.ts` — **수정 대상**. `extractEvidence`의 후보 검증 루프와 `observeTargetStack`
- `/src/lib/engine/abstract.ts` — **읽되 호출하지 마라.** 왜 이 경로가 `contrastEvidence`를 거치지 않는지 이해하기 위해 읽는다 (그 함수는 대조로 role을 뽑는 장치인데, 여기엔 대조할 두 번째 저장소가 없다)
- `/src/types/authoring.ts` — `AuthoringRequest`·`SourceSpec`·`Evidence`·`DiscardedCandidate`·`TargetStackFact`
- `/src/types/pattern.ts` — `Pattern` 스키마
- `/src/types/survey.ts` — step 2가 만든 `SurveyCandidate`
- `/src/lib/engine/survey.ts` — step 3이 만든 `surveyRepository`의 반환 형태
- `/src/lib/catalog/load.ts` — `isId`(`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`)·`revisionPattern`
- `/src/services/proposer.ts` — `FileCandidate` 타입

## 작업

### 1. `src/lib/engine/extract.ts` — 근거 주입 경로를 export로 노출

`extractEvidence`의 **기존 시그니처와 동작을 바꾸지 마라.** 후보 검증 루프(경로 검사 → role 검사 → 중복 검사 → `resolveProvenance`)를 공통 내부 함수로 뽑고, 그것을 부르는 새 export를 추가한다.

```ts
export async function extractFromCandidates(
  request: AuthoringRequest,
  candidates: FileCandidate[],
  sourceRoot?: string,
): Promise<ExtractResult>;
```

- `extractEvidence`는 `proposer.proposeFileCandidates`로 후보를 얻은 뒤 이 공통 경로를 쓰도록 바꾼다. **반환값·실패 사유·정렬 순서가 전과 완전히 같아야 한다** — 기존 테스트가 하나도 수정 없이 통과해야 한다.
- `observeTargetStack`을 export한다. 시그니처·동작은 바꾸지 마라.

### 2. `src/lib/engine/survey-adopt.ts` — 결정적 조립

```ts
export const SURVEY_ROLE_ID = "observed-practice";

export type AdoptResult =
  | {
      ok: true;
      request: AuthoringRequest;        // 승인 시 fingerprint 대조에 쓰인다
      pattern: Pattern;
      discarded: DiscardedCandidate[];
      targetStackFacts: TargetStackFact[];
    }
  | {
      ok: false;
      reason:
        | "source-id-underivable"
        | "revision-moved"
        | "extract-failed"
        | "assembly-invalid";
      detail: string;
    };

export async function adoptSurveyCandidate(
  input: {
    repository: string;
    revision: string;              // SURVEY가 고정한 revision
    candidate: SurveyCandidate;
  },
  sourceRoot?: string,
): Promise<AdoptResult>;
```

동작 계약:

**a. `sourceId` 파생.** `repository`를 소문자화하고 영숫자가 아닌 연속 문자를 `-` 하나로 바꾼 뒤 앞뒤 `-`를 제거한다. 결과가 `isId`를 만족하지 않으면 **`source-id-underivable`로 거부한다** — 임의 대체 문자열(`"source-1"` 등)을 만들어 진행하지 마라. 같은 값을 `independenceGroup`에도 쓴다.

**b. 스택 관찰.** 고정 revision의 `package.json`을 `observeTargetStack`으로 관찰한다.
- `isTargetStack` = 관찰된 `vitestObserved`
- `stack` = vitest가 관찰되면 `"js/ts+vitest"`, `package.json`은 읽혔으나 vitest가 없으면 `"js/ts"`, 그 외 `"unspecified"`

`stack`은 사람이 읽는 **표시용 라벨**이며 비교에 쓰지 않는다. 없는 것을 지어내지 말고 `"unspecified"`로 둔다.

**c. `AuthoringRequest` 조립.** 아래 표대로 결정적으로 만든다.

| 필드 | 값 |
|---|---|
| `patternId` | `candidate.id` |
| `name` | `candidate.name` |
| `intent` | `candidate.intent` |
| `capability` | `"descriptive"` 고정 |
| `evidenceStatus` | `"observed"` 고정 |
| `sources` | 원소 **하나** |
| `sources[0].id` · `independenceGroup` | a에서 파생한 값 |
| `sources[0].repository` | 입력 `repository` |
| `sources[0].stack` · `isTargetStack` | b의 관찰 결과 |
| `sources[0].independenceNote` | 단일 저장소 관찰임을 밝히는 고정 문구 |

**d. 근거 확정 — 재추출하지 않는다.** `candidate.evidence`의 각 경로를 `FileCandidate`(`sourceId`, `path`, `roleId: SURVEY_ROLE_ID`)로 만들어 `extractFromCandidates`에 넘긴다. **`proposeFileCandidates`를 호출하지 마라** — 사용자가 화면에서 보고 고른 근거와 등재될 `provenance`가 달라지는 경로가 있으면 안 된다. 실패하면 `extract-failed`.

**e. revision 검증.** `extractFromCandidates`가 반환한 `sources[0].revision`이 입력 `revision`과 다르면 **`revision-moved`로 거부한다.** 사용자가 본 근거와 등재될 근거가 서로 다른 커밋의 것이 되는 경로는 없다. 조용히 새 revision으로 진행하지 마라.

**f. 패턴 조립.**

```ts
{
  schemaVersion: 1,
  patternId: candidate.id,
  name: candidate.name,
  capability: "descriptive",
  evidenceStatus: "observed",
  intent: candidate.intent,
  roles: [{ id: SURVEY_ROLE_ID, description: candidate.discipline }],
  bindingPoints: [],
  sources: extracted.sources,
  provenance: extracted.evidence.map(...),   // observedRole은 전부 SURVEY_ROLE_ID
  tradeoffs: candidate.tradeoffs,
}
```

- **`oracle`을 넣지 마라.** `descriptive`인데 `oracle`이 있으면 층 1 하드 게이트가 로드를 거부한다(`capability`↔`oracle` 양방향 일치).
- **role은 하나다.** 저장소가 하나뿐이면 무엇이 스택-불변 본질이고 무엇이 결합점인지 가를 근거가 없다(ADR-005). role을 쪼개는 것은 대조가 하는 일이며, 이 패턴이 두 번째 저장소와 대조돼 `corroborated`로 승급할 때 갈라진다.
- **`bindingPoints`는 빈 배열이다.** 채우려고 하지 마라 — 비어 있는 것이 정직하다.
- `provenance`는 `(path)` 사전식으로 정렬한다.

**g. 자체 정합 확인.** 조립 결과가 아래를 만족하지 않으면 `assembly-invalid`로 거부한다. (등재 시점의 하드 게이트가 다시 검사하지만, 여기서 먼저 걸러 잘못된 초안이 사용자 앞에 가지 않게 한다.)
- `sources`·`provenance`가 빈 배열이 아님
- 모든 `provenance[].sourceId`가 `sources[].id`에 있고, 모든 `sources[].id`가 최소 하나의 provenance에서 참조됨
- 모든 `provenance[].observedRole`이 `roles[].id`에 있고, `roles[].id`가 최소 하나의 provenance에서 참조됨 (고아 role 금지)
- distinct `independenceGroup`이 정확히 **1개** (`observed`의 정의)

### 3. 테스트 — `src/lib/engine/survey-adopt.test.ts`

임시 git 저장소 fixture로 실행한다. step 1·3의 fixture 구성 방식을 재사용하라.

- **정상 경로**: 후보가 `descriptive`/`observed` 패턴으로 조립되고, `roles`가 1개, `bindingPoints`가 빈 배열, `oracle`이 없다.
- **근거 동일성 (필수)**: 조립된 `provenance`의 경로 집합이 **후보의 `evidence`와 정확히 같다.** 사용자가 본 것과 등재될 것이 같다는 계약의 테스트다.
- **revision 이동 거부 (필수)**: SURVEY revision을 고정한 뒤 fixture 저장소에 **새 커밋을 만들고** 채택하면 `revision-moved`로 거부된다.
- **sourceId 파생**: `github.com/pytest-dev/pytest` 같은 식별자가 `isId`를 만족하는 값으로 정규화된다. 정규화해도 만족할 수 없는 입력은 `source-id-underivable`.
- **스택 관찰**: vitest가 있는 fixture → `isTargetStack: true`, 없으면 `false`, `package.json`이 없으면 `stack === "unspecified"`.
- **resolve 실패**: 후보 근거가 그 revision에 없으면 `discarded`에 기록되고, 전부 실패하면 `extract-failed`.
- **결정성**: 같은 입력으로 두 번 실행하면 패턴이 동일하다.
- **기존 저작 경로 무손상 (필수)**: `src/lib/engine/extract.test.ts`가 **수정 없이** 통과한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/engine/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (조립물이 층 1 하드 게이트를 만족하는가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`contrastEvidence`(ABSTRACT)를 호출하지 마라. 이유: 그 함수는 대조로 role을 뽑는 장치인데 여기엔 대조할 두 번째 저장소가 없다. 통과시키려면 결정적 값을 LLM 포트에 흘려보내야 하고, 그것은 하지 않은 대조를 한 것처럼 보이게 하는 위장이다.**
- **이 step에서 LLM(proposer)을 호출하지 마라. 이유: 채택은 전부 결정적이다. `proposeFileCandidates`를 부르면 사용자가 고른 근거와 등재될 근거가 달라지고, `proposeNarrative`를 부르면 사용자가 보지 못한 텍스트가 등재물에 들어간다.**
- **`extractEvidence`의 기존 시그니처·동작·정렬 순서를 바꾸지 마라. 이유: phase 2의 저작 경로가 그 위에 서 있다. 기존 테스트가 수정 없이 통과해야 한다.**
- **revision이 움직였을 때 조용히 새 revision으로 진행하지 마라. 이유: 사용자가 본 근거와 등재되는 근거가 다른 커밋의 것이 된다. 조용한 보정은 성공 위장의 사촌이다.**
- **`role`을 여러 개로 쪼개거나 `bindingPoints`를 채우지 마라. 이유: 저장소 하나로는 본질과 결합점을 가를 근거가 없다(ADR-005). 근거 없는 구조는 사용자에게 틀린 확신을 준다.**
- **`oracle`을 만들거나 `capability`를 `generative`로 두지 마라. 이유: `descriptive`↔`oracle` 불일치는 층 1 로드 거부 사유이고, oracle 자기검증은 앵커 형태에 한정된다(ADR-016).**
- **여기서 `catalog/`에 파일을 쓰지 마라. 이유: 승인 전 미기록이 계약이다. 등재는 기존 저작 승인·등재 경로가 한다(step 5).**
- **`isTargetStack`·`independenceGroup`을 임의로 지어내지 마라. 이유: 판정 주체는 사용자이고 앱은 관찰 사실만 제시한다(ADR-005). 저장소가 하나라 독립 그룹이 1개인 것은 판정이 아니라 자명한 사실이므로 자동 부여가 허용되지만, 그 밖의 값을 추론하지는 않는다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
