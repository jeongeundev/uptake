# Step 0: survey-rules

SURVEY의 수집 규칙을 **코드가 아니라 repo 동봉 데이터**로 만들고, 그것을 엄격하게 로드하는 로더를 구현한다. 이 step은 데이터 파일과 로더까지만 다룬다 — 실제 수집 알고리즘은 step 1이다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙. 특히 "SURVEY의 수집 규칙은 생태계별로 확장 가능한 데이터다. 코드에 박지 마라"
- `/docs/PRD.md` — "Phase 3 범위 — 발견 (SURVEY)" 절
- `/docs/ARCHITECTURE.md` — "SURVEY 계약 (phase 3)"의 **수집** 문단, "디렉토리 구조"의 `survey-rules.json`
- `/docs/ADR.md` — ADR-018(수집 규칙 = 확장 가능한 데이터)
- `/src/lib/catalog/load.ts` — 데이터 파일을 **엄격하게** 검증하는 기존 스타일. `isId`의 정의를 그대로 재사용한다
- `/src/services/proposer-anthropic.ts` — `AnthropicProposerConfigurationError`. 설정성 오류를 전용 Error 클래스로 표면화하는 기존 선례

## 작업

### 1. `survey-rules.json` — 수집 규칙 데이터 (저장소 최상위)

아래 형태의 JSON 파일을 저장소 루트에 만든다. **이것은 코드가 아니라 데이터다** — 새 생태계를 지원하는 일이 코드 수정이 아니라 이 파일 수정이어야 한다.

```json
{
  "schemaVersion": 1,
  "budget": { "perFileChars": 12000, "totalChars": 220000 },
  "exclude": ["(^|/)(fixtures?|__fixtures__|node_modules|vendor|third_party)/"],
  "rules": [
    { "id": "agent-instructions", "include": ["..."] }
  ]
}
```

규칙 목록은 아래 8개 카테고리를 그대로 싣는다. 이 목록은 성격이 다른 세 저장소(문서가 풍부한 곳 / 문서가 전무한 곳 / 낯선 대형 Python OSS)를 상대로 실측 조정된 결과다. **임의로 줄이거나 "정리"하지 마라.**

| `id` | 매칭 대상 |
|---|---|
| `agent-instructions` | 루트의 `AGENTS`·`CLAUDE`·`GEMINI`·`CONTRIBUTING`·`README`·`HACKING`·`DEVELOPING` + 확장자 `.md`·`.rst`·`.txt` (대소문자 무시) |
| `agent-config` | `.agents/`·`.claude/`·`.codex/`·`.cursor/`·`.windsurf/` 아래 `.md`·`.json`·`.toml` |
| `ci` | `.github/workflows/` 아래 `.yml`·`.yaml` |
| `hooks` | `.husky/` 아래 전부 · 루트 `.pre-commit-config.yml/.yaml` · 경로 중간의 `hook`/`hooks` 디렉터리 아래 `.sh`·`.py`·`.js`·`.ts` |
| `task-runner` | 루트의 `Makefile`·`justfile`·`Taskfile.yml/.yaml`·`package.json`·`pyproject.toml`·`Cargo.toml` |
| `design-docs` | `doc/`·`docs/` 아래 `.md`·`.rst` · 경로에 `adr`/`rfc`(복수 포함)가 들어간 것 |
| `test-config` | `vitest`·`jest`·`playwright`·`karma`·`pytest`·`conftest`·`tox` 계열 설정 파일 (`.ts`·`.mts`·`.js`·`.mjs`·`.py`·`.ini`·`.toml`·`.cfg`) |
| `automation` | `scripts/`·`bin/`·`tools/`·`tasks/` 바로 아래의 `.py`·`.sh`·`.js`·`.ts`·`.mjs`·`.mts`·`.rb`·`.go` |

`.md`만 인식하면 Python 프로젝트의 `CONTRIBUTING.rst`와 `doc/` 전체가 통째로 보이지 않고, `automation` 규칙이 없으면 **방법론이 문서가 아니라 실행 가능한 기계로 존재하는 저장소**를 놓친다. 둘 다 실측으로 확인된 결함이다.

`include`는 **repo-상대 POSIX 경로 전체**에 대해 검사하는 정규식 문자열이다. JSON 문자열이므로 백슬래시는 이스케이프해야 한다(`"^docs?/.+\\.(md|rst)$"`).

### 2. `src/types/survey.ts` — 타입

```ts
export type SurveyBudget = { perFileChars: number; totalChars: number };

export type SurveyRule = { id: string; include: string[] };

export type SurveyRuleSet = {
  schemaVersion: 1;
  budget: SurveyBudget;
  exclude: string[];
  rules: SurveyRule[];
};

export type CompiledSurveyRules = {
  budget: SurveyBudget;
  exclude: RegExp[];
  rules: { id: string; include: RegExp[] }[];
};
```

