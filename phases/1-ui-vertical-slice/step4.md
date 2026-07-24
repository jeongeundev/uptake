# Step 4: vertical-slice-e2e

## 읽어야 할 파일

- `/AGENTS.md`
- `/docs/HANDOFF.md` — AC-11과 현재 기준선
- `/docs/PRD.md` — AC-3/4/9/10/11/12, 데모 필수조건
- `/docs/ARCHITECTURE.md`
- `/docs/UI_GUIDE.md`
- `/src/__tests__/pipeline.integration.test.ts` — 런타임 Git fixture 패턴 재사용 참고
- step 1~3에서 만든 API와 UI
- `/scripts/hooks/tdd-guard.sh`와 `/scripts/test_tdd_guard.py`

## 작업

UI를 포함한 실제 브라우저 E2E를 추가하고 전체 vertical slice를 검증한다.

- 현재 프로젝트에 없는 경우 `@playwright/test`만 최소 dev dependency로 추가하고 Chromium 하나만 사용한다.
- `playwright.config.ts`, E2E 테스트 디렉토리, `npm run test:e2e`를 추가한다.
- 테스트 시작 전에 임시 디렉토리에 다음을 런타임 구성한다.
  - pattern JSON이 가리키는 서로 독립적인 Python 스택 source Git repo 2개와 정확한 revision/provenance 파일.
  - JS/TS + vitest target Git repo. 실제 fixture 원본을 수정하지 않는다.
  - 앱 서버에 fixture catalog/source root를 환경변수로 전달한다. 필요하면 catalog dir 환경변수를 새로 정의하되 기본값은 기존 `catalog/`로 유지한다.
- 브라우저에서 실제로 다음을 수행한다.
  1. corroborated+generative 패턴 선택
  2. 타깃 절대경로 입력
  3. 결합점 값+근거 확인 및 unresolved 값 입력
  4. frozen argv/cwd/timeout이 보이는지 확인
  5. “이식 실행” 클릭
  6. 양성 통과와 음성 red 탐지가 모두 성공으로 표시되는지 확인
  7. 생성 파일별 add diff 확인
  8. 승인·적용
  9. 타깃에 기대 파일이 실제 생성됐는지 확인
- 최소 한 개의 차단 시나리오도 검사한다. 승인 버튼을 거치지 않은 직접 apply 요청 또는 다른 browser context/session의 workflow 접근이 파일을 쓰지 못해야 한다.
- 테스트 종료 후 임시 repo와 서버를 정리한다. 실패해도 정리되게 한다.
- E2E를 unit test 명령에 섞지 말고 별도 script로 둔다.

브라우저 설치가 환경에 없어 E2E를 실행할 수 없다면 test를 skip해 green으로 만들지 말고 step을 `blocked`로 정직하게 종료한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:e2e
python3 -m pytest scripts/ -q
```

## 검증 절차

1. `npm run test:e2e`가 UI를 실제 브라우저로 통과하는지 확인한다.
2. source stack이 Python이고 target이 JS/TS+vitest인지 fixture에서 단언한다.
3. 음성 위반이 reporter의 `gateTestId` 실패로 잡힌 결과인지 확인한다. 인프라 오류를 성공으로 세지 않는다.
4. 기존 76개 이상 unit/integration test와 hook 98개 이상이 회귀 없이 통과하는지 확인한다.
5. 성공 시 summary에 E2E 시나리오, 브라우저, 전체 AC 커맨드 결과를 기록한다.

## 금지사항

- 실제 `.uptake/sources`나 사용자의 repo를 E2E가 수정하지 마라.
- 씨앗 부재·브라우저 부재·서버 실패를 skip으로 성공 처리하지 마라.
- 네트워크 clone이나 타깃 의존성 install을 제품 코드에서 수행하지 마라.
- E2E를 API 호출만으로 대체하지 마라. AC-11은 UI 포함이다.
- 기존 테스트를 깨뜨리지 마라.

