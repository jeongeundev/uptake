# Closure Review — loop 2-authoring-pipeline-final, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] 입력 변경으로 숨긴 이전 초안이 서버에서 계속 승인 가능하다
- Spec: docs/ARCHITECTURE.md, phases/2-authoring-pipeline/step8.md
- 원문: 저작 입력이나 소스 목록이 변경되면 AuthoringWizard의 invalidateReview는 클라이언트의 draft·approved·registration 표시만 지운다. 기존 draftId에 대응하는 서버 draft-store 레코드는 pending 상태로 남으며, 같은 세션에서 해당 ID의 approve Route Handler를 직접 호출하면 이후 승인과 등재가 가능하다. 따라서 사용자가 현재 화면에서 검토 중인 입력과 다른 이전 초안을 승인할 수 있고, ARCHITECTURE의 입력 변경 시 downstream 서버측 생성·검증·승인 상태 폐기 계약을 충족하지 않는다.
- 주장된 수정: phases/2-authoring-pipeline-final-fix-c1/
- 변경 파일: src/components/authoring-wizard.tsx, src/services/draft-store.ts, src/app/api/authoring/drafts/[draftId]/approve/route.ts, docs/ARCHITECTURE.md
- 검증 항목: docs/ARCHITECTURE.md, phases/2-authoring-pipeline/step8.md 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-002 [minor] AC-C9의 카탈로그 불변 경로를 브라우저 E2E가 검증하지 않는다
- Spec: AC-C9, phases/2-authoring-pipeline/step9.md
- 원문: authoring-pipeline E2E는 유효한 provenance 후보와 resolve 불가 후보를 한 초안에 함께 넣어 폐기 사유를 표시한 뒤, 그 초안을 승인하여 새 카탈로그 파일을 기록한다. Step 9는 resolve 불가 후보를 내는 별도 케이스에서 후보가 초안에 포함되지 않고 provenance-unresolved가 표시되며 카탈로그 파일 수가 전혀 늘지 않는 것을 요구한다. 현재 테스트는 승인 전 일시적인 카탈로그 불변만 확인하므로, unresolved-only 제안이 no-evidence로 중단되고 기록 경로가 열리지 않는 AC-C9 흐름을 브라우저/API 관통 수준에서 증명하지 못한다.
- 주장된 수정: phases/2-authoring-pipeline-final-fix-c1/
- 변경 파일: e2e/authoring-pipeline.spec.ts, e2e/fixtures.config.ts, phases/2-authoring-pipeline/step9.md
- 검증 항목: AC-C9, phases/2-authoring-pipeline/step9.md 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
