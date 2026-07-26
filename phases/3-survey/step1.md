# Step 1: survey-collect

고정된 revision에서 **결정적으로** 방법론 신호 파일을 수집하는 엔진을 구현한다. "어디를 볼까"는 여기가 정하고, "그것이 무슨 방법론인가"는 나중 step의 LLM이 정한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 provenance 강제·불신 격리·수집 규칙 데이터화
- `/docs/PRD.md` — "Phase 3 범위 — 발견 (SURVEY)" 절
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **입력과 revision 고정** · **수집** 문단, "패턴 스키마" 절의 resolve 방법
- `/docs/ADR.md` — ADR-009(provenance 강제), ADR-018(수집 규칙)
- `/src/types/survey.ts` — step 0이 만든 `CompiledSurveyRules`·`SurveyBudget`
- `/src/lib/engine/survey-rules.ts` — step 0이 만든 로더
- `/survey-rules.json` — step 0이 만든 규칙 데이터. 8개 카테고리
- `/src/lib/provenance/resolve.ts` — `resolveRepositoryRoot`(재사용 대상), source root 이탈 검사
- `/src/lib/engine/extract.ts` — 같은 성격의 기존 엔진. `git rev-parse HEAD`로 revision을 고정하고 `revisionPattern`으로 검사하는 방식을 그대로 따른다
- `/src/lib/catalog/load.ts` — `revisionPattern`·`isRelativePosixPath`

## 작업

### `src/lib/engine/survey-collect.ts`

```ts
export type SignalFile = {
  path: string;      // repo-상대 POSIX 경로
  ruleId: string;    // 이 파일을 고른 규칙
  content: string;   // perFileChars 초과 시 절단된 내용
  truncated: boolean;
};

export type SkippedSignal = {
  path: string;
  ruleId: string;
  reason: "budget-exhausted" | "unreadable";
};

export type CollectResult =
  | {
      ok: true;
      revision: string;          // 40자 hex — 이 수집이 서 있는 커밋
      files: SignalFile[];
      skipped: SkippedSignal[];
    }
  | {
      ok: false;
      reason: "repository-unresolved" | "revision-unpinnable" | "no-signal";
      detail: string;
    };

export function collectSignalFiles(
  repository: string,
  rules: CompiledSurveyRules,
  sourceRoot?: string,
): CollectResult;
```

동작 계약:

**a. 저장소 해석.** `resolveRepositoryRoot(repository, sourceRoot)`로 로컬 경로를 얻는다. 얻지 못하면 `repository-unresolved`. **네트워크에 나가지 않는다** — 저장소가 없으면 clone하지 않고 실패다.

**b. revision 고정.** `git rev-parse HEAD`로 SHA를 얻고 `load.ts`의 `revisionPattern`(40자 hex)을 만족하는지 검사한다. 실패하면 `revision-unpinnable`. 이 revision이 반환값에 실리며, 이후 모든 읽기가 여기에 결속된다.

**c. 경로 목록.** `git ls-tree -r --name-only <revision>`으로 그 커밋의 파일 경로를 얻는다.

**d. 배정.** 각 경로에 대해:
1. `rules.exclude` 중 하나라도 매칭되면 버린다.
2. `rules.rules`를 **배열 순서대로** 훑어 **처음 매칭되는** 규칙에 배정한다. 한 경로는 한 규칙에만 속한다.
3. 어느 규칙에도 매칭되지 않으면 버린다.

**e. 정렬.** 배정 결과를 `(ruleId, path)` 사전식으로 정렬한다.

**f. 라운드로빈.** 규칙별 큐를 만들어 **한 라운드에 규칙마다 하나씩** 뽑는 순서로 재배열한다. 규칙 순회 순서는 e의 정렬로 결정된 안정적인 순서를 쓴다.

> 이 단계가 없으면 대형 저장소에서 문서 하나가 예산을 독식하고 훅·태스크러너·테스트설정이 통째로 굶는다. 실측에서 문서 129개가 예산을 다 먹어 `.pre-commit-config.yaml`과 `tox.ini`가 잘렸고, 하필 그 둘이 그 프로젝트 방법론의 핵심이었다.

