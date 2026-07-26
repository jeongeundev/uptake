# Step 3: survey-engine

수집 → 후보 제안 → **환각 폐기**를 관통하는 SURVEY 엔진을 구현한다. 이 step의 산출물은 "사용자에게 보여줄 후보 목록"까지다 — 채택·등재는 step 4다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 provenance 강제(resolve 안 되면 폐기, 환각 금지)
- `/docs/PRD.md` — "Phase 3 범위"의 "모든 후보 근거는 고정된 revision에서 resolve된다 … 폐기 사유를 사용자에게 보인다"
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **후보 제안** · **환각 폐기 — 2단** 문단
- `/docs/ADR.md` — ADR-009(provenance 강제), ADR-015(결정성 경계), ADR-017(제품 루트 = SURVEY)
- `/src/types/survey.ts` — step 0·2가 만든 `CompiledSurveyRules`·`SurveyCandidate`
- `/src/lib/engine/survey-collect.ts` — step 1이 만든 `collectSignalFiles`·`SignalFile`·`SkippedSignal`·`CollectResult`
- `/src/services/proposer.ts` — step 2가 만든 `SurveyProposer`·`SurveyRequest`
- `/src/services/proposer-stub.ts` — step 2가 만든 `createStubSurveyProposer` (테스트에서 주입)
- `/src/lib/catalog/load.ts` — `isId`·`isRelativePosixPath`. 후보 `id`는 나중에 `patternId`가 되므로 여기 기준을 지금 통과해야 한다
- `/src/lib/engine/extract.ts` — 같은 성격의 기존 게이트. 후보를 "담고 나중에 거르지" 않고 **버리면서 사유를 기록**하는 방식을 그대로 따른다

## 작업

### `src/lib/engine/survey.ts`

```ts
export type DiscardedEvidence = {
  candidateId: string;
  path: string;
  reason: "not-collected";
};

export type DiscardedSurveyCandidate = {
  candidateId: string;   // 형태 불량으로 id조차 못 믿을 때는 빈 문자열이 아니라 순번 기반 식별자를 쓴다
  reason: "invalid-shape" | "duplicate-id" | "no-evidence";
  detail: string;
};

export type SurveyResult =
  | {
      ok: true;
      repository: string;
      revision: string;
      collected: { path: string; ruleId: string; truncated: boolean }[];
      skipped: SkippedSignal[];
      candidates: SurveyCandidate[];         // 살아남은 후보. evidence는 검증된 경로만
      discardedEvidence: DiscardedEvidence[];
      discardedCandidates: DiscardedSurveyCandidate[];
    }
  | {
      ok: false;
      reason:
        | "repository-unresolved"
        | "revision-unpinnable"
        | "no-signal"
        | "no-candidate";
      detail: string;
    };

export async function surveyRepository(
  repository: string,
  proposer: SurveyProposer,
  rules: CompiledSurveyRules,
  sourceRoot?: string,
): Promise<SurveyResult>;
```

동작 계약:

**a. 수집.** `collectSignalFiles`를 호출한다. 실패하면 그 `reason`·`detail`을 그대로 실어 반환한다.

**b. 제안.** `proposeSurveyCandidates({ repository, revision, files })`를 호출한다. `files`는 수집 결과를 `{ path, ruleId, content }`로 옮긴 것이다. 저장소 내용을 지시 문자열에 이어붙이지 말고 **데이터 필드로만** 넘긴다.

**c. 후보 검증 — 여기가 1단 환각 봉쇄 지점이다.** 후보를 순서대로 검사하고, 걸리면 `discardedCandidates`에 사유와 함께 기록한 뒤 **버린다.**

1. **형태**: `id`가 `isId` 기준을 만족하고, `name`·`intent`·`discipline`·`tradeoffs`가 비어 있지 않은 문자열이며, `confidence`가 `"high"|"medium"|"low"` 중 하나이고, `evidence`가 문자열 배열인가 → 아니면 `invalid-shape`.
2. **중복**: 같은 `id`가 이미 채택됐는가 → `duplicate-id`.
3. **근거**: `evidence`의 각 경로에 대해 —
   - `isRelativePosixPath`를 만족하지 않거나 **수집 목록(a의 `files`)에 없으면** `discardedEvidence`에 `not-collected`로 기록하고 그 경로를 버린다.
   - 같은 후보 안의 중복 경로는 하나만 남긴다(사유 기록 없이 정규화).
