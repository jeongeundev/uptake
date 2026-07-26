# Closure Review — loop 2-authoring-pipeline-step-7, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] 실제 Anthropic proposer가 저작 API에 연결되지 않음
- Spec: phases/2-authoring-pipeline/step6.md — proposer 선택, phases/2-authoring-pipeline/step7.md — 실제 Anthropic 어댑터 및 저작 세션 메타데이터, docs/ARCHITECTURE.md — LLM proposer 경계
- 원문: createAnthropicProposerFromEnv()가 구현됐지만 프로덕션 코드에서는 호출되지 않는다. configuredAuthoringProposer()는 테스트 전용 전역 변수만 반환하므로, ANTHROPIC_API_KEY와 UPTAKE_PROPOSER_MODEL을 모두 설정해도 POST /api/authoring/drafts는 항상 "authoring proposer adapter is not configured"를 반환한다. 따라서 실제 어댑터와 그 metadata가 Step 6 저작 세션을 통해 사용되는 런타임 경로가 없으며, 테스트 주입 없이 앱의 대상 지정 저작 기능을 실행할 수 없다.
- 주장된 수정: phases/2-authoring-pipeline-step-7-fix-c1/
- 변경 파일: src/app/api/authoring/proposer.ts, src/services/proposer-anthropic.ts, src/app/api/authoring/drafts/route.ts
- 검증 항목: phases/2-authoring-pipeline/step6.md — proposer 선택, phases/2-authoring-pipeline/step7.md — 실제 Anthropic 어댑터 및 저작 세션 메타데이터, docs/ARCHITECTURE.md — LLM proposer 경계 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
