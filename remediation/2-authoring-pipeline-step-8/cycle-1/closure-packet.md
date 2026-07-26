# Closure Review — loop 2-authoring-pipeline-step-8, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] 저작 입력 변경 후 이전 초안과 승인이 폐기되지 않는다
- Spec: docs/ARCHITECTURE.md, phases/2-authoring-pipeline/step8.md
- 원문: 초안을 만든 뒤 patternId, name, intent, capability 또는 evidenceStatus를 변경해도 invalidateReview가 호출되지 않으며, 소스 추가·제거도 동일하다. 따라서 화면 상단 입력은 변경된 상태인데 하단의 이전 초안 승인 버튼은 계속 활성화되어, 사용자가 현재 입력과 다른 서버 초안을 승인·등재할 수 있다. ARCHITECTURE의 수명 계약은 이전 입력 변경 시 downstream 생성·검증·승인 상태를 폐기하도록 요구한다.
- 주장된 수정: phases/2-authoring-pipeline-step-8-fix-c1/
- 변경 파일: src/components/authoring-wizard.tsx, docs/ARCHITECTURE.md
- 검증 항목: docs/ARCHITECTURE.md, phases/2-authoring-pipeline/step8.md 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-002 [major] 초안 거부가 서버 pending 초안을 폐기하지 않는다
- Spec: phases/2-authoring-pipeline/step8.md, docs/ARCHITECTURE.md, docs/PRD.md
- 원문: ‘초안 거부’ 버튼은 클라이언트의 draft 표시만 null로 만들고 서버에 거부 또는 폐기 요청을 보내지 않는다. draft-store에는 rejected 상태나 삭제 연산이 없고 authoring API에도 거부 route가 없으므로, 사용자가 명시적으로 거부한 초안은 서버에서 계속 pending이며 draftId를 보유한 호출자는 이후 승인할 수 있다. 이는 승인/거부만 허용하고 거부 시 초안을 버리라는 Step 8 계약과 맞지 않는다.
- 주장된 수정: phases/2-authoring-pipeline-step-8-fix-c1/
- 변경 파일: src/components/authoring-wizard.tsx, src/services/draft-store.ts, src/app/api/authoring/drafts/[draftId]/approve/route.ts
- 검증 항목: phases/2-authoring-pipeline/step8.md, docs/ARCHITECTURE.md, docs/PRD.md 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-003 [minor] 저작 wizard 테스트가 실제 fetch 기반 화면 흐름을 검증하지 않는다
- Spec: phases/2-authoring-pipeline/step8.md
- 원문: Step 8은 기존 wizard와 같은 방식으로 fetch를 스텁해 서버 응답을 주입하도록 요구하지만, 추가된 테스트는 DraftReview·RegistrationButton·RegistrationResultView를 정적 렌더링하거나 approveAndRegisterDraft 헬퍼만 직접 호출한다. AuthoringWizard의 입력, 초안 요청, 승인, 거부, 등재 상태 전이를 렌더링해 검증하지 않아 입력 변경 후 stale 승인과 클라이언트 전용 거부 같은 결함을 탐지하지 못한다.
- 주장된 수정: phases/2-authoring-pipeline-step-8-fix-c1/
- 변경 파일: src/components/authoring-wizard.test.tsx, src/components/authoring-wizard.tsx, src/components/catalog-bindings-wizard.test.tsx
- 검증 항목: phases/2-authoring-pipeline/step8.md 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
