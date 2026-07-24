# Step 1: protect-external-e2e-fixtures

## Finding

- **F-002 (major, contract_violation):** E2E teardown이 외부에서 지정한 fixture root를 재귀 삭제한다.

## 근거와 스펙

- `playwright.config.ts`
- `e2e/fixtures.config.ts`
- `e2e/global-teardown.config.ts`
- `phases/1-ui-vertical-slice/step4.md`
- `docs/PRD.md` — AC-11

## 작업

테스트를 먼저 추가해 외부 fixture root 삭제 위험을 재현한 뒤 최소 수정한다.

- 이번 Playwright 실행이 직접 생성한 임시 fixture root인지 명시적으로 구분한다.
- teardown은 이 실행이 소유한 임시 root만 삭제한다.
- 환경변수로 재사용한 외부 fixture root는 절대 삭제하지 않는다.
- 소유권 신호는 단순하고 실행 단위로 한정하며, 경로 추측으로 소유권을 판정하지 않는다.

## Acceptance Criteria

```bash
npm run test
npm run lint
npm run build
```

추가 테스트는 최소한 다음을 단언한다.

1. runner가 생성한 fixture root는 teardown 시 삭제된다.
2. 외부 제공 fixture root와 그 안의 sentinel 파일은 teardown 뒤에도 남는다.

## 금지사항

- 외부 경로를 prefix나 디렉터리 이름만으로 “임시”라고 판단하지 마라.
- 실제 사용자 디렉터리를 테스트 중 삭제하지 마라.
- E2E fixture 생성 구조 전체를 재설계하지 마라.

