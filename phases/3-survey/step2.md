# Step 2: survey-port

SURVEY의 LLM 경계를 **포트**로 정의하고, 테스트가 주입할 **결정적 스텁**을 만든다. 실제 Anthropic 어댑터는 step 6이다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 불신 격리
- `/docs/PRD.md` — "Phase 3 범위"의 "LLM은 후보만 낸다" 요구사항
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **후보 제안** 문단(`SurveyCandidate` 형태와 각 필드의 의미), "보안·안전"의 신뢰 경계
- `/docs/ADR.md` — ADR-015(결정성 경계 — LLM은 후보만, 수용 테스트는 스텁 주입), ADR-019(세 번째 분류축 금지)
- `/src/services/proposer.ts` — 기존 `Proposer` 포트와 `untrustedBlock`. **이 파일의 기존 타입·함수를 바꾸지 마라**
- `/src/services/proposer-stub.ts` — 기존 결정적 스텁. 호출 기록 방식을 그대로 따른다
- `/src/types/survey.ts` — step 0이 만든 규칙 타입. 여기에 후보 타입을 추가한다
- `/src/lib/engine/survey-collect.ts` — step 1이 만든 `SignalFile`. proposer에 넘길 재료의 형태

## 작업

### 1. `src/types/survey.ts`에 후보 타입 추가

```ts
export type SurveyConfidence = "high" | "medium" | "low";

export type SurveyCandidate = {
  id: string;          // kebab-case — 채택되면 patternId가 된다
  name: string;
  intent: string;      // 한 문장 — 이 방법론이 달성하는 것
  discipline: string;  // 무엇을 강제·금지하며 어떤 기계로 그렇게 하는가
  tradeoffs: string;   // 이 방법론이 치르는 비용
  evidence: string[];  // repo-상대 경로
  confidence: SurveyConfidence;
};
```

**`capability` 필드를 넣지 마라.** phase 3 등재물은 항상 `descriptive`이므로 쓰이지 않는 필드다. **분류축을 추가하지 마라** — 자생/상속 축은 판정 신호가 없어 채택하지 않기로 결정됐다(ADR-019).

### 2. `src/services/proposer.ts`에 SURVEY 포트 추가

기존 `Proposer`에 메서드를 **추가하지 마라.** 별도 포트로 둔다 — SURVEY는 저작과 다른 단계이고, 기존 어댑터·스텁·호출부를 하나도 건드리지 않는다.

```ts
export type SurveyRequest = {
  repository: string;
  revision: string;
  files: { path: string; ruleId: string; content: string }[];
};

export type SurveyProposer = {
  readonly metadata: ProposerMetadata;
  proposeSurveyCandidates(request: SurveyRequest): Promise<SurveyCandidate[]>;
};
```

`untrustedBlock`은 이미 이 파일에 있다. **재구현하지 말고 재사용한다.** 경계 블록을 실제로 적용하는 것은 어댑터(step 6)의 책임이고, 이 포트는 저장소에서 온 내용을 **데이터 필드로만** 나른다.

### 3. `src/services/proposer-stub.ts`에 SURVEY 스텁 추가

```ts
export type StubSurveyScript = {
  metadata?: ProposerMetadata;
  candidates: SurveyCandidate[];
};

export function createStubSurveyProposer(
  script: StubSurveyScript,
): SurveyProposer & { calls: SurveyRequest[] };
```

- 스크립트에 적힌 후보를 **그대로** 반환한다. 정규화·검증·보정을 하지 마라 — 검증은 step 3의 결정적 게이트가 하고, 스텁이 미리 고쳐주면 그 게이트를 테스트할 수 없다.
- 받은 요청을 `calls`에 기록해 테스트가 "무엇이 LLM에 갔는가"를 검사할 수 있게 한다.
- 기존 `createStubProposer`의 동작과 시그니처는 **바꾸지 마라.**

### 4. 테스트 — `src/services/proposer-stub.test.ts`에 추가

- 스텁이 스크립트의 후보를 그대로 반환한다.
- **적대적 후보를 손대지 않고 통과시킨다**: 존재하지 않는 경로, 빈 `evidence`, 잘못된 `confidence` 값을 담은 스크립트가 그대로 나온다. 스텁이 보정하면 step 3의 폐기 게이트를 검증할 수 없다.
- `calls`에 요청이 기록된다.
- 기존 `createStubProposer` 테스트가 그대로 통과한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/services/`, `src/types/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (분류축을 늘리지 않았는가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **기존 `Proposer` 인터페이스에 메서드를 추가하지 마라. 이유: 기존 구현(스텁·Anthropic 어댑터)이 전부 깨지고, step 3~5 구간에서 빌드가 통과하지 못한다. SURVEY는 별도 포트다.**
- **`SurveyCandidate`에 `capability`나 세 번째 분류축을 넣지 마라. 이유: 등재는 항상 `descriptive`라 쓰이지 않는 필드이고, 검증되지 않은 축은 사용자에게 틀린 확신을 준다(ADR-019).**
- **스텁이 후보를 정규화·검증·보정하게 만들지 마라. 이유: 폐기 게이트(step 3)를 검증할 수 없게 된다. 스텁의 역할은 적대적 입력을 그대로 흘려보내는 것이다.**
- **여기서 실제 LLM을 호출하거나 Anthropic SDK를 import하지 마라. 이유: 어댑터는 step 6의 범위다.**
- **저장소 내용을 프롬프트 문자열에 이어붙이지 마라. 이유: 불신 격리 위반. 포트는 데이터 필드로만 나르고, 경계 블록 적용은 어댑터의 책임이다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
