# Step 0: ignore-playwright-results

독립 full review의 F-001만 수정한다. 제품 코드나 E2E 동작을 변경하지 않는다.

## Finding

- ID: F-001
- 근거 파일: `test-results/.last-run.json`, `.gitignore`
- 위반 스펙: `AGENTS.md` §3 외과적 변경

Playwright가 생성하는 `test-results/.last-run.json`이 추적되고 `test-results/`가 ignore되지 않아 E2E 실행 결과가 제품 변경과 무관하게 작업 트리를 오염시킨다.

## 재현

```bash
git ls-files test-results
git check-ignore -q --no-index test-results/.last-run.json
```

수정 전 첫 명령은 추적 파일을 출력하고 두 번째 명령은 non-zero다.

## 작업

1. `.gitignore`에 `test-results/`를 추가한다.
2. 추적된 `test-results/.last-run.json`을 저장소에서 제거한다.

## 금지사항

- 제품 코드, 테스트 코드, Playwright 설정을 변경하지 마라.
- 다른 생성 파일이나 기존 ignore 규칙을 정리하지 마라.

## Acceptance Criteria

```bash
test -z "$(git ls-files test-results)"
git check-ignore -q --no-index test-results/.last-run.json
npm run test:e2e
test -z "$(git status --short -- test-results)"
```

모두 통과하면 `index.json`의 step 0을 `completed`로 바꾸고 summary에 F-001 수정 내용을 한 줄로 기록한다.
