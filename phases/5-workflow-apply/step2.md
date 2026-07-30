# Step 2: cli-verify

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — CRITICAL 규칙 전부, 특히 층 1/층 2 게이트와 `gate-error`의 정의
- `/docs/ARCHITECTURE.md` — '워크플로우 산출물 계약' 전부, **'층 1 재검증 (ADR-025)'**, 종료 코드와 "exit 2가 워크플로우를 가르친다", '미구현 단계의 표현'
- `/docs/ADR.md` — ADR-008(양성 green AND 음성 red · `gate-error`), ADR-012(capability↔oracle), ADR-023(CLI author는 채택 경로만), ADR-025(소비 시점 층 1 재검증)
- `/docs/PRD.md` — 'Phase 5 범위'
- `/src/workflow/steps/survey.ts`, `/src/workflow/steps/author.ts` — 명령 하나가 어떤 모양인지(선행조건 검사 → 엔진 호출 → 성공/실패 무관 산출물 기록 → 종료 코드+메시지). **이 모양을 따른다.**
- `/src/workflow/cli.ts`, `/bin/uptake.ts` — 명령 디스패치
- `/src/workflow/artifacts.ts`, `/src/workflow/prerequisites.ts`, `/src/workflow/paths.ts` — step 1이 만든 저장 층
- `/src/lib/catalog/load.ts` — `validatePatternValue`의 4개 검사 순서
- `/src/lib/engine/detect.ts`, `/src/lib/engine/instantiate.ts`, `/src/lib/engine/verify.ts`, `/src/lib/engine/target.ts`
- `/templates/METHOD.md` — 배포된 명령을 밝히는 문단

**이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.** step 0이 엔진을 CLI가 쓸 수 있게 만들었고(`hashBindings`·설치 위치 기준 vitest 경로·실패 분기의 로그 경로), step 1이 산출물 저장 층과 `targetEligibility` 공용 모듈을 만들었다.

## 작업

### (a) `src/workflow/steps/verify.ts`

```ts
export type VerifyCommandResult = { exitCode: 0 | 1 | 2 | 3; message: string };

export async function runVerifyCommand(
  targetRepoRoot: string,
  root?: string,
): Promise<VerifyCommandResult>;
```

순서대로 처리한다. **각 단계의 종료 코드를 뭉치지 마라.**

1. `readCurrentRun` → 없으면 exit 2, "`uptake survey <repository>`부터 실행하라".
2. `authoringState(runId)` → `missing`/`failed`면 exit 2. 실패면 그 status·detail을 그대로 보이고 다음에 칠 명령을 알려준다. **산출물을 쓰지 않는다**(이 명령은 실행되지 않았다).
3. **층 1 재검증 (ADR-025).** `authoring.json`의 `pattern`을 읽은 **직후**, 다른 무엇을 하기 전에:

   ```ts
   validatePatternValue(pattern, `${pattern.patternId}.json`, sourceRoot(root))
   ```

   **파일명을 반드시 합성하라.** `"authoring.json"`을 그대로 넘기면 `load.ts`의 `basename(filename, extname(filename)) !== value.patternId` 검사가 `schema-invalid`로 조기 리턴해 `validateReferences`·`validateEvidence`·`validateProvenance`에 **도달하지 못한다** — provenance 재검증이 돌지 않은 채 "통과"를 보게 된다. 그 검사는 카탈로그 파일명 규약(`catalog/<patternId>.json`)을 강제하는 것이고 `filename`은 산출물의 일부가 아니라 호출자가 주는 인자다. **이 사실을 코드 주석에 남겨라.**

   실패 시 `verify.json`에 `status: "pattern-invalid"`, `detail`에 validation의 `reason`을 담아 기록하고 exit 1. 이것이 CLI 경로의 층 1 보증 전부다 — 건너뛰거나 조건부로 만들지 마라.
