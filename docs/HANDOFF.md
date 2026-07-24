# HANDOFF — phase 1 종료 및 다음 작업 선택

> 이 문서는 새 세션이 현재 저장소 상태를 오해하지 않고 이어가기 위한 실행 계약이다. 이미 정본에 있는 요구사항·아키텍처·리뷰 상세를 반복하지 않고 경로로 참조한다.
>
> 기준 시각: 2026-07-24  
> 현재 브랜치: `feat-1-ui-vertical-slice`

## 1. 현재 판정

MVP 엔진과 사용자 주도 UI vertical slice가 구현됐고, 독립 review-remediation loop의 최종 판정은 **Ready**다.

- phase 0 엔진: `phases/0-mvp/`, `phases/0-fix/`, `phases/0-fix2/`
- phase 1 UI/API/E2E: `phases/1-ui-vertical-slice/`
- remediation fix phase: `phases/1-ui-vertical-slice-fix-c1/`
- 최종 판정: `remediation/1-ui-vertical-slice/cycle-1/ruling.json`

최종 ruling:

- verdict: `Ready`
- G1–G6: 전부 통과
- score: 100
- open findings: 0
- deferred to implementation: 0

따라서 phase 1의 review-remediation loop를 더 반복할 필요는 없다. 다음 제품 작업으로 넘어가도 된다.

## 2. 리뷰에서 실제로 일어난 일

리뷰가 finding 0건으로 끝난 것은 아니다. 독립 full review가 Major 3건을 발견했고, 모두 cycle 1에서 수정된 뒤 독립 closure review가 `resolved`로 판정했다.

| finding | 해결 결과 |
|---|---|
| F-001 detected binding을 직접 API 입력으로 덮어쓸 수 있음 | `binding-unresolved`의 trim된 non-empty 값만 사용자 입력으로 수용 |
| F-002 외부 제공 E2E fixture root까지 teardown이 삭제 | 실행이 소유한 임시 root만 삭제하도록 소유권 결속 |
| F-003 VERIFY 로그 경로가 workspace 정리 뒤 사라지고 UI에 출력이 없음 | 독립 로그 경로 보존 + 4000자 preview/truncated/전체 경로 UI 표시 |

상세 근거와 closure verdict는 다음 파일이 정본이다.

- `remediation/1-ui-vertical-slice/manifest.json`
- `remediation/1-ui-vertical-slice/reviews/review-1.json`
- `remediation/1-ui-vertical-slice/reviews/review-2.json`

## 3. 새 세션이 가장 먼저 해야 할 일

현재 remediation 결과는 **작업 트리에 있으나 아직 커밋되지 않았다.** 새 기능을 시작하기 전에 아래 순서로 phase 1을 닫아라.

1. `git status --short`로 현재 변경을 확인한다.
2. remediation fix와 메타데이터를 검증한다.

   ```bash
   npm run lint
   npm run build
   npm run test
   npm run test:e2e
   python3 -m pytest scripts/ -q
   ```

3. 다음 범위를 의도적으로 나눠 conventional commit으로 기록한다.
   - 제품·테스트 수정: F-001~F-003 fix
   - remediation 기록: `phases/1-ui-vertical-slice-fix-c1/`, `remediation/1-ui-vertical-slice/`
   - 이 handoff 문서
4. 작업 트리가 clean인지 확인한다.

기존 커밋:

- `41cdc81` — phase 1 완료
- `dd65cd6` — Stop hook JSON 출력 수정
- `1cfc6fd` — remediate 독립 review loop 자동화

## 4. 완료된 제품 표면

현재 앱은 다음 경로를 실제로 잇는다.

```text
catalog
→ target 적격성 확인
→ binding 탐지/미해결 입력
→ generated add diff + frozen argv/cwd/timeout 사전 표시
→ positive/negative VERIFY
→ 서버측 승인
→ apply
```

핵심 위치:

- UI: `src/components/catalog-bindings-wizard.tsx`
- Route Handlers: `src/app/api/`
- 서버 workflow/session: `src/services/workflow-store.ts`
- VERIFY/log: `src/lib/engine/verify.ts`, `src/services/gate-runner.ts`
- 브라우저 E2E: `e2e/vertical-slice.spec.ts`
- 확정 UI 계약: `docs/UI_GUIDE.md`

정본 요구사항과 불변식은 `AGENTS.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ADR.md`를 따른다.

## 5. 다음 제품 phase

MVP 수용 기준과 phase 1 remediation은 닫혔지만, **post-MVP의 다음 목표는 아직 정해지지 않았다.** 새 세션이 임의로 기능을 고르지 마라.

먼저 사용자와 다음 중 어느 문제를 풀지 확정한다.

- 실제 로컬 demo/release 준비
- 실제 대형 target repo 적격성·성능 보강
- portable provenance 표현
- PRD의 MVP 제외 항목 중 하나를 새 범위로 승격
- 문서·배포·온보딩 등 제품화 작업

선택 시 `docs/PRD.md`의 MVP 제외 범위와 `docs/ARCHITECTURE.md`의 의도적 유예 항목을 확인한다. 목표가 정해지면 스펙과 수용 기준을 먼저 갱신하고 TDD로 구현한다.

## 6. Suggested skills

- phase 1 closeout 검증·커밋: 직접 수행
- 다음 목표가 불명확할 때: `$decision-mapping` 또는 `$grill-me`
- 여러 step의 새 구현 phase가 확정됐을 때: 프로젝트 로컬 `$harness`
- 단발성 버그를 test-first로 수정할 때: `$tdd`
- 구현 phase 완료 후: 새 세션에서 `$remediate <branch-or-phase>`

전역 `harness:harness`는 에이전트·스킬 하네스 자체를 구축하는 용도이므로, uptake 제품 기능의 다음 phase에는 사용하지 않는다.

