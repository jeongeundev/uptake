# Step 7: relay-integration

phase 4가 증명해야 할 것은 단 하나다 — **`uptake init` → `uptake survey` → 프로세스 종료 → `uptake author`가 디스크에서 이어받는다. uptake 저장소 밖에서.** 앞 step들의 유닛 테스트는 각 조각이 옳음을 보였지만, 릴레이가 실제로 프로세스 경계를 넘는지는 별개 프로세스를 띄워야만 알 수 있다.

이 step은 그 관통 테스트를 쓰고, 공유 엔진 변경이 웹을 깨뜨리지 않았는지 확인한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — '검증은 두 층이다' 절(step 게이트 vs phase 게이트)
- `/docs/PRD.md` — 'Phase 4 범위'의 **"전체 흐름 연결"** · **"웹 회귀가 통과한다"** · "경로가 분리된다" 요구사항
- `/docs/ARCHITECTURE.md` — 'CLI 호출 규약' 단락 · '자산 경로 계약' 절
- `/docs/ADR.md` — ADR-024(자산 경로) · ADR-015(스텁 proposer로 결정적 기계만 검증)
- `bin/uptake.ts` · `src/workflow/steps/{init,survey,author}.ts` · `src/workflow/{paths,artifacts,prerequisites}.ts`
- `src/__tests__/pipeline.integration.test.ts` — 이 저장소가 fixture 저장소를 만들고 git 커밋하는 기존 방식. **그 헬퍼 패턴을 따르라**
- `src/services/proposer-stub.ts` — `StubSurveyScript`의 형태
- `src/services/survey-proposer.ts` — 스텁 활성화에 필요한 환경변수(`UPTAKE_PROPOSER=stub` · `UPTAKE_SURVEY_PROPOSER_STUB_SCRIPT`)
- `src/lib/catalog/load.ts` — `validatePatternValue`
- `e2e/survey.spec.ts` — 웹 SURVEY 회귀가 무엇을 덮는지

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 이전 step에서 확정된 것

- step 0~2: 엔진 계약 3건 (고정 revision 존중 · `no-signal`의 revision · 수집 규칙 모듈 import).
- step 3: `src/workflow/{paths,artifacts,prerequisites}.ts`.
- step 4: `bin/uptake.ts` · `src/workflow/steps/init.ts` · `templates/METHOD.md`.
- step 5: `src/workflow/steps/survey.ts` · proposer 선택 함수가 `src/services/survey-proposer.ts`로 이동.
- step 6: `src/workflow/steps/author.ts`.

## 작업

### 1. `src/__tests__/workflow-relay.integration.test.ts`

**각 명령을 별개 프로세스로 띄운다.** 함수를 직접 부르면 릴레이가 아니라 인메모리 호출을 검사하는 것이 된다.

프로세스 실행:

```ts
execFileSync(resolve(repoRoot, "node_modules/.bin/tsx"), [resolve(repoRoot, "bin/uptake.ts"), ...args], {
  cwd: projectRoot,   // ← uptake 저장소 루트가 아니다
  env: { ...process.env, UPTAKE_PROPOSER: "stub", UPTAKE_SURVEY_PROPOSER_STUB_SCRIPT: scriptPath, UPTAKE_SOURCE_ROOT: sourceRoot },
  encoding: "utf8",
  timeout: 60_000,
});
```

호출 규약은 `npx tsx bin/uptake.ts <command>`이지만 테스트에서는 `node_modules/.bin/tsx`를 직접 부른다 — `npx`가 하는 일이 그것이고, 레지스트리 조회 없이 빨라진다.

**종료 코드를 검사하려면 `execFileSync`가 던지는 에러에서 `status`를 읽어야 한다.** 0이 아닌 종료를 예외로 만들지 않는 헬퍼를 하나 두어라(`{ exitCode, stdout, stderr }`를 반환하는 형태).

준비물:

- **프로젝트 루트**: `mkdtempSync`로 만든 임시 디렉터리. 여기가 `cwd`이며 `.uptake/`가 여기 생긴다. **uptake 저장소 루트가 아니어야 한다** — 그것이 자산 경로 계약을 검사하는 지점이다.
- **소스 루트**: 별도 임시 디렉터리. 그 아래에 fixture 저장소를 만들고 git 커밋한다. 저장소 내용은 **수집 규칙에 걸리는 파일**이어야 한다(`survey-rules.json`을 읽어 어떤 경로가 걸리는지 확인하라 — 예: `AGENTS.md`·`CONTRIBUTING.md`·`.github/workflows/*.yml` 계열).
- **스텁 스크립트**: `StubSurveyScript` 형태의 JSON 파일. 후보의 `evidence`는 fixture 저장소에 **실제로 존재하는 경로**여야 한다. 환각 후보(존재하지 않는 경로)를 하나 섞어 폐기가 기록되는지 함께 보면 좋다.

검사할 것:

