# Step 0: preflight-evidence-gate

## Finding

- **F-001 (major, contract_violation):** ABSTRACT가 `validateEvidence`를 통과하지 못하는 초안을 `ok: true`로 반환한다.

## 근거와 스펙

- `src/lib/engine/abstract.ts` — Step 3 ABSTRACT 초안 조립과 사전 검사
- `src/lib/engine/abstract.test.ts` — ABSTRACT 회귀 테스트
- `src/lib/catalog/load.ts` — `validateEvidence`의 결정적 하드 게이트
- `phases/2-authoring-pipeline/step3.md` — 초안은 loader의 참조·근거 검사를 통과해야 한다
- `docs/PRD.md` — AC-1, AC-2
- `docs/ARCHITECTURE.md` — 두 층의 게이트

## 작업

테스트를 먼저 추가해 아래 두 성공-후-로드거부 경로를 재현하고 최소 수정한다.

- `observed` 요청에서 채택된 provenance가 연결된 source의 distinct `independenceGroup`이 1이 아니면 성공 초안을 반환하지 않는다.
- `corroborated` 요청에서 채택된 provenance가 연결된 source 중 `isTargetStack: false`가 하나도 없으면 성공 초안을 반환하지 않는다.
- 계산 대상은 provenance가 연결된 source뿐이며 사용자가 준 `independenceGroup`·`isTargetStack` 값을 그대로 검사한다.
- Step 3이 동결한 `ContrastResult` reason union은 넓히지 않는다. 사전 하드 게이트에 맞지 않는 초안은 `reference-invalid`로 반환하고 `detail`에 구체적인 evidence 불일치 사유를 기록한다.

## Acceptance Criteria

```bash
npm run test -- src/lib/engine/abstract.test.ts
npm run lint
npm run build
npm test
```

추가 테스트는 최소한 다음을 단언한다.

1. `observed` + 서로 다른 그룹 2개가 `ok: false`, `reference-invalid`다.
2. `corroborated` + 전부 타깃 스택인 두 그룹이 `ok: false`, `reference-invalid`다.
3. 기존 정상 corroborated와 observed N=1 테스트는 통과한다.

## 금지사항

- `independenceGroup` 또는 `isTargetStack`을 추론·정규화·보정하지 마라.
- `evidenceStatus`를 조용히 승급·강등하지 마라.
- `ContrastResult` 공개 reason union을 변경하지 마라.
- loader·oracle·catalog 쓰기 로직을 수정하지 마라.
- 관련 없는 ABSTRACT 코드를 리팩터링하지 마라.
