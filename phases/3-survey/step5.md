# Step 5: survey-api

SURVEY 엔진을 세션 결속 in-memory 저장소와 Route Handler로 앱에 연결한다. 승인·등재는 **기존 저작 라우트를 그대로 재사용**한다 — 새로 만들지 않는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/PRD.md` — "Phase 3 범위"의 "승인 전 catalog 미기록", "등재물은 기존 하드 게이트를 통과한다"
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)" 전체, "상태 관리" 절(세션 소유권·in-memory 수명·클라이언트가 보낸 값을 신뢰하지 않는다)
- `/docs/ADR.md` — ADR-015(결정성 경계), ADR-017
- `/src/app/api/http.ts` — `sessionIdFor`·`jsonWithSession`·`readJson`·`statusCode`. **그대로 재사용한다**
- `/src/app/api/authoring/drafts/route.ts` — 같은 성격의 기존 라우트. 구조를 그대로 따른다
- `/src/app/api/authoring/drafts/[draftId]/approve/route.ts` · `register/route.ts` — **재사용 대상.** SURVEY 초안도 이 경로로 승인·등재된다
- `/src/app/api/authoring/proposer.ts` — 환경 기반 proposer 선택 + 테스트 주입 훅의 기존 패턴
- `/src/services/authoring-store.ts` — 세션 결속 저장소의 기존 패턴. `createAuthoringDraft`가 초안을 만들어 `createDraft`에 넣는 방식
- `/src/services/draft-store.ts` — `createDraft`·`hashAuthoringRequest`·`StoredDraft`. **입력 fingerprint 결속은 phase 2의 성과다. 되돌리지 마라**
- `/src/lib/engine/survey.ts` — step 3의 `surveyRepository`
- `/src/lib/engine/survey-adopt.ts` — step 4의 `adoptSurveyCandidate`
- `/src/lib/engine/survey-rules.ts` — step 0의 `loadSurveyRules`·`SurveyRulesError`
- `/src/services/proposer.ts` — step 2의 `SurveyProposer`

## 작업

### 1. `src/services/survey-store.ts` — 세션 결속 조사 저장소

```ts
export type StoredSurvey = {
  sessionId: string;
  repository: string;
  revision: string;
  candidates: SurveyCandidate[];
  proposerMetadata: ProposerMetadata;
};

export function createSurvey(input: StoredSurvey): string;   // surveyId 반환
export function getSurvey(surveyId: string, sessionId: string): StoredSurvey | undefined;
export function __resetSurveyStoreForTests(): void;
```

- `surveyId`는 **불투명 식별자**다. 추측 가능한 순번을 쓰지 마라.
- `getSurvey`는 **세션이 일치할 때만** 반환한다. 다른 세션의 `surveyId`로는 접근할 수 없다.
- 서버 프로세스 수명에만 존재한다. 영속화하지 마라.
- 반환 시 내부 객체를 그대로 노출하지 말고 복사본을 준다(`draft-store.ts`의 `copyDraft` 방식 참고).

### 2. `src/services/survey-service.ts` — 조사·채택 오케스트레이션

Route Handler에 로직을 넣지 말고 서비스 층에 둔다(기존 `authoring-store.ts`와 같은 구조).

```ts
export type SurveyError = { status: "invalid-request" | ...; detail: string };

export async function runSurvey(
  sessionId: string,
  repository: string,
  proposer: SurveyProposer,
): Promise<SurveyedResponse | SurveyError>;

