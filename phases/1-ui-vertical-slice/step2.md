# Step 2: catalog-bindings-ui

## 읽어야 할 파일

- `/AGENTS.md`
- `/docs/UI_GUIDE.md`
- `/docs/PRD.md` — AC-3, AC-4
- `/docs/ARCHITECTURE.md`
- `/src/app/page.tsx`
- `/src/app/layout.tsx`
- `/src/app/globals.css`
- step 1에서 만든 `/src/app/api/`와 `/src/services/workflow-store.ts`

## 작업

테스트를 먼저 작성한 뒤 단일 페이지 wizard의 앞부분을 구현한다.

- 필요한 부분만 client component로 분리하고, 파일시스템·엔진 호출은 route handler에 남긴다.
- 카탈로그 카드에 name, intent, `capability`, `evidenceStatus`, `generationEnabled`, tradeoffs, 모든 provenance의 source/revision/path를 표시한다.
- `generationEnabled=false` 패턴도 보이지만 선택/생성 버튼은 비활성이고 이유를 텍스트로 설명한다.
- load rejection 목록을 별도 오류 영역에 file/reason/detail로 표시한다. 실제 씨앗이 없을 때 성공한 것처럼 빈 카탈로그만 보여주지 않는다.
- 사용자가 절대 타깃 경로를 입력하고 workflow를 시작하게 한다. 적격성 오류는 서버 detail을 그대로 정직하게 표시한다.
- 각 binding에 kind, value, status, evidence path를 표시한다.
- `binding-unresolved`에만 텍스트 입력을 제공하고, 모두 채워지기 전 다음 단계 진행을 막는다.
- provenance/evidence는 클릭 가능한 웹 링크로 위장하지 말고 모노스페이스 로컬 근거 텍스트로 표시한다.
- 단일 페이지의 현재 단계와 완료 단계를 명확히 하되 불필요한 라우팅·상태관리 라이브러리는 추가하지 않는다.
- 기존 UI 가이드의 도구 미학, 의미색, AI 슬롭 금지를 따른다.

테스트는 적어도 다음을 검사한다.

- generative+corroborated는 선택 가능, observed/descriptive fixture는 보이되 비활성(AC-3).
- tradeoffs와 provenance가 렌더된다.
- detected binding의 값+근거 경로, unresolved 입력과 빈 값 차단(AC-4).
- rejected provenance가 사용자에게 보인다.

## Acceptance Criteria

```bash
npm run test
npm run lint
npm run build
```

## 검증 절차

1. AC-3과 AC-4 실패 테스트를 먼저 추가한다.
2. 클라이언트 번들에서 Node filesystem/engine 모듈을 import하지 않는지 확인한다.
3. 성공 시 summary에 생성/수정 컴포넌트와 AC-3/4 테스트를 기록한다.

## 금지사항

- 뒤 단계인 gate 실행·승인·적용 UI를 구현하지 마라. 이유: step 범위를 카탈로그와 결합점 레이어로 제한한다.
- UI 테스트를 위해 실제 catalog hard gate를 약화하지 마라. fixture를 사용하라.
- 새 패턴을 실제 `catalog/`에 추가하지 마라.
- 장식용 색, glass, gradient, 보라색 브랜드, 균일한 거대 카드 UI를 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.

