# Closure Review — loop 1-ui-vertical-slice, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] API가 자동 탐지된 결합점까지 사용자 값으로 덮어쓴다
- Spec: AC-4
- 원문: bindings endpoint는 임의의 string map을 받고, mergeUserProvidedBindings는 기존 상태가 binding-unresolved인지 확인하지 않은 채 동일 bindingId의 모든 탐지 결과를 user-provided로 교체한다. 따라서 직접 HTTP 요청으로 evidence가 있는 detected checker·gate-location을 바꿀 수 있다. 이는 UI_GUIDE의 “binding-unresolved인 결합점만 직접 입력” 계약과 서버가 탐지 결과를 보관한다는 phase 계약을 우회하며, 공백 문자열도 서버에서는 해결된 값으로 수용한다.
- 주장된 수정: phases/1-ui-vertical-slice-fix-c1/
- 변경 파일: src/lib/engine/detect.ts, src/services/workflow-store.ts, src/app/api/workflows/[workflowId]/bindings/route.ts, docs/UI_GUIDE.md, phases/1-ui-vertical-slice/step1.md
- 검증 항목: AC-4 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-002 [major] E2E teardown이 외부에서 지정한 fixture root를 재귀 삭제한다
- Spec: AC-11
- 원문: Playwright 설정은 UPTAKE_E2E_FIXTURE_ROOT가 이미 설정되어 있으면 그 디렉터리를 재사용하지만, global teardown은 fixture를 이번 실행에서 생성했는지 구분하지 않고 해당 경로를 rmSync(..., recursive: true)로 삭제한다. 네 개의 재사용 환경변수를 지정해 기존 fixture나 사용자 디렉터리에서 테스트를 실행하면 테스트 종료 시 그 루트 전체가 삭제된다. 이는 임시 repo만 정리하고 사용자 repo를 수정하지 말라는 step 4 계약을 위반한다.
- 주장된 수정: phases/1-ui-vertical-slice-fix-c1/
- 변경 파일: playwright.config.ts, e2e/global-teardown.config.ts, phases/1-ui-vertical-slice/step4.md
- 검증 항목: AC-11 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-003 [major] VERIFY가 삭제된 로그 경로를 반환하고 UI는 실행 출력을 노출하지 않는다
- Spec: -
- 원문: executeVerification은 positiveLog와 negativeLog를 각각 임시 positive/negative workspace 안의 경로로 반환하지만, 응답을 반환하기 전에 finally에서 두 workspace를 재귀 삭제한다. 결과적으로 반환된 전체 로그 경로는 사용자가 접근할 수 없다. CatalogBindingsWizard도 이 필드를 타입에만 선언하고 성공 화면에서 렌더하지 않는다. 이는 stdout/stderr 전문을 보존하고 UI에 제한된 출력·잘림 표시·접근 가능한 전체 로그 경로를 제공한다는 ARCHITECTURE의 VERIFY 계약을 충족하지 못한다.
- 주장된 수정: phases/1-ui-vertical-slice-fix-c1/
- 변경 파일: src/lib/engine/verify.ts, src/components/catalog-bindings-wizard.tsx, docs/ARCHITECTURE.md
- 검증 항목: - 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
