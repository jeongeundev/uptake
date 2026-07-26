# Step 7: survey-ui

저장소 하나를 넣어 개발 체계 후보를 읽고 고르는 화면을 만든다. **제품의 루트 표면**이므로 페이지 맨 앞에 놓는다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 서술적 태도(ADR-006)
- `/docs/PRD.md` — "Phase 3 범위"의 "한계를 화면에서 밝힌다", "디자인" 절
- `/docs/UI_GUIDE.md` — **확정된 UI 계약.** 도구 미학·다크 고정·시맨틱 포인트. AI 슬롭 안티패턴 금지
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **환각 폐기** · **결과 화면은 한계를 밝힌다** 문단, "상태 관리" 절
- `/docs/ADR.md` — ADR-006(서술적 태도), ADR-017, ADR-019(자생/상속을 분류에 쓰지 않는다)
- `/src/components/authoring-wizard.tsx` — 같은 성격의 기존 마법사. 초안 검토 → 승인 → 등재 흐름과 정직성 표시 방식을 그대로 따른다
- `/src/components/catalog-bindings-wizard.tsx` — **phase 1 확정 계약. 재구조화하지 마라.** 읽기만 한다
- `/src/components/authoring-wizard.test.tsx` — 컴포넌트 테스트 방식
- `/src/app/page.tsx` — 섹션·nav 구성
- `/src/app/api/survey/route.ts` 및 `.../adopt/route.ts` — step 5가 만든 API의 요청·응답 형태
- `/src/app/api/authoring/drafts/[draftId]/approve/route.ts` · `register/route.ts` — 승인·등재는 이 기존 라우트를 쓴다

## 작업

### 1. `src/components/survey-wizard.tsx`

화면 흐름:

```
저장소 식별자 입력 → [조사]
  → 후보 목록  (name · intent · discipline · tradeoffs · confidence · 근거 경로)
  → 후보 선택 → [채택]
  → 초안 검토  (조립된 패턴 · 근거 · 관찰된 스택 사실)
  → [승인] → [등재] → 결과
```

지켜야 할 것:

- **근거 경로를 후보마다 전부 보인다.** 근거를 접어두거나 개수만 표시하지 마라 — 사용자가 무엇을 보고 고르는지가 이 제품의 전부다.
- **폐기를 숨기지 않는다.** 환각으로 버려진 근거(`discardedEvidence`), 통째로 버려진 후보(`discardedCandidates`), 예산·읽기 실패로 수집되지 않은 파일(`skipped`)을 **사유와 함께** 보인다. 접어두는 UI는 괜찮지만 화면에서 사라지면 안 된다.
- **조사가 선 revision을 보인다.** 어느 커밋을 본 결과인지가 결과의 유효 범위다.
- **한계 고지 (필수).** 결과 영역에 두 가지를 명시한다:
  - 이 도구는 그 저장소가 **만든 규율**과 템플릿에서 **상속된 규율**을 구분하지 않는다(ADR-019). 보일러플레이트가 섞여 있을 수 있다.
  - `observed`는 "이 저장소가 실제로 이렇게 한다"까지만 주장하며, 다른 곳도 그렇다거나 이것이 옳다는 주장이 아니다(ADR-006).
  이 문구를 조건부로 숨기거나 토글 뒤에 감추지 마라.
- **`confidence`는 판단 보조일 뿐**임을 화면에서 오해되지 않게 표시한다. 등재물에는 담기지 않는 값이다.
- 승인·등재는 **서버가 판정한다.** 클라이언트 상태의 "승인함" 불리언으로 등재 버튼을 여는 구조를 만들지 마라 — 기존 저작 마법사가 서버 승인 이벤트를 어떻게 다루는지 따른다.
- 등재 실패(patternId 충돌 = 씨앗 보호, 하드 게이트 거부)를 **실패로 표시**한다. 성공처럼 보이게 하지 마라.

`authoring-wizard.tsx`가 이미 갖고 있는 승인·등재 호출 로직을 재사용할 수 있으면 재사용하고, 형태가 다르면 이 컴포넌트 안에 따로 둔다. **기존 저작 마법사를 리팩터하지 마라.**

### 2. `src/app/page.tsx`

SURVEY 섹션을 **맨 앞**에 놓고 nav에 항목을 추가한다. SURVEY가 제품 루트이고 저작·이식이 그 후속이라는 순서가 화면에 드러나야 한다(ADR-017). 기존 두 섹션의 내용·id·구조는 건드리지 마라.

### 3. 테스트 — `src/components/survey-wizard.test.tsx`

`authoring-wizard.test.tsx`의 방식(fetch 모킹 + Testing Library)을 따른다.

- 조사 결과의 후보와 **근거 경로가 화면에 렌더된다**.
- **폐기 표시 (필수)**: `discardedEvidence`·`discardedCandidates`·`skipped`가 응답에 있으면 사유와 함께 화면에 나타난다.
- **한계 고지 (필수)**: 자생/상속 미구분과 `observed`의 주장 범위 문구가 결과 화면에 항상 존재한다.
- 후보를 고르면 채택 요청이 나가고 초안이 렌더된다.
- 등재 실패 응답이 실패로 표시된다(성공 UI가 나타나지 않는다).
- revision이 화면에 표시된다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/components/`, `src/app/`)
   - ADR 기술 스택을 벗어나지 않았는가? (UI 라이브러리를 새로 추가하지 않았는가 — Tailwind만 쓴다)
   - UI_GUIDE.md를 따르는가? (다크 고정·도구 미학·green/red는 장식이 아니라 신호)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (서술적 태도 — 규범적 단정이 없는가)
3. `docs/ARCHITECTURE.md`의 '구현 중 결정 (의도적 유예)' 표에서 **`SURVEY 표면` 행을 제거**하고, "SURVEY 계약 (phase 3)" 절 끝에 확정된 표면(후보·폐기 표시 형태, 한계 고지 위치, 채택→승인 API 경계)을 한 문단으로 추가한다. 기존 문단을 고치지 말고 추가만 하라.
4. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`catalog-bindings-wizard.tsx`를 재구조화하지 마라. 이유: phase 1에서 확정된 UI 계약이다.**
- **`authoring-wizard.tsx`를 리팩터하지 마라(공통화 명목 포함). 이유: 외과적 변경 — 이 step의 범위는 SURVEY 표면이다. 두 마법사의 공통화는 세 번째 사례가 나온 뒤에 판단할 일이다.**
- **폐기된 근거·후보·수집 실패를 화면에서 감추지 마라. 이유: PRD가 폐기 사유의 사용자 표시를 요구사항으로 못박았다. 실패를 안 보이게 하는 UI는 성공 위장이다.**
- **한계 고지를 토글·툴팁 뒤에 숨기거나 조건부로 렌더하지 마라. 이유: 서술적 태도의 물질적 형태다(ADR-006/019). 사용자가 보일러플레이트를 "그 팀의 방법론"으로 오해하면 잘못된 것을 배운다.**
- **클라이언트 상태의 승인 불리언으로 등재를 열지 마라. 이유: 승인은 서버가 판정한다. 클라이언트가 보낸 값을 신뢰하지 않는 것이 상태 관리 계약이다.**
- **후보를 클라이언트에서 편집 가능하게 만들지 마라. 이유: 사용자는 승인/거부만 한다. 편집된 후보는 서버의 폐기 게이트를 통과한 것이 아니다.**
- **새 UI 라이브러리·아이콘 팩·애니메이션 라이브러리를 추가하지 마라. 이유: 도구 미학과 의존성 0 원칙.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
