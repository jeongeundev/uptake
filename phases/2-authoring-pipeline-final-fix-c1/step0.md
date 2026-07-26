# Step 0: invalidate-server-draft-and-prove-c9

## Findings

- **F-001 (major, contract_violation):** 입력 변경으로 UI에서 숨긴 이전 초안이 서버에서 계속 승인·등재 가능하다.
- **F-002 (minor, test_gap):** resolve 불가 후보만 있는 AC-C9 경로에서 카탈로그 완전 불변을 브라우저 E2E가 증명하지 않는다.

## 근거와 스펙

- `src/components/authoring-wizard.tsx` — 입력 변경 시 클라이언트 검토 상태 폐기
- `src/services/draft-store.ts` — 세션 결속 pending/approved/rejected/consumed 상태
- `src/services/authoring-store.ts` — 초안 생성·거부 서비스 경계
- `src/app/api/authoring/drafts/[draftId]/reject/route.ts` — 서버 초안 폐기 API
- `src/app/api/authoring/drafts/[draftId]/approve/route.ts` — 직접 승인 경로
- `e2e/authoring-pipeline.spec.ts` · `e2e/fixtures.config.ts` · `playwright.config.ts` — 브라우저 저작 fixture와 명시적 스텁 주입
- `docs/ARCHITECTURE.md` — 입력 변경 시 downstream 서버측 생성·검증·승인 상태 폐기
- `phases/2-authoring-pipeline/step8.md` — 입력 변경 무효화 계약
- `phases/2-authoring-pipeline/step9.md` — AC-C9 unresolved-only 후보와 카탈로그 불변 E2E

## 작업

TDD로 두 finding을 최소 수정한다.

1. 새 저작 초안이 생성되면 같은 세션의 이전 활성 초안을 서버에서 폐기한다. 이전 초안이 pending 또는 approved였더라도 직접 approve/register 경로가 모두 거절되어야 한다. 현재 draft-store의 세션 소유권과 one-shot 등재 계약을 유지한다.
2. 클라이언트 입력 변경이 새 초안 요청 전까지 서버에 네트워크 폐기를 요구하도록 계약을 넓히지 않는다. 사용자가 변경된 입력으로 새 초안을 요청하는 서버 이벤트에서 이전 초안을 결정적으로 폐기하면 된다.
3. E2E fixture에 resolve 불가 후보만 반환하는 별도 명시적 스텁 스크립트 경로를 추가한다. 프로덕션 기본값으로 활성화하지 않는다.
4. 별도 브라우저 E2E에서 unresolved-only 후보가 `provenance-unresolved` 사유로 표면화되고 승인·등재 UI가 열리지 않으며, 실행 전후 임시 카탈로그의 파일 목록과 씨앗 바이트가 완전히 동일함을 단언한다.

## 재현 테스트

- 서비스 테스트: 같은 세션에서 두 번째 초안을 생성한 뒤 첫 번째 draftId의 approve와 register가 모두 거절된다. 다른 세션의 초안은 영향받지 않는다.
- Route Handler 테스트: 새 draft POST 뒤 이전 draft ID에 대한 approve/register 요청이 성공하지 않는다.
- 브라우저 E2E: unresolved-only 스텁으로 초안 생성 시 `provenance-unresolved`가 보이고 카탈로그 파일 수가 늘지 않는다.

## Acceptance Criteria

```bash
npm test -- src/services/draft-store.test.ts src/services/authoring-store.test.ts src/__tests__/authoring-route.test.ts
npm run lint
npm run build
npm test
npm run test:e2e
python3 -m pytest scripts/ -q
```

## 금지사항

- 실제 Anthropic API를 호출하지 마라.
- 스텁 proposer를 기본값으로 만들지 마라.
- 자기검증이나 VERIFY를 mock으로 대체하지 마라.
- 저장소의 `catalog/`에 E2E 파일을 쓰지 마라.
- 기존 `e2e/vertical-slice.spec.ts`를 수정하지 마라.
- 입력 변경마다 fire-and-forget reject 요청을 추가하지 마라.
- manifest를 직접 편집하지 마라.
- 이 fix step 안에서 review·triage·closure·rule 또는 `$remediate`를 실행하지 마라.
