# Step 3: abstract-contrast

ABSTRACT를 구현한다. 소스 간 대조로 **공통점 = `roles`(본질) 후보 / 차이점 = `bindingPoints`(파라미터) 후보**를 분리하고, 확정된 근거로 패턴 초안을 조립한다.

## 판정 주체 — 이 step의 가장 중요한 계약

`independenceGroup`과 "공통점이 본질인가"의 **최종 해석·승인은 사용자**가 한다(ADR-005 · ADR-015 · ARCHITECTURE "판정 주체" 문단).

앱이 하는 일은 정확히 이것뿐이다:

- 사용자가 `SourceSpec`에 **입력한** `independenceGroup` 값을 그대로 받아, 역할별로 **몇 개의 서로 다른 그룹이 지지하는지 센다.**
- 그 계산 결과(`CorroborationReport`)와 role/binding 후보를 **제시**한다.
- `corroborated` 저작에서 단일 그룹만 지지하는 role 후보를 binding으로 **내리고, 내린 사실과 사유를 기록**한다.

앱이 하지 않는 일:

- `independenceGroup` 값을 추론·보정·병합하지 않는다. 저장소 URL·조직명·GitHub 메타데이터·LLM 판단 중 **어느 것으로도** 유도하지 않는다.
- "이 공통점은 본질이 맞다"고 판정하지 않는다. 계산과 제시까지가 앱의 몫이고, 승인은 사용자 몫이다(승인 흐름은 step 5·6).

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙
- `/docs/PRD.md` — "Phase 2 범위"의 요구사항 (공통점=role 후보 / 차이점=binding 후보, 판정은 사용자 몫, LLM은 후보만)
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약"의 **ABSTRACT — 대조**·**판정 주체** 문단, "두 층의 게이트" 절
- `/docs/ADR.md` — ADR-005(공통=본질/차이=결합점, 독립성 판정), ADR-014(앵커 형태 한정), ADR-015(결정성 경계)
- `/src/lib/catalog/load.ts` — `validateReferences`·`validateEvidence`가 실제로 검사하는 것. 초안은 이 검사들을 통과해야 한다
- `/src/lib/engine/extract.ts` — step 2의 `ExtractResult`
- `/src/types/authoring.ts` — step 0의 `CorroborationReport`·`Evidence`
- `/src/services/proposer.ts` — step 0의 `ContrastRequest`·`ContrastProposal`·`ANCHOR_ROLE_IDS`
- `/src/services/proposer-stub.ts` — 테스트에서 주입

## 작업

### `src/lib/engine/abstract.ts`

```ts
export type ContrastResult =
  | {
      ok: true;
      draft: Pattern;                      // oracle 없음 — step 4가 붙인다
      corroboration: CorroborationReport;
    }
  | {
      ok: false;
      reason:
        | "anchor-role-missing"
        | "role-evidence-insufficient"
        | "reference-invalid"
        | "no-roles";
      detail: string;
      corroboration: CorroborationReport;  // 실패해도 사용자에게 근거를 보여준다
    };

export async function contrastEvidence(
  request: AuthoringRequest,
  extracted: Extract<ExtractResult, { ok: true }>,
  proposer: Proposer,
): Promise<ContrastResult>;
```

동작 계약:

**a. proposer 대조 호출.** `proposeContrast`에 의도와 근거 발췌를 넘긴다. `excerpt`는 파일 전문이 아니라 **상한을 둔 발췌**여야 한다(상한값은 상수로 두고 주석에 이유를 적어라). `roleIds`는 generative면 `ANCHOR_ROLE_IDS`.

**b. role 후보 채택.**
- `generative` 저작: `ANCHOR_ROLE_IDS`만 role이 될 수 있다. proposer가 낸 role 후보 중 앵커 id인 것만 채택하고 `description`을 취한다. 앵커 id인데 proposer가 description을 안 냈으면 기본 서술을 쓰되, **앵커 3역할 중 근거(`Evidence`)가 하나도 없는 것이 있으면 `anchor-role-missing`으로 실패**한다.
- `descriptive` 저작: role id는 자유다. 단 **근거에 등장하는 `roleId`만** role이 될 수 있다 — 근거 없는 role은 고아 role이 되어 층 1에서 거부된다.

**c. corroboration 계산.** 소스 id → 사용자가 입력한 `independenceGroup`의 맵을 만들고, role별로 그 역할을 지지하는 근거들의 distinct 그룹 수를 센다. 결과를 `CorroborationReport`에 담는다(`independenceGroups`·`nonTargetStackSourceIds`·`perRole`).

