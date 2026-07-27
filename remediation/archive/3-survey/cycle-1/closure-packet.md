# Closure Review — loop 3-survey, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] 모든 후보가 폐기되면 폐기 경로와 사유가 사용자에게 사라진다
- Spec: docs/ARCHITECTURE.md 「SURVEY 계약 — 환각 폐기 — 2단」, docs/PRD.md 「Phase 3 범위 — 모든 후보 근거는 고정된 revision에서 resolve된다」, ADR-009
- 원문: surveyRepository는 모든 제안이 invalid-shape, duplicate-id 또는 no-evidence로 폐기되면 누적한 discardedEvidence와 discardedCandidates를 버리고 일반적인 no-candidate 오류만 반환한다. runSurvey도 이 일반 detail만 전달하며 SurveyWizard는 성공 응답일 때만 Discards를 렌더링한다. 따라서 환각 근거만 제안된 실행에서는 사용자가 어떤 경로가 not-collected였고 어떤 후보가 no-evidence로 폐기됐는지 볼 수 없다. 이는 두 단계의 모든 폐기를 사유와 함께 보여야 하며 조용히 사라지는 후보가 없어야 한다는 SURVEY 계약을 위반한다.
- 주장된 수정: phases/3-survey-fix-c1/
- 변경 파일: src/lib/engine/survey.ts, src/services/survey-service.ts, src/components/survey-wizard.tsx
- 검증 항목: docs/ARCHITECTURE.md 「SURVEY 계약 — 환각 폐기 — 2단」, docs/PRD.md 「Phase 3 범위 — 모든 후보 근거는 고정된 revision에서 resolve된다」, ADR-009 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-002 [major] SURVEY 구조화 출력 소진 오류가 화면에 명시적으로 표면화되지 않는다
- Spec: docs/ARCHITECTURE.md 「SURVEY proposer 경계」, ADR-015
- 원문: Anthropic 어댑터는 JSON 파싱 또는 스키마 검증이 세 번 실패하면 일반 Error를 던진다. SURVEY Route Handler는 proposer 구성 오류만 잡고 runSurvey에서 발생한 이 오류는 처리하지 않는다. 클라이언트 postJson은 모든 응답이 JSON이라고 가정하며 investigate에도 try/finally가 없으므로, 프레임워크의 비정형 500 응답에서는 response.json()이 거부되고 UI는 오류 상세를 표시하지 못한 채 busy 상태에 남을 수 있다. 결정적 재검증 실패를 부분 후보 없이 명시적 오류로 표면화한다는 proposer 계약의 후반부가 제품 경계에서 성립하지 않는다.
- 주장된 수정: phases/3-survey-fix-c1/
- 변경 파일: src/app/api/survey/route.ts, src/services/proposer-anthropic.ts, src/components/survey-wizard.tsx
- 검증 항목: docs/ARCHITECTURE.md 「SURVEY proposer 경계」, ADR-015 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## F-003 [minor] SURVEY 채택의 independenceGroup이 저장소 식별자 그대로가 아니다
- Spec: docs/ARCHITECTURE.md 「SURVEY 계약 — AuthoringRequest 자동 조립」
- 원문: 채택 조립표는 sources[0].independenceGroup을 사용자가 지정한 저장소 식별자 그대로 저장하도록 고정한다. 구현은 repository를 소문자 kebab 형태의 sourceId로 정규화한 뒤 그 sourceId를 independenceGroup에도 사용한다. 예를 들어 서로 다른 식별자 a/b와 a-b가 같은 그룹 값으로 직렬화될 수 있으며, 등재물도 문서화된 결정적 조립 결과와 달라진다.
- 주장된 수정: phases/3-survey-fix-c1/
- 변경 파일: src/lib/engine/survey-adopt.ts
- 검증 항목: docs/ARCHITECTURE.md 「SURVEY 계약 — AuthoringRequest 자동 조립」 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
