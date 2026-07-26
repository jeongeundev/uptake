# Step 2: source-extract

EXTRACT를 구현한다. 사용자가 지정한 소스 저장소들을 **읽기 전용**으로 관찰해, LLM proposer가 제안한 파일 후보 중 **실제로 resolve되는 것만** 근거(provenance)로 확정한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 (특히 provenance 강제·불신 격리)
- `/docs/PRD.md` — "Phase 2 범위"의 요구사항 목록 (대조 근거 ≥2 독립 저장소 / 모든 근거에 파일 경로+revision provenance / 저장소 내용은 불신 데이터 / 환각 봉쇄 AC-C9)
- `/docs/ARCHITECTURE.md` — "EXTRACT·ABSTRACT 저작 계약"의 **EXTRACT — 근거 수집** 문단, "패턴 스키마" 절의 resolve 방법
- `/docs/ADR.md` — ADR-009(provenance 강제), ADR-015(결정성 경계)
- `/src/lib/provenance/resolve.ts` — 재사용 대상. `git show <revision>:<path>` 계약과 source root 이탈 검사
- `/src/lib/engine/detect.ts` — `hasVitest` 관찰 규칙 (재사용 대상)
- `/src/lib/catalog/load.ts` — `isRelativePosixPath`·`revisionPattern`·`isId`의 검증 규칙. 초안이 나중에 이 게이트를 통과해야 하므로 같은 기준을 써야 한다
- `/src/types/authoring.ts` — step 0이 만든 `SourceSpec`·`AuthoringRequest`·`Evidence`·`DiscardedCandidate`·`TargetStackFact`
- `/src/services/proposer.ts` — step 0이 만든 `Proposer` 포트·`FileCandidateRequest`·`ANCHOR_ROLE_IDS`
- `/src/services/proposer-stub.ts` — step 0이 만든 결정적 스텁 (테스트에서 주입)

## 작업

### 1. `resolve.ts`에 저장소 경로 해석을 노출

`extract`는 git 명령을 돌릴 저장소 실제 경로가 필요하다. `resolveProvenance` 안에 있는 "source root 아래 repository 경로 해석 + 이탈 검사" 로직을 별도 export 함수로 뽑고, `resolveProvenance`가 그것을 쓰도록 소폭 리팩터하라.

```ts
export function resolveRepositoryRoot(
  repository: string,
  sourceRoot?: string,
): string | undefined;   // 이탈·부재·비디렉터리면 undefined
```

기존 검사(경로 이탈, `statSync().isDirectory()`, `realpathSync` 이후 재검사)를 **그대로 유지**하라. `resolveProvenance`의 동작과 반환값은 바뀌면 안 된다 — 기존 테스트가 그대로 통과해야 한다.

### 2. `detect.ts`의 vitest 관찰 규칙을 재사용 가능하게

`hasVitest(packageJson)`를 export하라. 시그니처와 동작은 바꾸지 마라. 소스 저장소는 **작업 트리를 읽지 않고** 고정 revision에서 `package.json`을 읽으므로, 파일시스템을 읽는 `readPackageJson`은 재사용하지 않는다.

### 3. `src/lib/engine/extract.ts` — EXTRACT 엔진

```ts
export type ExtractResult =
  | {
      ok: true;
      sources: Source[];              // revision이 HEAD SHA로 고정된 catalog Source
      evidence: Evidence[];
      discarded: DiscardedCandidate[];
      targetStackFacts: TargetStackFact[];
    }
  | {
      ok: false;
      reason: "source-unresolved" | "no-evidence";
      detail: string;
    };

export async function extractEvidence(
  request: AuthoringRequest,
  proposer: Proposer,
  sourceRoot?: string,
): Promise<ExtractResult>;
```

동작 계약:

**a. revision 자동 고정.** 각 `SourceSpec`에 대해 `resolveRepositoryRoot`로 저장소 경로를 얻고, 그 저장소의 **HEAD 커밋 SHA**를 저작 개시 시점에 고정한다(`git rev-parse HEAD`). 얻은 값이 `load.ts`의 `revisionPattern`(40자 hex)을 만족하지 않으면 그 소스는 해석 실패다. 저장소 경로가 없거나 SHA를 못 얻으면 `{ ok: false, reason: "source-unresolved" }`로 즉시 중단한다 — 근거 없는 소스를 조용히 건너뛰지 마라.

**b. 파일 목록 수집.** 고정한 revision에서 파일 경로 목록을 읽는다(`git ls-tree -r --name-only <revision>`). 이것이 proposer에게 주는 **불신 데이터**다.

**c. proposer 호출.** 소스마다 `proposeFileCandidates`를 호출한다. `roleIds`는 `request.capability === "generative"`이면 `ANCHOR_ROLE_IDS`, 아니면 빈 배열이 아니라 **제약 없음을 뜻하는 값**을 전달하라(예: 빈 배열 = 제약 없음으로 규정하고 주석에 명시).