4. `targetEligibility(targetRepoRoot)` → 사유가 있으면 `verify.json`에 `status: "target-ineligible"` 기록 후 exit 2.
5. `detectBindings(pattern, targetRepoRoot)` → **결과를 즉시 `bindings.json`에 기록한다**(항상 쓰는 산출물).
6. `checker`가 `vitest`로 해소되지 않았거나 `gate-location`이 미해소면 `status: "bindings-unresolved"` 기록 후 exit 2. 이유: CLI에는 바인딩을 입력받는 경로가 없고(이식 산출물의 파라미터화는 phase 5 비범위), 이것은 "지금 이 명령을 실행할 수 없다 + 대신 무엇을 할지"에 해당한다. `spec-format`·`naming`의 미해소는 **막지 마라** — 현재 엔진은 그 둘을 생성에 쓰지 않는다.
7. `instantiate(pattern, bindings)` → `ok: false`면 `reason`(`generation-blocked` · `generation-failed` · `injection-failed`)을 그대로 `verify.json`의 status로 기록하고 exit 1.
   - **CLI `author`가 만든 패턴은 항상 `descriptive`/`observed`이므로 여기서 `generation-blocked`으로 막히는 것이 정상 동작이다**(ADR-023의 트레이드오프). 이 사실을 우회하는 코드를 넣지 마라 — 층 2 게이트를 우회하는 것이다. 메시지는 "이 패턴은 서술적이라 생성 대상이 아니다"를 서술적으로 알린다.
8. `prepareVerification(pattern, generated, bindings, targetRepoRoot)` → `prepared`가 아니면 `status: "positive-failed"`로 기록하고 exit 1.
9. `executeVerification(prepared)`:
   - 게이트를 돌린 만큼 로그를 `logs/positive.log`·`logs/negative.log`로 복사한다. **성공·실패 무관하게, 얻은 로그는 전부 남긴다.**
   - `awaiting-approval` → `generated.json` 기록 후 `verify.json`에 `status: "verified"`, `verificationId`(새 UUID), 해시 3종(`contentHash`는 outcome의 값, `bindingsHash`는 `hashBindings(bindings)`, `targetBaseHash`는 `hashTargetBase(targetRepoRoot)`), `frozenArgv`, `gateTestId`, preview 4필드를 기록하고 exit 0.
   - `gate-error` · `timeout` → `verify.json`을 기록하고 **exit 3**. 리포터를 못 만든 실행은 인프라 오류이며 red가 아니다(ADR-008). **산출물과 로그는 남긴다** — exit 3이라고 기록을 생략하지 마라.
   - 그 외 실패(`positive-failed` · `injection-failed` · `negative-not-caught`) → 기록하고 exit 1.

핵심 규칙:

- **엔진 상태 이름을 그대로 직렬화한다.** 예외는 성공뿐이다 — 엔진의 `awaiting-approval`은 CLI 산출물에서 `verified`로 적는다(ARCHITECTURE 릴레이 표가 `status=verified`로 못박았다). 승인은 `apply`가 대화형으로 받으므로 CLI 산출물에 "승인 대기"라는 상태는 존재하지 않는다.
- **재실행은 산출물을 덮어쓴다.** 단 이전 `apply.json`은 지우지 마라 — 기록이다. 새 검증은 새 `verificationId`를 발급하므로 이전 적용 기록과 자동으로 구분된다.
- **`verify`는 카탈로그를 읽지 않는다**(ADR-025). `loadCatalog`·`UPTAKE_CATALOG_DIR`를 쓰지 마라.
- **HEAD를 다시 읽지 마라.** 이 명령은 패턴의 `sources[].revision`을 그대로 소비한다(provenance 재검증은 `validatePatternValue`가 그 revision에서 한다).

### (b) `src/workflow/cli.ts` 배선

- `KNOWN_COMMANDS`에 `"verify"`를 추가한다. **`"apply"`는 아직 추가하지 마라** — CLI는 아직 없는 명령의 이름을 알지 않는다(ARCHITECTURE '미구현 단계의 표현'). `uptake apply`는 unknown으로 처리돼 명령 목록 + exit 2로 나가야 한다.
- `--target <absolute-path>`를 파싱한다. 없거나 빈 값이면 `Usage: uptake verify --target <absolute path>` + exit 2. 절대경로가 아니면 exit 2(사유를 밝힌다).

### (c) 배포 현황 문구 갱신

`verify`가 배포됐으므로 아래 두 곳이 더는 참이 아니다. **자기가 배포한 것까지만 정직하게 반영하라 — `apply`가 배포된 것처럼 쓰지 마라.**

