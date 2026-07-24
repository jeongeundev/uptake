# Step 1: workflow-api

## 읽어야 할 파일

- `/AGENTS.md`
- `/docs/HANDOFF.md`
- `/docs/PRD.md` — AC-3/4/9/10/12
- `/docs/ARCHITECTURE.md` — step 0에서 확정한 Route Handler·세션 계약
- `/docs/UI_GUIDE.md`
- `/src/lib/catalog/load.ts`
- `/src/lib/engine/detect.ts`
- `/src/lib/engine/instantiate.ts`
- `/src/lib/engine/verify.ts`
- `/src/lib/engine/apply.ts`
- `/src/services/approval-store.ts`
- `/src/__tests__/pipeline.integration.test.ts`

## 작업

테스트를 먼저 작성하고, 기존 엔진을 재구현하지 않는 얇은 서버 workflow/API 계층을 만든다.

### 서버 workflow

`src/services/workflow-store.ts`와 필요한 최소 보조 모듈을 만든다.

- 불투명 `sessionId`와 `workflowId`를 `crypto.randomUUID()`로 발급하고 in-memory로 저장한다.
- workflow는 소유 session, pattern, target root, detections, 사용자 병합 bindings, generated, prepared verification, verify outcome, verificationId를 단계에 따라 서버측에만 보관한다.
- 클라이언트가 pattern 객체, generated 파일, prepared 객체, 승인 boolean을 신뢰 경계 안으로 되돌려 보내게 하지 마라. 클라이언트는 ID와 사용자가 직접 입력한 값만 보낸다.
- 이전 단계 입력이 바뀌면 downstream generated/prepared/outcome/approval을 폐기한다.
- 다른 session의 workflow/verificationId 접근은 존재하지 않는 것과 같이 거부한다.
- 검증 성공 직후 `createApproval`로 pending 레코드를 만들고 workflow 소유권에 결속한다. 승인 endpoint가 `approveVerification`, 적용 endpoint가 `applyGenerated`를 호출한다.
- 적용 전 `hashTargetBase`를 pending approval에 기록한다.
- 실제 source root 부재나 load rejection을 숨기지 않고 반환한다.
- target 적격성: 절대경로, Git worktree, 읽을 수 있는 `package.json`, `detectBindings`로 vitest checker가 탐지되어야 한다. monorepo 탐색이나 install은 하지 않는다.

### Route Handler

`src/app/api/` 아래에 단계별 route handlers를 만든다. 세부 URL은 단순하게 정하되 다음 기능이 분리되어야 한다.

- catalog 조회
- workflow 생성(선택한 pattern ID + target absolute path)
- unresolved binding 입력 병합
- instantiate + prepare(아직 gate 실행 금지)
- execute verification
- approve
- apply

첫 요청에서 HttpOnly, SameSite=Strict 세션 쿠키를 만들고 이후 요청에서 사용한다. 로컬 HTTP 개발을 깨지 않도록 `secure`는 production에서만 사용한다. JSON 오류는 안정된 `status`/`detail`을 제공하되 불필요한 범용 프레임워크를 만들지 마라.

prepare 응답은 최소한 `frozenArgv`, 임시 workspace에서 실행된다는 cwd 설명, `DEFAULT_GATE_TIMEOUT_MS`, 생성 파일별 `{operation:"add", path, role, content}`를 포함한다. execute 전에는 `executeVerification`을 호출하지 않는다.

### 테스트

- route/service 테스트를 먼저 작성한다.
- prepare 호출만으로 gate가 실행되지 않는지 검사한다.
- 타 session이 workflow를 조회·실행·승인·적용할 수 없는지 검사한다.
- 승인 없이 apply, 위조 ID, 재사용을 거부하고 쓰기가 없는지 검사한다.
- argv/생성물은 서버 저장값만 사용되는지 검사한다.
- source root 부재 시 rejected provenance를 반환하는지 검사한다.
- fixture는 임시 Git source/target을 런타임 생성하며 실제 `.uptake/sources`에 의존하지 않는다.

## Acceptance Criteria

```bash
npm run test
npm run lint
npm run build
```

## 검증 절차

1. 테스트를 먼저 실패시키고 구현 후 통과시킨다.
2. 클라이언트가 보낸 boolean이나 generated content로 승인·적용할 수 없는지 확인한다.
3. prepare와 execute 사이에 실제 실행 경계가 있는지 확인한다.
4. 성공 시 summary에 route 목록, workflow 상태 전이, 세션 결속, 테스트 파일을 기록한다.

## 금지사항

- `verify.ts`, `gate-runner.ts`, `instantiate.ts`, `load.ts`, `resolve.ts`, `apply.ts`, `approval-store.ts`의 계약을 바꾸지 마라. 이유: phase 0에서 검증된 엔진을 소비하는 단계다.
- 타깃 repo에서 script를 실행하거나 의존성을 설치하지 마라.
- source repo를 clone하거나 네트워크에 접근하지 마라.
- 승인 여부를 클라이언트 값으로 받지 마라.
- 기존 테스트를 깨뜨리지 마라.

