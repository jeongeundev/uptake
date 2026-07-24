# Step 0: ui-contract

## 읽어야 할 파일

먼저 아래 문서를 읽고 phase 1의 확정된 제품 계약을 문서화하라:

- `/AGENTS.md`
- `/docs/HANDOFF.md` — 특히 §3, §4, §8
- `/docs/PRD.md` — AC-3, AC-4, AC-9, AC-10, AC-11, AC-12
- `/docs/ARCHITECTURE.md` — 제품 표면, VERIFY 실행 계약, 상태 관리, 신뢰 경계, 구현 중 결정
- `/docs/ADR.md` — ADR-006, ADR-008, ADR-010
- `/docs/UI_GUIDE.md` — 잠정 상태인 현재 내용
- `/src/lib/engine/verify.ts`
- `/src/services/approval-store.ts`
- `/src/lib/engine/apply.ts`

## 작업

코드를 작성하기 전에 사용자가 승인한 phase 1 UI/API 계약을 정본 문서에 물질화한다.

### `docs/UI_GUIDE.md`

기존 디자인 원칙과 안티패턴은 보존하되 “잠정·미확정” 표시를 phase 1 확정 계약으로 바꾼다. 다음을 명시한다.

- 단일 페이지 wizard: 카탈로그 → 타깃 → 결합점 → 실행 명령 확인 → 검증/diff → 승인·적용.
- 사용자가 이전 입력을 바꾸면 그 이후의 서버측 검증·승인 상태는 폐기하고 다시 준비한다.
- 새로고침·서버 재시작 뒤 진행 상태는 복구하지 않는다. 재검증·재승인이 필요하다.
- `frozenArgv`는 인자 경계를 보존한 목록으로 표시하고, cwd는 “타깃 밖의 임시 워크스페이스”, timeout도 실행 버튼 바로 앞에 표시한다. “이식 실행” 클릭이 공개된 명령 실행의 승인이다.
- 생성물은 현재 엔진 계약에 맞춰 파일별 `add` operation, 경로, 전체 추가 내용을 표시한다. 수정·삭제를 암시하지 않는다.
- VERIFY 상태 문구와 색을 표로 확정한다. `awaiting-approval`만 성공이며 `positive-failed`, `injection-failed`, `gate-error`, `negative-not-caught`, `timeout`은 모두 차단이다. 양성 green과 음성 red가 모두 성립한 결과만 green이다.
- 패턴에는 `capability`, `evidenceStatus`, `generationEnabled`, `tradeoffs`, provenance 경로를 함께 표시한다. provenance 경로는 웹 링크인 척하지 말고 로컬 근거 경로 텍스트로 표시한다.
- `binding-unresolved`만 사용자 입력을 받으며 빈 값으로 다음 단계 진행을 허용하지 않는다.
- 실제 source root가 없어 패턴이 load 거부되면 빈 성공 화면을 만들지 말고 rejected reason(`provenance-unresolved`)을 표시한다.

### `docs/ARCHITECTURE.md`

「구현 중 결정」에서 phase 1이 확정한 항목을 실제 결정으로 옮긴다.

- 노출 계층은 Route Handler.
- HttpOnly 쿠키의 불투명 session ID와 서버측 in-memory workflow 저장소로 HTTP 요청 간 소유권을 결속한다.
- 기존 `approval-store` 엔진 계약은 바꾸지 않고 workflow/API 계층이 `verificationId`의 소유 세션을 확인한다.
- 사용자가 절대 타깃 경로를 입력한다. MVP 적격성은 Git worktree, `package.json`, vitest 탐지로 한정한다. monorepo 자동 탐색·의존성 설치는 하지 않는다.
- 생성 표현은 신규 파일별 `add` diff. 기존 apply 계약대로 수정·삭제는 지원하지 않는다.
- workflow 상태는 프로세스 수명이며 새로고침 복구는 phase 1 비목표다.

문서 사이에 상충하는 과거 문구가 남지 않게 하되, 관련 없는 유예 항목은 확정하지 마라.

## Acceptance Criteria

```bash
rg -n "단일 페이지|frozenArgv|negative-not-caught|provenance-unresolved|HttpOnly|Route Handler|신규 파일|vitest" docs/UI_GUIDE.md docs/ARCHITECTURE.md
npm run lint
npm run build
npm run test
```

## 검증 절차

1. AC-3/4/9/10/11/12 각각이 UI 또는 API 계약에 추적되는지 확인한다.
2. `HANDOFF.md` §8의 결정 항목 중 이번 phase에서 다룰 것만 확정됐는지 확인한다.
3. 성공 시 step status를 `completed`로 바꾸고 summary에 확정한 UI 흐름·API·세션·diff·타깃 적격성 계약을 요약한다.

## 금지사항

- 코드나 패키지를 수정하지 마라. 이유: 이 step은 스펙을 먼저 고정하는 단계다.
- 실제로 없는 씨앗이나 provenance를 UI에서 사용할 수 있다고 문서화하지 마라. 이유: load hard gate를 우회하면 ADR-009 위반이다.
- 기존 엔진 계약을 재설계하지 마라.

