# Step 3: verify-apply-ui

## 읽어야 할 파일

- `/AGENTS.md`
- `/docs/UI_GUIDE.md`
- `/docs/PRD.md` — AC-9, AC-10, AC-12
- `/docs/ARCHITECTURE.md` — VERIFY 실행 계약과 신뢰 경계
- step 1의 API/workflow 코드
- step 2의 page/components
- `/src/lib/engine/verify.ts`
- `/src/lib/engine/apply.ts`

## 작업

테스트를 먼저 작성하고 wizard의 prepare → execute → diff → approve → apply 부분을 완성한다.

- binding 확정 뒤 prepare endpoint를 호출한다. 응답의 argv 각 인자, cwd 설명, timeout을 “이식 실행” 버튼 바로 앞에 표시한다.
- prepare 완료만으로 실행 중/성공 상태를 표시하지 않는다. 사용자가 “이식 실행”을 클릭한 뒤에만 execute endpoint를 호출한다.
- 실행 중에는 중복 실행을 막고, 실패해도 detail을 숨기지 않는다.
- VERIFY 결과는 raw process exit code가 아니라 엔진 taxonomy로 렌더한다.
  - `awaiting-approval`: 양성 준수 + 음성 위반 탐지가 모두 기대와 일치한 검증 성공.
  - `positive-failed`, `injection-failed`, `gate-error`, `negative-not-caught`, `timeout`: 모두 차단 색과 정확한 설명.
  - 특히 `negative-not-caught`를 green으로 표시하지 않는다.
- 검증 성공 시에만 파일별 `add` operation, path, role, 전체 content를 diff 검토 영역에 표시한다.
- “승인 및 적용”은 명시적 한 번의 사용자 이벤트로 approve endpoint 성공 후 apply endpoint를 호출한다. 클라이언트 승인 boolean이나 파일 content를 전송하지 않는다.
- 적용 완료 파일 목록 또는 `diff-mismatch`, `base-changed`, `not-approved` 등 거부 상태를 표시한다.
- 이전 단계로 돌아가 입력을 바꾸면 이후 UI 상태도 폐기한다.

테스트는 frozen argv가 execute 전에 보이고 execute가 버튼 전에 호출되지 않는지(AC-12), 실패 taxonomy의 의미색, 검증 성공 전 승인 버튼 부재, 승인 없는 쓰기 경로 부재(AC-10), 검증된 diff만 표시·적용되는지(AC-9)를 검사한다.

## Acceptance Criteria

```bash
npm run test
npm run lint
npm run build
```

## 검증 절차

1. AC-9/10/12 UI 실패 테스트를 먼저 추가한다.
2. 브라우저 요청 payload에 generated files, 승인 boolean, arbitrary argv가 없는지 확인한다.
3. 음성 green에 해당하는 `negative-not-caught` fixture가 차단으로 표시되는지 확인한다.
4. 성공 시 summary에 UI 상태 전이와 AC별 테스트 증거를 기록한다.

## 금지사항

- raw exit code만으로 성공/실패를 판단하지 마라.
- 검증 전에 diff 승인이나 apply를 노출하지 마라.
- 클라이언트에서 엔진 함수를 import하거나 파일을 쓰지 마라.
- 실패 detail을 “다시 시도하세요” 같은 일반 문구로 덮지 마라.
- 기존 테스트를 깨뜨리지 마라.

