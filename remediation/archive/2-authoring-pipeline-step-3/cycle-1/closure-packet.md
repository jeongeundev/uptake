# Closure Review — loop 2-authoring-pipeline-step-3, cycle 1

아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).
각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.

## F-001 [major] ABSTRACT가 validateEvidence를 통과하지 못하는 초안을 성공으로 반환한다
- Spec: phases/2-authoring-pipeline/step3.md, PRD AC-1, PRD AC-2, ARCHITECTURE.md 두 층의 게이트
- 원문: contrastEvidence는 역할별 독립 그룹 수와 양방향 참조만 검사하고, load.ts의 evidenceStatus 선언 일치 및 비타깃 스택 조건을 검사하지 않는다. 따라서 observed 요청에 서로 다른 independenceGroup 두 개가 있거나, corroborated 요청의 모든 source가 isTargetStack=true여도 각 역할에 두 그룹의 근거만 있으면 ok:true 초안이 반환된다. 이 초안은 이후 카탈로그 하드 게이트의 validateEvidence에서 거부되므로, 이 step의 '초안은 validateReferences·validateEvidence 검사를 통과해야 한다'는 계약과 등재 단계보다 앞서 오류를 표면화한다는 목적을 위반한다. abstract.test.ts에도 이 두 성공-후-로드거부 경로를 막는 테스트가 없다.
- 주장된 수정: phases/2-authoring-pipeline-step-3-fix-c1/
- 변경 파일: src/lib/engine/abstract.ts, src/lib/catalog/load.ts, src/lib/engine/abstract.test.ts
- 검증 항목: phases/2-authoring-pipeline/step3.md, PRD AC-1, PRD AC-2, ARCHITECTURE.md 두 층의 게이트 준수 및 회귀 테스트 통과 여부
- Verdict: [ ] resolved  [ ] still-open (사유: ___)

## 출력
review-2.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,
severity 불변, closureVerdict ∈ {"resolved","still-open"}.