**g. 읽기와 예산.** 재배열된 순서로 순회하며:
1. `git show <revision>:<path>`로 내용을 읽는다. 실패하면(예: submodule 엔트리) `skipped`에 `unreadable`로 기록하고 다음으로 간다.
2. 길이가 `budget.perFileChars`를 넘으면 그 길이로 **절단**하고 `truncated: true`로 표시한다.
3. 누적 길이 + 이 파일 길이가 `budget.totalChars`를 넘으면 **`skipped`에 `budget-exhausted`로 기록하고 `continue`한다.** 순회를 중단(`break`)하지 마라 — 큰 파일 하나가 뒤 카테고리를 통째로 굶긴다.
4. 통과한 파일만 `files`에 담는다.

**h. 결과.** `files`가 비면 `no-signal`. 그렇지 않으면 `ok: true`.

**결정성이 이 모듈의 계약이다.** 같은 revision·같은 규칙이면 `files`의 **내용과 순서가 항상 같아야 한다**. 파일시스템 순회 순서나 `Map`/`Set` 반복 순서에 결과가 의존하면 안 된다.

### 테스트 — `src/lib/engine/survey-collect.test.ts`

임시 디렉터리에 git 저장소 fixture를 만들어 실행한다. `src/lib/engine/extract.test.ts`가 이미 그 방식을 쓰고 있으니 참고하라. 각 테스트는 자신이 만든 임시 root만 정리한다.

- **정상 경로**: 규칙에 걸리는 파일들이 수집되고 `revision`이 40자 hex다.
- **작업 트리를 읽지 않는다 (음성 테스트, 필수)**: 파일을 커밋한 뒤 **작업 트리에서 그 파일 내용을 바꾼다**. 수집 결과가 **커밋 시점 내용**이어야 한다. 이 테스트가 없으면 `readFileSync`로 되돌아가도 아무도 모른다.
- **라운드로빈 (필수)**: 규칙 A에 파일 여러 개, 규칙 B에 파일 하나를 두고 `totalChars`를 작게 잡는다. **규칙 B의 파일이 살아남아야 한다.** 알파벳순으로 순회하면 죽는 배치로 fixture를 구성하라.
- **예산 초과는 skip이지 break가 아니다**: 큰 파일 하나 뒤에 작은 파일을 두고, 큰 파일이 잘려도 작은 파일이 수집되는지 확인한다.
- **절단**: `perFileChars`를 넘는 파일이 그 길이로 잘리고 `truncated: true`다.
- **exclude**: 제외 패턴에 걸리는 경로가 수집되지 않는다.
- **미매칭**: 어느 규칙에도 안 걸리는 파일이 수집되지 않는다.
- **첫 매칭 우선**: 두 규칙에 걸릴 수 있는 경로가 앞선 규칙에만 배정된다.
- **결정성**: 같은 입력으로 두 번 실행하면 `files`가 순서까지 동일하다.
- **실패 경로**: source root 밖 repository → `repository-unresolved`, 신호 파일이 하나도 없는 저장소 → `no-signal`.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/engine/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (분석 대상 저장소를 읽기 전용으로만 다뤘는가)
3. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **작업 트리를 읽지 마라(`readFileSync`로 대상 저장소 파일을 읽는 것 포함). 이유: 계약은 고정 revision이다. 작업 트리는 커밋되지 않은 변경을 담고 있어, 사용자가 근거로 본 내용이 저장소의 어느 상태인지 특정할 수 없게 된다. `git ls-tree`·`git show`·`git rev-parse`만 쓴다.**
- **대상 저장소를 checkout하거나 수정하지 마라. 이유: 분석 대상 저장소는 타깃 repo와 마찬가지로 불변이다.**
- **네트워크에 나가지 마라(clone·fetch 금지). 이유: 로컬-우선이며, 저장소가 없으면 `repository-unresolved`가 정답이다.**
- **대상 저장소의 코드를 실행하지 마라(스크립트·설정 import 금지). 이유: 신뢰 경계 — 수집 대상 파일은 전부 불신 입력이다.**
- **예산 초과 시 `break`하지 마라. 이유: 큰 파일 하나가 뒤 카테고리를 통째로 굶긴다. 실측으로 확인된 실패다.**
- **규칙을 이 파일에 하드코딩하지 마라. 규칙은 인자로 받은 `CompiledSurveyRules`에서만 온다. 이유: ADR-018.**
- **후보 제안(LLM 호출)을 여기서 하지 마라. 이유: 이 모듈은 결정적이어야 한다. proposer는 step 2~3의 범위다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
