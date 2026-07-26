# Step 8: authoring-ui

저작 파이프라인을 사용자가 실제로 조작할 수 있게 노출한다. **사용자가 하는 일은 입력·검토·승인/거부**다 — 승인 노동이 남는 것이 정직성의 값이다(ADR-015).

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/UI_GUIDE.md` — 확정된 UI 계약 전체. **"AI 슬롭 안티패턴 — 하지 마라" 표를 반드시 지켜라.** 디자인 원칙(도구처럼 보일 것 / 상태가 곧 UI / 정직·투명)
- `/docs/PRD.md` — "Phase 2 범위" 요구사항, "디자인" 절(다크 고정, 무채색 + 시맨틱 green/red)
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약"의 **판정 주체**·**초안 수명 · 승인 · 등재**
- `/src/components/catalog-bindings-wizard.tsx` — 기존 UI. 스타일·구조의 기준
- `/src/components/catalog-bindings-wizard.test.tsx` — 컴포넌트 테스트 형태
- `/src/app/page.tsx` — 페이지 진입점
- 이전 step 산출물: `/src/services/authoring-store.ts`(응답 형태), `/src/app/api/authoring/` 라우트

## 작업

### 1. `src/components/authoring-wizard.tsx`

새 컴포넌트를 만들고 `src/app/page.tsx`에서 기존 이식 wizard와 함께 접근 가능하게 배치한다. **기존 `catalog-bindings-wizard.tsx`를 대대적으로 고치지 마라** — phase 1의 확정 계약이고 E2E가 의존한다. 배치를 위한 최소 변경만 허용된다.

화면 흐름:

1. **입력** — `patternId`·`name`·`intent`·`capability`·`evidenceStatus`, 그리고 소스 저장소 목록. 소스마다 `repository`·`stack`·`isTargetStack`·`independenceGroup`·`independenceNote`를 사용자가 입력한다.
   - `corroborated`를 고르면 소스 2개 이상이 필요하다는 것을 화면에서 알 수 있어야 한다.
   - **`independenceGroup`과 `isTargetStack`은 사용자 입력 필드다.** 앱이 자동으로 채우거나 추천값을 미리 넣어두지 마라 — 이 값들은 큐레이터의 판정이다(ADR-005).
2. **초안 검토** — 서버가 반환한 초안을 그대로 보인다.
   - `roles`·`bindingPoints`·`provenance`(sourceId + 경로 + 역할)
   - **corroboration 계산 결과**: 역할별 지지 `independenceGroup` 목록, distinct 그룹 수. "이 값은 당신이 입력한 그룹을 센 결과이며 판정이 아니다"가 화면에서 분명해야 한다.
   - **강등된 role**: 어떤 role이 왜 binding으로 내려갔는지.
   - **버려진 후보**(`discarded`): 경로와 사유. 특히 `provenance-unresolved`를 숨기지 마라 — 환각이 걸러진 흔적이 사용자에게 보여야 한다(AC-C9).
   - **target stack 사실**(`targetStackFacts`): 관찰 결과와 근거. 판정 문구로 쓰지 마라("vitest가 관찰됨"이지 "타깃 스택임"이 아니다).
   - **oracle과 자기검증 결과**: `passed`면 양성 green·음성 red가 확인되었음을, `failed`면 사유를, `skipped`면 descriptive라 건너뛰었음을 표시한다.
   - `tradeoffs` 서술.
3. **승인/거부** — 명시적 승인 후에만 등재 버튼이 활성화된다. 거부하면 초안을 버린다(후보 편집은 이번 범위 밖이다 — 편집 UI를 만들지 마라).
4. **등재 결과** — 성공하면 쓰인 파일 경로를, 실패하면 사유를 보인다. `pattern-exists`는 "기존 패턴은 변경되지 않았다"는 사실과 함께 표시하라(AC-C10).

### 2. 정직성 규칙 (UI_GUIDE 디자인 원칙 3의 적용)

- **자기검증 실패를 성공처럼 보이게 하지 마라.** `self-verify-failed`는 red이고 승인 경로가 열리지 않는다.
- **`negative-not-caught`는 green과 반대 의미다.** 게이트가 통과(green)했기 때문에 실패다 — 이 상태를 초록으로 칠하지 마라.
- **버려진 후보 수가 0이 아닐 때 그것을 숨기지 마라.** "5개 근거 확정"만 보이고 "3개 폐기"가 안 보이면 빈 성공 화면과 구별되지 않는다.
- 색은 의미에만 쓴다 — green = 검증 통과, red = 차단/거부.

### 3. `docs/UI_GUIDE.md` 갱신

phase 2 저작 화면의 확정 계약을 문서에 추가하라. 최소한:

- 저작 흐름의 단계
- `independenceGroup`·`isTargetStack`이 사용자 입력이며 앱이 채우지 않는다는 계약
- 자기검증 상태별 표시 문구와 색 (phase 1의 VERIFY 상태 표와 같은 형태로)
- 폐기된 후보·강등된 role을 반드시 표시한다는 규칙

문서 상단의 "phase 1 단일 페이지 UI의 확정 계약" 서술이 phase 2를 포함하도록 범위를 갱신하라.

### 4. 테스트 — `src/components/authoring-wizard.test.tsx`

기존 `catalog-bindings-wizard.test.tsx`와 같은 방식(fetch를 스텁해 서버 응답을 주입)으로 검사한다.

- 초안 응답을 주면 roles·provenance·corroboration·discarded가 화면에 나타난다.
- 자기검증 `failed` 응답이면 승인 버튼이 활성화되지 않는다.
- 승인 전에는 등재를 시도할 수 없다.
- `pattern-exists` 응답 시 기존 패턴 불변 사실이 표시된다.
- `discarded`가 있으면 사유와 함께 표시된다(숨겨지지 않는다).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/components/`)
   - ADR 기술 스택을 벗어나지 않았는가? (Tailwind, 다크 고정)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
   - **UI_GUIDE.md의 AI 슬롭 안티패턴 표를 전부 지켰는가?**
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`independenceGroup`·`isTargetStack`을 앱이 자동으로 채우거나 기본값을 넣지 마라. 이유: 판정 주체는 사용자다(ADR-005). 미리 채워진 값은 사용자가 판정했다는 착시를 만든다.**
- **후보 편집 UI를 만들지 마라. 이유: 이번 범위는 승인/거부뿐이다(ADR-014). 편집은 후속 phase다.**
- **폐기된 후보·강등된 role·자기검증 실패를 숨기거나 축소하지 마라. 이유: 실패를 숨기지 않는 것이 UI_GUIDE 원칙 3이며, 환각이 걸러진 흔적이 사용자에게 보여야 AC-C9가 실재한다.**
- **UI_GUIDE의 AI 슬롭 안티패턴을 쓰지 마라(backdrop-filter blur, gradient-text 등 표에 적힌 전부). 이유: 문서에 명시된 금지 사항이다.**
- **기존 `catalog-bindings-wizard.tsx`를 재구조화하지 마라. 이유: phase 1의 확정 UI 계약이고 브라우저 E2E가 그 DOM에 의존한다. 배치를 위한 최소 변경만 하라.**
- **클라이언트 상태로 승인을 대체하지 마라. 이유: 승인은 서버 저장소의 상태 전이다. UI의 boolean은 화면 조작일 뿐이다.**
- 기존 테스트를 깨뜨리지 마라.