`rules`의 **배열 순서가 의미를 갖는다** — step 1의 수집기가 "첫 매칭 규칙"에 경로를 배정하므로, 컴파일 후에도 순서를 보존해야 한다.

### 3. `src/lib/engine/survey-rules.ts` — 로더

```ts
export class SurveyRulesError extends Error {}

export function loadSurveyRules(rulesPath?: string): CompiledSurveyRules;
```

기본 경로는 `process.env.UPTAKE_SURVEY_RULES ?? resolve("survey-rules.json")`이다. 테스트가 임시 파일을 주입할 수 있어야 한다.

**아래 중 하나라도 걸리면 `SurveyRulesError`를 throw한다.** 메시지에는 무엇이 왜 잘못됐는지(어느 규칙의 어느 패턴인지 포함) 담는다.

1. 파일이 없거나 읽을 수 없음
2. JSON 파싱 실패
3. `schemaVersion !== 1`
4. 최상위에 정의되지 않은 키가 있음 (`hasExactKeys` 스타일의 엄격 검사)
5. `budget.perFileChars`·`budget.totalChars`가 **양의 정수**가 아니거나, `perFileChars > totalChars`
6. `rules`가 빈 배열
7. 규칙 `id`가 `load.ts`의 `isId` 기준을 만족하지 않거나 **중복**
8. 규칙의 `include`가 빈 배열이거나 원소가 빈 문자열
9. `exclude` 또는 `include`의 정규식이 **컴파일되지 않음**

**규칙 파일을 못 읽었을 때 빈 규칙으로 진행하지 마라.** "규칙이 죽었다"와 "이 저장소에 신호가 없다"는 사용자에게 완전히 다른 사실인데, 조용히 넘어가면 구별이 불가능해진다. 스파이크에서 발견된 수집 결함 3건이 **전부 침묵했다** — 그래서 이 검사가 존재한다.

### 4. 테스트 — `src/lib/engine/survey-rules.test.ts`

임시 디렉터리에 규칙 파일을 써서 실행한다. 각 테스트는 자신이 만든 임시 경로만 정리한다.

- **정상 로드**: 유효한 규칙 파일이 컴파일되고, `rules` 순서가 파일에 적힌 순서와 같다.
- **번들 데이터 검증**: 저장소에 실제로 동봉된 `survey-rules.json`이 인자 없이 로드되고 8개 규칙을 갖는다. **이 테스트가 데이터 파일 자체의 유효성을 지킨다.**
- 위 1~9의 실패 조건 각각에 대해 `SurveyRulesError`가 throw되는지 (특히 **깨진 정규식**과 **중복 id**).
- 실패 메시지가 원인을 식별할 수 있는 정보를 담는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`survey-rules.json`은 최상위, 로더는 `src/lib/engine/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 런타임 의존성 0 — glob 라이브러리 등을 추가하지 마라)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (수집 규칙이 코드에 박혀 있지 않은가)
3. `docs/ARCHITECTURE.md`의 '구현 중 결정 (의도적 유예)' 표에서 **`SURVEY 수집 규칙의 초기 목록` 행을 제거**한다. 이 step이 확정했기 때문이다. 다른 행은 건드리지 마라.
4. 결과에 따라 `phases/3-survey/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **규칙 목록을 TypeScript 상수 배열로 두지 마라. 이유: ADR-018의 결정 자체다. 규칙이 코드에 있으면 새 생태계 지원이 코드 변경이 되고, 규칙 목록이 특정 생태계에 종속되면 그 밖의 저장소는 "문서가 없는 것"처럼 보인다.**
- **로드 실패를 기본값·빈 규칙으로 대체하지 마라. 이유: 조용한 보정은 성공 위장의 사촌이다. 규칙이 죽은 것과 신호가 없는 것이 구별되지 않으면 SURVEY 결과를 신뢰할 수 없다.**
- **이 step에서 파일을 수집하거나 읽지 마라(`git ls-tree`·`git show` 호출 금지). 이유: 수집기는 step 1의 범위다. 여기서 미리 만들면 두 step이 같은 모듈을 건드린다.**
- **정규식 대신 glob 라이브러리를 도입하지 마라. 이유: 런타임 의존성 0을 유지한다. 규칙 파일은 repo 소유의 신뢰 입력이므로 정규식 문자열로 충분하다.**
- **이 step 안에서 리뷰·remediation loop를 돌리지 마라. `$remediate` 호출, `scripts/execute.py` 재귀 실행, 새 phase 디렉터리 생성, `remediation/` 산출물 작성을 모두 포함한다. 이유: 코드를 쓴 세션이 스스로 리뷰하면 자기채점이다(ADR-008). 적대적 리뷰는 phase 완료 후 독립 세션의 `$remediate`가 맡는다.**
- 기존 테스트를 깨뜨리지 마라
