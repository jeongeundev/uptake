# Step 0: invalidate-draft-on-input-change

독립 closure review에서 still-open으로 남은 F-001만 수정한다. 신규 기능이나 범위 밖 리팩터링은 하지 않는다.

## Finding

저작 입력 변경 시 클라이언트는 review 상태만 지우며 서버의 기존 draft는 유지한다. cycle 1은 같은 세션에서 새 draft를 생성할 때 이전 draft를 폐기했지만, 입력을 바꾼 직후 새 초안을 제출하기 전에는 과거 `draftId`를 직접 승인할 수 있다. 이는 `docs/ARCHITECTURE.md`의 “이전 입력을 바꾸면 downstream 서버측 생성·검증·승인 상태를 폐기한다” 계약을 충족하지 못한다.

## 작업

1. 입력 변경 시 현재 draft를 서버에서 명시적으로 reject하는 최소 API/서비스 경로를 추가한다.
2. `AuthoringWizard`의 입력 무효화가 현재 draft가 있을 때 해당 서버 경로를 호출하도록 연결한다. UI 상태는 즉시 폐기하되 서버 폐기도 누락하지 않는다.
3. 폐기된 draft는 직접 approve와 register 모두 거절되어야 한다.
4. 다른 세션의 draft는 영향을 받지 않아야 한다.
5. 입력 변경 직후, 새 draft POST 없이도 이전 `draftId` 직접 approve가 거절됨을 Route Handler 또는 브라우저 회귀 테스트로 증명한다.

## 검증

```bash
npm run lint
npm run build
npm test
npm run test:e2e
python3 -m pytest scripts/ -q
```

## 완료

AC가 모두 통과하면 `index.json` step 0을 `completed`로 바꾸고 한 줄 summary를 기록한다.