4. **근거 소진**: 살아남은 `evidence`가 0개면 후보 자체를 `no-evidence`로 버린다.

> **판정 기준은 저장소 전체 경로가 아니라 "LLM에 실제로 제시한 수집 목록"이다.** 보여주지 않은 파일을 근거로 대는 것도 환각이다. 저장소 전체와 대조하면 그 환각이 통과한다.

**d. 결과.** 살아남은 후보가 0개면 `no-candidate`. 그렇지 않으면 `ok: true`이며 `candidates[].evidence`는 **검증을 통과한 경로만** 담는다.

**결정적 순서.** `candidates`는 `id` 사전식, `discardedEvidence`는 `(candidateId, path)`, `discardedCandidates`는 `candidateId` 순으로 정렬한다. 같은 입력에 같은 출력이 나와야 한다.

**폐기는 조용하지 않다.** `discardedEvidence`·`discardedCandidates`·`skipped`는 전부 반환값에 실려 나중에 화면까지 간다. 버린 것을 반환값에서 빼지 마라 — PRD가 "폐기 사유를 사용자에게 보인다"를 요구사항으로 못박았다.

### 테스트 — `src/lib/engine/survey.test.ts`

임시 git 저장소 fixture + `createStubSurveyProposer` 주입으로 실행한다. `src/lib/engine/survey-collect.test.ts`(step 1)의 fixture 구성 방식을 재사용하라.

- **정상 경로**: 실재하는 경로를 근거로 단 후보가 살아남고 `evidence`가 그대로 유지된다.
- **환각 봉쇄 1 (필수)**: 스텁이 **수집 목록에 없는 경로**를 근거로 내면 `discardedEvidence`에 `not-collected`로 기록되고 후보의 `evidence`에서 빠진다.
- **환각 봉쇄 2 (필수)**: 저장소에는 있지만 **수집되지 않은** 파일(규칙에 안 걸리거나 예산에 잘린 파일)을 근거로 내면 역시 `not-collected`다. 저장소 전체와 대조하면 통과해버리는 케이스이므로 반드시 포함한다.
- **근거 소진**: 모든 근거가 환각인 후보는 `no-evidence`로 통째로 버려진다.
- **형태 불량**: `id`가 `isId` 위반, 빈 `intent`, 잘못된 `confidence` 값 각각이 `invalid-shape`로 버려진다.
- **중복 id**: 같은 `id`의 두 번째 후보가 `duplicate-id`로 버려진다.
- **경로 이탈**: `../etc/passwd`·절대경로가 근거에서 제거된다.
- **후보 전멸**: 모든 후보가 버려지면 `{ ok: false, reason: "no-candidate" }`.
- **불신 데이터 전달**: 스텁의 `calls`를 검사해 저장소 내용이 데이터 필드로 전달됐고 지시 문자열에 섞이지 않았음을 확인한다.
- **결정성**: 같은 입력으로 두 번 실행하면 결과가 순서까지 동일하다.

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
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (환각 근거가 후보에 남아 있지 않은가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **환각 판정을 저장소 전체 경로 목록과 대조하지 마라. 기준은 LLM에 제시한 수집 목록이다. 이유: 보여주지 않은 파일을 근거로 대는 것도 환각이며, 저장소 전체와 대조하면 그것이 통과한다.**
- **폐기된 근거·후보를 "일단 담고 나중에 거른다"로 처리하지 마라. 이유: ADR-009 — 한 번의 실수로 환각이 카탈로그까지 샌다. 버리는 지점과 기록하는 지점이 같아야 한다.**
- **폐기 사실을 반환값에서 빼지 마라. 이유: PRD가 폐기 사유의 사용자 표시를 요구사항으로 못박았다. 조용히 사라지는 후보는 없다.**
- **후보를 보정·정규화해서 살리지 마라(빈 필드 채우기, 경로 추측 교정 등). 이유: 조용한 보정은 성공 위장의 사촌이다. 형태가 틀린 후보는 버린다.**
- **여기서 카탈로그에 쓰거나 `AuthoringRequest`를 조립하지 마라. 이유: 채택은 step 4의 범위다. 사용자가 고르기 전에 등재로 향하는 경로가 있으면 안 된다.**
- **대상 저장소를 checkout·수정하거나 네트워크에 나가지 마라. 이유: 읽기 전용·로컬 우선 계약.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