**d. 후보 검증 — 여기가 환각 봉쇄 지점이다(AC-C9).** 각 후보를 아래 순서로 검사하고, 하나라도 실패하면 `discarded`에 사유와 함께 기록한 뒤 버린다. 절대 초안에 담지 마라.

1. `sourceId`가 요청의 소스 중 하나인가 — 아니면 `path-invalid`로 버린다.
2. `path`가 `load.ts`의 `isRelativePosixPath` 기준을 만족하는가 — 아니면 `path-invalid`.
3. `roleId`가 `isId` 기준을 만족하고, generative 저작이면 `ANCHOR_ROLE_IDS`에 속하는가 — 아니면 `role-not-allowed`.
4. 같은 `(sourceId, path, roleId)`가 이미 채택됐는가 — 그러면 `duplicate`.
5. `resolveProvenance(source, { sourceId, path, observedRole: roleId }, sourceRoot)`가 성공하는가 — 실패면 `provenance-unresolved`.

통과한 후보만 `Evidence`가 되며, `content`에는 resolve로 읽은 내용을 담는다.

**e. targetStackFacts.** 소스마다 고정 revision에서 `package.json`을 resolve해 파싱하고 `hasVitest`로 관찰한다. 읽히지 않거나 파싱 실패면 `vitestObserved: false`, `evidencePaths: []`다. **이것은 사실 제시일 뿐 판정이 아니다** — `isTargetStack` 값을 이 결과로 덮어쓰지 마라.

**f. 결과.** 채택된 `Evidence`가 하나도 없으면 `{ ok: false, reason: "no-evidence" }`. `sources`는 `SourceSpec` + 고정 `revision`으로 만든 catalog `Source[]`다.

모든 반환 배열은 **결정적 순서**여야 한다(요청의 소스 순서 → 경로 정렬 → 역할 정렬). 같은 입력에 같은 출력이 나와야 테스트가 성립한다.

### 4. 테스트 — `src/lib/engine/extract.test.ts`

임시 디렉터리에 git 저장소 fixture를 만들어 실행한다. `e2e/fixtures.config.ts`에 파일을 쓰고 `git init`/`add`/`commit`으로 저장소를 만드는 방식이 이미 있으니 참고하라. 각 테스트는 자신이 만든 임시 root만 정리한다.

- **정상 경로**: 스텁이 실재하는 파일 후보를 내면 `Evidence`로 확정되고 `revision`이 40자 hex로 고정된다.
- **환각 봉쇄 1**: 스텁이 존재하지 않는 경로를 제안하면 `discarded`에 `provenance-unresolved`로 기록되고 `evidence`에 없다.
- **환각 봉쇄 2**: 스텁이 `../etc/passwd` 같은 경로나 절대경로를 제안하면 `path-invalid`로 버려진다.
- **환각 봉쇄 3**: generative 저작에서 스텁이 앵커 밖 role id를 제안하면 `role-not-allowed`로 버려진다.
- **소스 미해석**: source root 밖을 가리키는 repository면 `{ ok: false, reason: "source-unresolved" }`.
- **결정성**: 같은 입력으로 두 번 실행하면 같은 결과.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/engine/`, `src/lib/provenance/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (resolve 안 되는 근거는 폐기했는가)
3. 결과에 따라 `phases/2-authoring-pipeline/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **소스 저장소를 checkout하거나 작업 트리를 수정하지 마라. 이유: 씨앗 repo도 타깃과 마찬가지로 건드리지 않는 것이 계약이다(ARCHITECTURE 패턴 스키마 절). `git show`/`git ls-tree`/`git rev-parse`만 쓴다.**
- **네트워크에 나가지 마라(clone·fetch 금지). 이유: 로컬-우선이며, 저장소가 없으면 `provenance-unresolved`가 정답이다.**
- **저장소에서 읽은 내용을 프롬프트 지시 문자열에 이어붙이지 마라. 이유: 불신 격리 위반. 저장소 내용은 `FileCandidateRequest`의 데이터 필드로만 넘기고, 경계 블록 적용은 어댑터(step 7)의 책임이다.**
- **resolve 실패한 후보를 "일단 담고 나중에 거른다"로 처리하지 마라. 이유: ADR-009 — resolve되지 않는 근거는 초안에 담기지 않는다. 담은 뒤 거르는 구조는 한 번의 실수로 환각이 카탈로그에 샌다.**
- **`isTargetStack`이나 `independenceGroup`을 관찰 결과로 덮어쓰지 마라. 이유: 판정 주체는 사용자다(ADR-005/015). 앱은 `TargetStackFact`로 사실만 제시한다.**
- **`revision`을 브랜치명·태그·`HEAD` 문자열로 저장하지 마라. 이유: 움직이는 참조는 검증을 무의미하게 만든다. 반드시 고정 SHA다.**
- **소스 저장소의 코드를 실행하지 마라(스크립트·설정 import 금지). 이유: 신뢰 경계.**
- 기존 테스트를 깨뜨리지 마라.