| # | 확인 |
|---|---|
| 1 | `init` → `.uptake/METHOD.md`가 생기고 exit 0 |
| 2 | `init`을 **다시** 실행해도 exit 0이고 파일 내용이 바뀌지 않는다 (멱등) |
| 3 | `survey <repo>` → exit 0, `.uptake/runs/001-<slug>/survey.json`의 status가 `surveyed`, `runs/current`가 그 디렉터리명 |
| 4 | `survey.json`의 `revision`이 fixture 저장소의 HEAD SHA와 같다 |
| 5 | **`author --candidate <id>`가 별개 프로세스에서** exit 0, `authoring.json`의 status가 `drafted`이고 `pattern`이 실린다 |
| 6 | 그 `pattern`을 `validatePatternValue(pattern, "authoring.json", sourceRoot)`에 넣으면 **ok**다 (소비 가능한 형태로 직렬화됐다 · ADR-025) |
| 7 | **`survey`와 `author` 사이에 fixture 저장소에 새 커밋을 넣어도** `author`가 성공하고, 조립된 패턴의 `sources[0].revision`이 `survey.json`의 고정 revision이다 (ADR-021) |
| 8 | 순서 위반: 새 프로젝트 루트에서 `author`를 먼저 치면 exit 2이고 출력이 `survey`를 가리킨다 |
| 9 | 배포되지 않은 명령: `uptake verify`·`uptake apply`·`uptake nonexistent` 모두 exit 2이고 출력에 사용 가능한 명령 목록이 있다 |
| 10 | **카탈로그가 변하지 않는다** — uptake 저장소의 `catalog/`에 파일이 생기지 않고, 프로젝트 루트에도 `catalog/`가 생기지 않는다 |
| 11 | `.uptake/METHOD.md`에 다섯 단계가 모두 적혀 있고 현재 배포된 명령이 밝혀져 있다 |

**임시 디렉터리는 반드시 정리하라** (`afterEach`/`afterAll`에서 `rmSync(..., { recursive: true, force: true })`). `src/__tests__/pipeline.integration.test.ts`가 쓰는 방식을 따르라.

### 2. 웹 회귀 확인

phase 4는 웹 **코드**를 (proposer 파일 이동을 빼면) 건드리지 않았지만 **공유 엔진 변경이 웹 동작을 바꾼다** — `revision-moved` 제거(웹 채택 라우트가 같은 `adoptSurveyCandidate`를 쓴다) · `no-signal` 필드 추가(`SurveyError`가 웹 API 응답 타입이다) · 수집 규칙 로딩 방식 변경.

`npm run test:e2e`를 돌려 브라우저 회귀가 통과하는지 확인한다. step 게이트(`lint`·`build`·`test`)는 E2E를 돌리지 않으므로, **이 step에서 명시적으로 돌리지 않으면 phase 게이트까지 아무도 실행하지 않는다.**

깨진 것이 있으면 **원인을 고쳐라.** `e2e/`의 단언을 고쳐서 통과시키지 마라 — 그 파일들은 회귀 방지 증거다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test
npx vitest run src/__tests__/workflow-relay.integration.test.ts
npm run test:e2e
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-workflow-relay/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **통합 테스트를 uptake 저장소 루트를 `cwd`로 두고 돌리지 마라. 이유: 동봉 자산을 `process.cwd()`로 푸는 코드가 남아 있어도 통과해버린다 — 자산 경로 계약이 깨진 것을 정확히 숨기는 조건이다(ADR-024).**
- **워크플로우 함수를 직접 import해서 부르는 것으로 관통 테스트를 대체하지 마라. 이유: 릴레이의 주장은 "프로세스가 죽어도 디스크에서 이어진다"이고, 같은 프로세스 안의 호출은 그것을 증명하지 않는다.**
- **실제 Anthropic proposer를 쓰지 마라. `ANTHROPIC_API_KEY`를 요구하는 경로로 흐르게 두지 마라. 이유: 통합 테스트는 결정적·오프라인이어야 한다(ADR-015). 스텁으로 주입하고 검증 대상은 결정적 기계다.**
- **`e2e/` 아래 파일의 단언을 고쳐서 `npm run test:e2e`를 통과시키지 마라. 이유: 그 파일들은 회귀 방지 증거다. 깨졌다면 엔진 변경이 웹 동작을 바꾼 것이고, 고칠 것은 원인이다.**
- **통합 테스트를 통과시키려고 앞 step들이 확정한 계약(exit 코드 매핑·산출물 형태·run id 규칙)을 바꾸지 마라. 이유: 테스트가 red면 그것이 진짜 회귀다. 계약을 테스트에 맞추면 검사가 사라진다. 계약 자체가 틀렸다고 판단되면 고치지 말고 `error_message`에 적어라.**
- **임시 디렉터리를 정리하지 않고 두지 마라. 이유: 반복 실행 시 `runs/` 순번과 `current`가 앞 실행의 상태를 물려받아 테스트가 서로 간섭한다.**
- **`scripts/final-verify.sh`나 `scripts/hooks/`를 수정하지 마라. 이유: phase 게이트의 정의는 그 파일 하나이며 이 phase의 범위가 아니다.**
- **`verify`·`apply` 명령을 구현하지 마라. 이유: phase 5의 범위다. 이 step은 그 이름이 exit 2로 거부되는 것만 확인한다.**
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