export async function adoptCandidate(
  sessionId: string,
  surveyId: string,
  candidateId: string,
): Promise<AdoptedResponse | SurveyError>;
```

`runSurvey`:
1. `loadSurveyRules()`로 규칙을 읽는다. `SurveyRulesError`는 **서버 설정 오류**다 — 잡아서 500으로 표면화하되 `detail`에 원인을 담는다. **빈 규칙으로 진행하지 마라.**
2. `surveyRepository(repository, proposer, rules, sourceRoot)`를 호출한다. `sourceRoot`는 `process.env.UPTAKE_SOURCE_ROOT ?? resolve(".uptake/sources")` — `authoring-store.ts`와 **동일한 규칙**을 쓴다.
3. 성공하면 `createSurvey`로 저장하고 `{ status: "surveyed", surveyId, repository, revision, candidates, collected, skipped, discardedEvidence, discardedCandidates, proposer }`를 반환한다. **폐기·skip 정보를 응답에서 빼지 마라** — 화면이 그것을 보여야 한다.

`adoptCandidate`:
1. `getSurvey(surveyId, sessionId)`로 조사를 찾는다. 없으면 오류(다른 세션의 조사에 접근할 수 없다).
2. 그 조사의 `candidates`에서 `candidateId`를 찾는다. **클라이언트가 보낸 후보 본문을 신뢰하지 마라** — 서버가 보관한 후보만 쓴다. 클라이언트가 근거 경로나 intent를 바꿔 보낼 수 있으면 SURVEY의 폐기 게이트가 무의미해진다.
3. `adoptSurveyCandidate({ repository, revision, candidate }, sourceRoot)`를 호출한다.
4. 성공하면 `createDraft({ sessionId, requestFingerprint: hashAuthoringRequest(request), pattern, proposerMetadata })`로 **기존 초안 저장소에** 넣는다.
5. `{ status: "drafted", draftId, pattern, authoringRequest, discarded, targetStackFacts }`를 반환한다. `authoringRequest`는 클라이언트가 승인·등재 요청에 되돌려 보내야 하므로 응답에 싣는다.

### 3. `src/app/api/survey/proposer.ts` — proposer 선택

`src/app/api/authoring/proposer.ts`와 **같은 구조**로 만든다: 환경변수로 실제/스텁을 고르고, 테스트 주입 훅(`__setSurveyProposerForTests`)을 둔다. 스텁은 **명시적 환경변수로만** 활성화된다 — 기본값으로 스텁이 켜지면 안 된다.

step 6이 실제 Anthropic 어댑터를 붙이기 전까지는 스텁 경로만 동작해도 된다. 설정이 없을 때는 기존 `AnthropicProposerConfigurationError`와 같은 방식으로 400을 반환한다.

### 4. Route Handler

- `src/app/api/survey/route.ts` — `POST { repository: string }` → `runSurvey`
- `src/app/api/survey/[surveyId]/candidates/[candidateId]/adopt/route.ts` — `POST` → `adoptCandidate`

둘 다 `export const runtime = "nodejs"`이며, `sessionIdFor`로 세션을 얻고 `jsonWithSession`으로 응답한다. 요청 본문 검증은 엄격하게 한다(`repository`가 비어 있지 않은 문자열인지 등).

**승인·등재 라우트를 새로 만들지 마라.** SURVEY 초안은 기존 `/api/authoring/drafts/[draftId]/approve`와 `/register`로 승인·등재된다. 그 라우트들은 `draft-store`의 fingerprint 결속과 씨앗 보호(patternId 충돌 거부)를 이미 갖고 있다.

### 5. 테스트 — `src/app/api/survey/route.test.ts` (또는 `src/__tests__/` 아래 기존 배치 관습을 따른다)

`src/__tests__/authoring-route.test.ts`의 방식을 참고해 proposer를 주입하고 실행한다.

- **정상 경로**: 조사 → 후보 응답 → 채택 → `draftId` 발급.
- **폐기 정보 노출 (필수)**: 환각 근거를 낸 스텁으로 조사하면 응답에 `discardedEvidence`가 실려 나온다.
- **세션 격리 (필수)**: 다른 세션의 `surveyId`로 채택하면 실패한다.
- **클라이언트 후보 변조 무시 (필수)**: 채택 요청 본문에 후보 내용을 실어 보내도 **서버가 보관한 후보**로 조립된다.
- **규칙 로드 실패**: 규칙 파일 경로를 없는 곳으로 지정하면 500과 원인이 담긴 detail이 나오고, 빈 규칙으로 진행하지 않는다.
- **잘못된 요청**: `repository` 누락·빈 문자열이 400.
- **전체 흐름**: 채택된 초안이 기존 approve → register 라우트로 등재되고 `catalog/`에 파일이 생긴다. 씨앗 파일은 변하지 않는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app/api/`, `src/services/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0, Route Handler는 Node 런타임)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (승인 전 카탈로그 미기록이 지켜지는가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **승인·등재 라우트를 새로 만들지 마라. 이유: 기존 저작 라우트가 fingerprint 결속·씨앗 보호·하드 게이트 재검사를 이미 갖고 있다. 두 번째 등재 경로는 그 보호를 우회하는 구멍이 된다.**
- **클라이언트가 보낸 후보 본문(근거 경로·intent·discipline)을 신뢰하지 마라. 서버가 보관한 후보만 쓴다. 이유: 클라이언트가 근거를 바꿔 보낼 수 있으면 SURVEY의 환각 폐기 게이트가 무의미해진다.**
- **다른 세션의 조사·초안에 접근 가능하게 하지 마라. 이유: 기존 workflow/draft 저장소의 세션 소유권 계약과 같다.**
- **규칙 로드 실패를 빈 규칙·기본값으로 대체하지 마라. 이유: "규칙이 죽었다"와 "신호가 없다"가 구별되지 않으면 결과를 신뢰할 수 없다.**
- **`draft-store`의 입력 fingerprint 결속을 우회하거나 되돌리지 마라. 이유: phase 2 remediation이 F-001로 잡아 고친 계약 결함이다.**
- **조사 결과를 파일로 영속화하지 마라. 이유: 서버 프로세스 수명 in-memory가 기존 상태 관리 계약이다.**
- **Route Handler에 조립·검증 로직을 넣지 마라. 이유: 기존 구조(라우트는 얇게, 로직은 서비스 층)를 따른다. 라우트에 로직이 있으면 테스트가 HTTP를 거쳐야만 가능해진다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