**d. 강등.** `request.evidenceStatus === "corroborated"`일 때만 적용한다. distinct 그룹이 2 미만인 role은 role이 아니라 **binding으로 내린다**(ADR-005: 한 repo에서만 보인 것은 그 repo의 특성이다). 내린 role은 `corroboration.demoted`에 사유 `single-independence-group`으로 기록하고, 그 role을 참조하던 근거는 provenance에서 제외한다.
- 강등 결과 `generative` 저작의 앵커 3역할 중 하나라도 사라지면 `role-evidence-insufficient`로 실패한다. 조용히 `descriptive`로 강등하지 마라 — 사유를 반환하고 사용자가 정하게 한다.
- `observed` 저작에는 강등을 적용하지 마라(N=1이 정의상 정상이다).

**e. bindingPoints 조립.** proposer의 binding 후보 + 강등된 role에서 온 binding. 각 항목은 `load.ts` 기준을 만족해야 한다 — `id`는 `isId`, `kind`는 4종(`spec-format`·`checker`·`gate-location`·`naming`) 중 하나, id 중복 없음. 기준 미달 후보는 버린다.

**f. 초안 조립.** `Pattern` 형태로 만든다. `oracle`은 **넣지 않는다**(step 4의 몫). `tradeoffs`는 `proposeNarrative`로 받은 서술을 쓴다. `sources`·`provenance`는 채택된 근거로 구성한다.

**g. 사전 참조 무결성 검사.** 조립 직후 `load.ts`의 양방향 참조 규칙을 스스로 검사하라 — 고아 source(어느 provenance도 참조하지 않는 source), 고아 role(어느 provenance의 `observedRole`도 아닌 role). 위반이면 `reference-invalid`로 실패한다. 여기서 걸러야 step 5의 등재 게이트에서 늦게 터지지 않는다.

모든 배열은 결정적 순서로 정렬하라.

### 테스트 — `src/lib/engine/abstract.test.ts`

스텁 proposer로 `ExtractResult`를 합성해 넣고 검사한다(실제 git 저장소가 필요 없도록 `extracted` 값을 직접 구성해도 된다).

- **정상 corroborated**: 앵커 3역할이 각각 서로 다른 두 `independenceGroup`의 근거로 지지되면 role로 남고, 초안이 조립된다.
- **강등**: 한 role이 단일 그룹만 지지하면 `demoted`에 기록되고 bindingPoints로 내려간다.
- **generative 실패**: 강등으로 앵커 역할이 빠지면 `role-evidence-insufficient`를 반환하고, 조용히 descriptive로 바꾸지 않는다.
- **앵커 밖 role 무시**: proposer가 앵커 밖 role을 제안해도 generative 초안의 `roles`에 들어가지 않는다.
- **판정 위임**: 같은 저장소·같은 근거라도 사용자가 준 `independenceGroup` 값이 다르면 corroboration 결과가 달라진다. (앱이 그룹을 추론하지 않는다는 증거)
- **observed 저작**: 강등이 적용되지 않는다.
- **고아 role/source**: 인위적으로 만들면 `reference-invalid`.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`independenceGroup`을 앱이 추론·정규화·병합하지 마라. 이유: 판정 주체는 사용자다(ADR-005/015). 저장소 경로·조직명·LLM 응답 중 무엇으로도 유도해서는 안 된다. 앱은 사용자가 입력한 값을 세기만 한다.**
- **`evidenceStatus`를 앱이 조용히 강등·승급하지 마라. 이유: 선언과 근거의 불일치는 명시적 데이터 오류이고, 조용한 보정은 성공 위장의 사촌이다(ARCHITECTURE 층 1 게이트).**
- **`generative` 초안의 role id를 앵커 vocabulary 밖으로 열지 마라. 이유: `instantiate`의 역할 형태 매칭(step 1)이 성립하지 않아 이식·자기검증이 불가능해진다(ADR-014).**
- **여기서 `oracle`을 만들지 마라. 이유: oracle 초안과 자기검증은 step 4이고, 저작 단계 분리 자체가 자기채점 방지 구조의 일부다(ADR-008/016).**
- **카탈로그 파일을 쓰지 마라. 이유: 승인 전 미기록이 계약이다. 쓰기는 step 5다.**
- **근거 없는 role을 "설명이 그럴듯하니 남긴다"로 처리하지 마라. 이유: 근거 없이 선언된 역할은 층 1에서 거부된다(고아 role).**
- 기존 테스트를 깨뜨리지 마라.
