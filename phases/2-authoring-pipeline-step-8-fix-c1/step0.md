# Step 0: invalidate-and-reject-authoring-drafts

## Findings

- **F-001 (major, contract_violation):** 저작 입력 변경 후 이전 초안과 승인이 폐기되지 않는다.
- **F-002 (major, contract_violation):** 초안 거부가 서버 pending 초안을 폐기하지 않는다.
- **F-003 (minor, test_gap):** 저작 wizard 테스트가 실제 fetch 기반 화면 흐름을 검증하지 않는다.

## 근거와 스펙

- `src/components/authoring-wizard.tsx` — 저작 입력·초안 검토·승인·거부·등재 UI
- `src/components/authoring-wizard.test.tsx` — 현재 정적 하위 view 중심 테스트
- `src/services/draft-store.ts` — 세션 결속 pending/approved/consumed 초안 상태
- `src/services/authoring-store.ts` — 저작 서비스 경계
- `src/app/api/authoring/drafts/[draftId]/approve/route.ts` — 승인 Route Handler 패턴
- `docs/ARCHITECTURE.md` — 입력 변경 시 downstream 상태 폐기, 초안 승인/거부와 서버 상태 계약
- `docs/PRD.md` — 사람 승인 뒤에만 등재
- `phases/2-authoring-pipeline/step8.md` — 입력·검토·승인/거부 UI와 fetch 스텁 테스트 요구

## 작업

테스트를 먼저 추가해 세 finding을 재현하고 최소 수정한다.

1. `patternId`, `name`, `intent`, `capability`, `evidenceStatus`, 모든 source 필드, source 추가·제거 중 하나라도 바뀌면 이전 `draft`, `approved`, `registration` UI 상태를 폐기한다. 변경된 입력과 이전 서버 초안을 함께 표시하거나 승인·등재할 수 없어야 한다.
2. 세션에 결속된 초안 거부 전이를 `draft-store`와 `authoring-store`에 추가하고, 기존 approve Route Handler 패턴과 같은 authoring reject Route Handler를 추가한다. pending 초안만 거부할 수 있고, 다른 세션·이미 승인/소비/거부된 초안은 정직한 오류로 거절한다.
3. UI의 `초안 거부`는 reject API 성공 뒤에만 화면의 초안을 제거한다. 거부된 draft ID는 후속 승인과 등재가 불가능해야 한다.
4. `AuthoringWizard`의 공개 화면 흐름을 렌더링하고 fetch를 스텁해 초안 생성→검토→승인→등재, 입력 변경 무효화, 서버 거부를 검증한다. 필요한 테스트 DOM 도구가 현재 의존성에 없다면 이 테스트에 필요한 최소 dev dependency만 추가한다.

## Acceptance Criteria

```bash
npm test -- src/components/authoring-wizard.test.tsx src/services/draft-store.test.ts src/services/authoring-store.test.ts src/__tests__/authoring-route.test.ts
npm run lint
npm run build
npm test
```

추가 테스트는 최소한 다음을 단언한다.

1. 실제 `AuthoringWizard` 화면에서 초안 응답의 roles·provenance·corroboration·discarded가 표시된다.
2. 입력 또는 source 목록 변경 뒤 이전 초안의 승인·등재 control이 사라진다.
3. reject fetch가 성공하기 전에는 초안을 제거하지 않으며, 성공 뒤 제거한다.
4. 서버에서 거부된 draft ID의 승인과 등재가 모두 거절된다.
5. 자기검증 실패와 `negative-not-caught`는 계속 red이며 승인 경로가 열리지 않는다.
6. `pattern-exists`는 기존 패턴 불변 문구와 함께 표시된다.

## 금지사항

- 후보 편집 UI를 추가하지 마라.
- `independenceGroup`·`isTargetStack` 기본값이나 추천값을 추가하지 마라.
- 클라이언트 boolean을 서버 승인 또는 거부 권한으로 취급하지 마라.
- 기존 `catalog-bindings-wizard.tsx`를 수정하거나 E2E DOM을 바꾸지 마라.
- manifest를 직접 편집하지 마라.
- 이 fix step 안에서 `$remediate`, review/triage/closure/rule을 실행하거나 `remediation/` 산출물을 만들지 마라. 구현과 AC 실행, fix phase index 갱신, 커밋만 수행한다.
