# Step 0: wire-production-proposer

## Finding

- **F-001 (major, contract_violation):** 실제 Anthropic proposer가 저작 API의 기본 proposer 선택 경로에 연결되지 않았다.

## 근거와 스펙

- `src/app/api/authoring/proposer.ts` — 현재 테스트 override만 반환하는 Route Handler 계층 선택 함수
- `src/app/api/authoring/drafts/route.ts` — proposer 선택과 명시적 설정 오류 응답
- `src/services/proposer-anthropic.ts` — 실제 환경 기반 Anthropic 어댑터 팩토리
- `src/app/api/authoring/proposer.test.ts` 및 `src/__tests__/authoring-route.test.ts` — 네트워크 없는 회귀 테스트 위치
- `phases/2-authoring-pipeline/step6.md` — 기본 proposer 선택은 Route Handler 계층에서 하며 설정 시 실제 어댑터를 선택
- `phases/2-authoring-pipeline/step7.md` — 실제 어댑터와 provider/model metadata가 Step 6 응답으로 전달
- `docs/ARCHITECTURE.md` — LLM proposer 경계

## 작업

테스트를 먼저 추가해 환경 설정이 있는 프로덕션 기본 경로가 실제 어댑터 팩토리를 선택하지 않는 문제를 재현하고 최소 수정한다.

- 테스트 override가 있으면 기존처럼 override를 우선 사용한다.
- override가 없으면 Route Handler 계층이 `createAnthropicProposerFromEnv()`로 실제 어댑터를 선택한다.
- `UPTAKE_PROPOSER_MODEL` 또는 `ANTHROPIC_API_KEY` 누락은 타입화된 설정 오류로 명시적으로 표면화하고, drafts Route Handler는 이를 현재의 `invalid-request` 400 응답으로 변환한다.
- SDK/API 호출 오류나 그 밖의 예외는 설정 오류로 위장하지 말고 그대로 전파한다.
- 설정된 모델의 `{ providerId: "anthropic", modelId }` metadata가 기존 저작 응답 경로에 전달되는 것을 네트워크 없이 단언한다.

## Acceptance Criteria

```bash
npm run test -- src/app/api/authoring/proposer.test.ts src/__tests__/authoring-route.test.ts src/services/proposer-anthropic.test.ts
npm run lint
npm run build
npm test
```

추가 테스트는 최소한 다음을 단언한다.

1. 테스트 override 부재 + 설정 존재 시 실제 팩토리 결과가 선택된다.
2. 설정 누락 시 Route Handler가 명시적 `invalid-request` 400을 반환한다.
3. 테스트 override는 환경 설정과 무관하게 계속 우선하며 네트워크를 호출하지 않는다.
4. 실제 어댑터 metadata의 model ID가 저작 초안 응답에 보존된다.

## 금지사항

- 모델 ID 기본값이나 스텁 fallback을 추가하지 마라.
- 실제 Anthropic API를 테스트에서 호출하지 마라.
- SDK 오류를 문자열 매칭으로 분류하지 마라.
- `authoring-store`의 결정적 게이트·승인·등재 계약을 변경하지 마라.
- 관련 없는 Route Handler나 UI를 리팩터링하지 마라.
