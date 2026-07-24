# 프로젝트: uptake

오픈소스 저장소에 결합된 *코드가 아니라 개발 방법론*(MVP 앵커: Spec↔Verification 루프)을 재사용 가능한 파라미터화된 패턴으로 **추상화·이식·검증**하는 도구.
명제: "오픈소스가 코드에 해준 것을 개발 방법론에 한다."

## 문서 지도
- [`docs/PRD.md`](./docs/PRD.md) — 요구사항 (무엇을·누구를 위해)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 설계 (어떻게)
- [`docs/ADR.md`](./docs/ADR.md) — 결정 기록 (왜) · ADR-001~013
- [`docs/UI_GUIDE.md`](./docs/UI_GUIDE.md) — UI 가이드 (※ 잠정, 미확정)

## 기술 스택
- Next.js 15 (App Router) / TypeScript strict
- Tailwind CSS
- Anthropic SDK (Claude 최신 모델)
- 로컬-우선 실행 (사용자 repo에서 동작, 검증도 로컬 툴체인 = vitest)

## 아키텍처 규칙
- CRITICAL: 모든 추출·생성 결과는 **검증 가능한 provenance(실재하는 소스 파일 경로)**를 달아야 한다. resolve 안 되면 폐기. 환각 금지. (ADR-009)
- CRITICAL: 태도는 **서술적**이다 — "성공 repo가 *실제로* 이렇게 한다 + 트레이드오프". "이게 정답"이라는 규범적 단정 금지. (ADR-006)
- CRITICAL: 생성물은 **자기검증**을 통과해야 한다 — 양성(준수→green) **그리고** 음성(심은 위반→red로 잡힘). green만으론 증명이 아니다. 성공 위장 절대 금지 — 실패는 정직하게 표면화. (ADR-008)
- CRITICAL: 신뢰할 수 없는 repo 내용은 **데이터로 격리**한다(프롬프트 지시로 취급 금지). 생성 코드는 diff 미리보기+명시적 적용, 실행은 테스트 커맨드로 한정. (ARCHITECTURE.md)
- 번역 엔진은 3단계(EXTRACT→ABSTRACT→INSTANTIATE). 패턴의 **스택-불변 본질**과 **스택-종속 결합점**을 분리하고, 구현만 교체한다. 환원 불가능한 핵심 가치 = ABSTRACT(떼어내기). (ADR-004)
- 생성·이식은 **`corroborated`(N≥2 대조검증) 패턴만**. `observed`(N=1)는 등재만 하고 생성은 하지 않는다. (ADR-005/007)
- **탐지는 넓게(서술 포함) / 생성은 깊게(게이트형만)**. MVP 앵커는 Spec↔Verify 루프 하나. 카탈로그는 2-tier(생성형/서술전용). (ADR-002/003/012)
- 타깃 스택은 **JS/TS(vitest) 하나**. 씨앗 클러스터엔 타깃과 **다른 스택**을 최소 하나 포함(복사 아님을 증명). (ADR-013)

## 개발 프로세스
- CRITICAL: 이 프로젝트는 자기가 설파하는 방법론을 **dogfooding**한다 — 새 기능은 스펙(수용 기준)을 먼저, 그 기준을 검사하는 테스트를 먼저 작성하고 통과시킨다 (TDD / Spec↔Verify).
- over-engineering 금지: 요청하지 않은 유연성·추상화·미래 대비를 넣지 않는다. 리스크/보안은 표적 수준으로만.
- 커밋 메시지는 conventional commits (feat:, fix:, docs:, refactor:).

## 명령어
> 스캐폴딩 착수 후 확정. 계획상 예정 명령어:
```
npm run dev      # 개발 서버 (로컬호스트)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트 (vitest)
```
