# Step 0: surface-discards-errors-and-preserve-group

## Findings

- **F-001 (major, contract_violation):** 모든 후보가 폐기되면 항목별 폐기 경로와 사유가 일반 `no-candidate` 오류로 소실된다.
- **F-002 (major, contract_violation):** SURVEY 구조화 출력 재시도 소진 오류가 Route/UI 경계에서 명시적으로 표면화되지 않고 UI가 busy에 남을 수 있다.
- **F-003 (minor, contract_violation):** SURVEY 채택의 `independenceGroup`이 저장소 식별자 원문 대신 정규화된 source ID를 쓴다.

## 근거와 스펙

- `src/lib/engine/survey.ts` · `src/services/survey-service.ts` · `src/components/survey-wizard.tsx`
- `src/app/api/survey/route.ts` · `src/services/proposer-anthropic.ts`
- `src/lib/engine/survey-adopt.ts`
- `docs/ARCHITECTURE.md` — SURVEY 환각 폐기 2단, proposer 경계, AuthoringRequest 자동 조립
- `docs/PRD.md` — Phase 3 근거 폐기 사유 표시
- `docs/ADR.md` — ADR-009, ADR-015

## 작업

TDD로 세 finding을 최소 수정한다.

1. 모든 후보가 폐기된 `no-candidate` 결과에도 고정 revision, 수집 skip, `discardedEvidence`, `discardedCandidates`를 보존한다. Route 응답과 UI가 항목별 경로·사유를 렌더링해야 한다.
2. Anthropic 구조화 출력 3회 소진을 식별 가능한 오류로 만들고 SURVEY Route Handler가 구조화 JSON 오류로 반환한다. UI 네트워크/JSON 오류도 명시적으로 표시하고 `busy`를 반드시 해제한다.
3. 채택 시 `sources[0].independenceGroup`에는 `input.repository` 원문을 저장하고 source ID는 provenance 참조 키로만 사용한다.

## 재현 테스트

- 엔진/서비스/UI: 환각 근거만 가진 후보가 전부 폐기돼도 `not-collected` 경로와 `no-evidence` 후보 사유가 화면까지 보인다.
- proposer/route/UI: 가짜 SDK가 3회 malformed 응답을 반환할 때 구조화 오류가 반환되고 화면에 표시되며 조사 버튼이 다시 활성화된다.
- 채택 엔진: `fixtures/a/b` 같은 저장소 식별자가 정규화되지 않고 `independenceGroup`에 그대로 보존된다.

## Acceptance Criteria

```bash
npm test -- src/lib/engine/survey.test.ts src/services/survey-service.test.ts src/components/survey-wizard.test.tsx src/services/proposer-anthropic.test.ts src/__tests__/survey-route.test.ts src/lib/engine/survey-adopt.test.ts
npm run lint
npm run build
npm test
npm run test:e2e
```

## 금지사항

- 실제 Anthropic API를 호출하지 마라.
- 스텁 proposer를 기본값으로 만들지 마라.
- 모든 후보 폐기 정보를 일반 문자열 하나로 축약하지 마라.
- 기존 E2E spec의 assertion을 약화하거나 skip하지 마라.
- 새로운 분류축이나 네트워크 의존성을 추가하지 마라.
- manifest를 직접 편집하지 마라.
- 이 fix step 안에서 review·triage·closure·rule 또는 `$remediate`를 실행하지 마라.