- `templates/METHOD.md`: "현재 배포된 명령은 `init` · `survey` · `author`다. `verify`·`apply`는 아직 배포되지 않았다." → `verify`를 배포 목록으로 옮기고 `apply`만 미배포로 남긴다. 다섯 단계 체인 자체는 그대로 둔다(방법론 문서이지 구현 현황 문서가 아니다).
- `src/workflow/steps/author.ts`의 성공 메시지 마지막 줄 `"This is the current end of the deployed workflow."` → 다음 명령 안내(`uptake verify --target <absolute path>`)로 바꾼다. 그리고 **`verify` 성공 메시지가 "여기까지가 현재 배포된 워크플로우"를 말한다**(마지막 배포 단계의 성공 메시지는 다음 명령 대신 그것을 말한다).

`init`이 기존 `.uptake/METHOD.md`를 덮어쓰지 않는 것은 **의도된 멱등성이다** — 템플릿만 고치고 `init`의 동작을 바꾸지 마라.

## Acceptance Criteria

```bash
npm run lint     # 통과
npm run build    # 컴파일 에러 없음
npm test         # 전체 통과
```

추가로 아래가 존재하고 통과해야 한다:

```bash
npx vitest run src/workflow/steps/verify.test.ts src/workflow/cli.test.ts src/workflow/steps/author.test.ts
```

`src/workflow/steps/verify.test.ts`가 덮어야 할 것:

- 선행조건: run 없음 / `authoring.json` 없음 / `authoring.json`이 실패 상태 → 각각 exit 2이고 **`verify.json`을 만들지 않는다.**
- **층 1 재검증이 실제로 provenance까지 돈다** — `authoring.json`의 `pattern.provenance`에 실재하지 않는 경로를 심으면 `status: "pattern-invalid"`(reason `provenance-unresolved`) + exit 1. 이 테스트가 파일명 합성 누락을 잡는 장치다: 합성하지 않으면 reason이 `schema-invalid`가 되므로 **reason 값까지 단언하라.**
- `descriptive` 패턴 → `status: "generation-blocked"` + exit 1 + `bindings.json`은 기록됨.
- 타깃 부적격(`package.json` 없음 등) → `status: "target-ineligible"` + exit 2.
- 성공 경로 — 실제 게이트를 돌려 `status: "verified"`, `generated.json` 존재, `logs/positive.log`·`logs/negative.log` 존재, 해시 3종이 전부 채워짐, exit 0. (`tests/fixtures/target-vitest`와 씨앗 패턴을 fixture 소스로 재구성해 쓴다 — `e2e/fixtures.config.ts`가 같은 일을 하는 코드다.)

`src/workflow/cli.test.ts`에 추가: `uptake apply`가 여전히 unknown(명령 목록 + exit 2), `verify`가 `--target` 없이는 exit 2.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/5-workflow-apply/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`validatePatternValue`에 `"authoring.json"`을 넘기지 마라. 이유:** 파일명 검사에서 `schema-invalid`로 조기 리턴해 provenance 재검증에 도달하지 못한다 — 게이트가 도는 것처럼 보이지만 실제로는 층 1 보증이 없다(성공 위장).
- **`gate-error`·`timeout`을 exit 1로 내보내지 마라. 이유:** 인프라 오류를 게이트 실패로 세는 것은 ADR-008이 가장 위험한 형태의 성공 위장으로 지목한 것이다. 반대 방향도 같다 — `negative-not-caught`를 exit 3으로 빼지 마라.
- **`generation-blocked`을 우회하는 분기를 만들지 마라. 이유:** `generative` AND `corroborated`가 아니면 생성을 막는 것이 층 2 게이트 자체이며(ADR-007/012), CLI가 그것을 피해 가면 웹과 다른 보증을 갖게 된다.
- **승인·적용을 여기서 하지 마라. 이유:** `verify`는 검증까지이고 타깃 저장소를 바꾸지 않는다. 적용은 step 3의 대화형 `apply`다.
- **`apply`를 `KNOWN_COMMANDS`에 넣지 마라. 이유:** 구현되지 않은 단계의 이름을 코드가 미리 알면 시그니처가 바뀔 때 죽은 문자열이 남는다(ARCHITECTURE).
- **새 phase 디렉터리를 만들거나 `scripts/execute.py`를 재귀 실행하지 마라. 이유: step은 자기 phase 안에서만 작업한다.**
- 기존 테스트를 깨뜨리지 마라
