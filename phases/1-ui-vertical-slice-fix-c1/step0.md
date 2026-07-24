# Step 0: protect-detected-bindings

## Finding

- **F-001 (major, contract_violation):** API가 자동 탐지된 결합점까지 사용자 값으로 덮어쓴다.

## 근거와 스펙

- `src/lib/engine/detect.ts` — `mergeUserProvidedBindings`
- `src/services/workflow-store.ts` — `mergeWorkflowBindings`
- `src/app/api/workflows/[workflowId]/bindings/route.ts`
- `docs/UI_GUIDE.md` — `binding-unresolved`만 사용자 입력
- `docs/PRD.md` — AC-4

## 작업

테스트를 먼저 추가해 현재 결함을 재현한 뒤 최소 수정한다.

- 서버 병합은 원래 상태가 `binding-unresolved`인 항목만 사용자 입력으로 바꾼다.
- detected 항목과 알 수 없는 binding ID는 사용자 요청으로 덮어쓸 수 없어야 한다.
- 사용자 값은 trim 후 비어 있으면 해결된 binding으로 수용하지 않는다.
- API 직접 호출에서도 위 계약이 유지되도록 service 또는 route 수준 회귀 테스트를 추가한다.
- 기존 detected value와 evidence는 그대로 보존한다.

## Acceptance Criteria

```bash
npm run test -- src/lib/engine/detect.test.ts src/services/workflow-store.test.ts src/app/api/http.test.ts
npm run lint
npm run build
```

추가 테스트는 최소한 다음을 단언한다.

1. detected binding ID에 다른 값을 보내도 value/evidence/status가 바뀌지 않는다.
2. unresolved binding은 trim된 non-empty 입력만 `user-provided`가 된다.
3. 공백 입력은 unresolved로 남아 prepare가 차단된다.

## 금지사항

- 탐지 우선순위나 binding 종류를 재설계하지 마라.
- 클라이언트 검증만 추가해 서버 우회를 남기지 마라.
- 관련 없는 workflow 상태 전이를 리팩터링하지 마라.

