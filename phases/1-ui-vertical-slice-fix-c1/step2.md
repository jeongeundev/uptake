# Step 2: preserve-and-show-verify-logs

## Finding

- **F-003 (major, contract_violation):** VERIFY가 삭제된 로그 경로를 반환하고 UI는 실행 출력을 노출하지 않는다.

## 근거와 스펙

- `src/lib/engine/verify.ts`
- `src/services/gate-runner.ts`
- `src/services/workflow-store.ts`
- `src/components/catalog-bindings-wizard.tsx`
- `docs/ARCHITECTURE.md` — VERIFY 실행 계약의 출력 보존·제한 표시·잘림 표시·전체 로그 경로

## 작업

테스트를 먼저 추가해 반환 직후 로그 경로가 사라지고 UI에 출력 정보가 없는 결함을 재현한 뒤 최소 수정한다.

- positive/negative workspace 정리는 유지하되, 반환하는 전체 로그는 그 workspace와 독립된 접근 가능한 임시 경로에 보존한다.
- VERIFY 성공 응답과 UI에 positive/negative 각각의 제한된 출력, 잘림 여부, 전체 로그 경로를 제공한다.
- UI는 두 실행의 정보와 잘림 여부를 명확히 표시한다.
- 기존 gate taxonomy, frozen argv, 승인 조건, 생성 diff 계약은 바꾸지 않는다.
- 프로세스 수명 MVP 범위에서 필요한 최소 로그 수명만 구현하고 범용 로그 관리 시스템을 만들지 않는다.

## Acceptance Criteria

```bash
npm run test -- src/lib/engine/verify.test.ts src/services/workflow-store.test.ts src/components/catalog-bindings-wizard.test.tsx
npm run lint
npm run build
```

추가 테스트는 최소한 다음을 단언한다.

1. `executeVerification` 성공 반환 뒤 positive/negative 전체 로그 경로가 실제로 존재하고 내용을 읽을 수 있다.
2. positive/negative 출력 preview와 잘림 여부가 API 결과에 보존된다.
3. UI가 preview, 잘림 표시, 전체 로그 경로를 렌더한다.

## 금지사항

- workspace 자체를 보존해 타깃 복제본과 주입 산출물을 불필요하게 남기지 마라.
- stdout/stderr 전문을 브라우저 응답에 무제한으로 싣지 마라.
- gate 결과를 raw exit code로 다시 판정하지 마라.
- 관련 없는 UI 스타일이나 엔진 계약을 리팩터링하지 마라.

