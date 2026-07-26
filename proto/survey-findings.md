# SURVEY 스파이크 — 결과

> 버리는 프로토타입의 산출물. 프로덕션 계약이 아니다.
> 코드: `src/lib/engine/survey.prototype.mts` · 후보 원본: `proto/survey-candidates.json`

## 질문

> repo를 주면 LLM이 그 repo의 개발 체계를 **쓸 만한 해상도**의 후보로 뽑아낼 수 있는가?

phase 3(SURVEY를 제품 루트로)의 전제다. 거짓이면 PRD 재정의부터 구현까지 전부 헛수고다.

## 조건

- 대상: uptake 자신 (정답을 사람이 아는 유일한 저장소)
- 투입: 결정적 수집 규칙으로 고른 28개 파일 / 146KB / ≈43K 토큰
- 수행: 이 대화를 상속하지 않는 fresh 에이전트. `prompt.txt` 외 어떤 파일도 읽지 않았고 Glob/Grep/Bash를 쓰지 않았다(도구 기록으로 확인)
- 판정 기준은 실행 **전에** 고정했다

## 판정

| 축 | 결과 | 판정 |
|---|---|---|
| provenance | evidence 60건 중 **60건 resolve**, 환각 0건 | 통과 |
| precision | 후보 9건 전부 실재하는 규율. 지어낸 것 0건 | 통과 |
| recall | 정답지 14개 중 **10개 완전 포착 + 1개 부분** | 통과 |
| 해상도 | `discipline` 평균 849자. 코드를 읽어야만 알 수 있는 수준 | 통과 |

capability는 generative 8 / descriptive 1, confidence는 high 6 / medium 3.

### recall 대조

| 정답지 | 대응 후보 | |
|---|---|---|
| Spec↔Verify 루프 | `spec-before-code-acceptance-criteria` | ✓ |
| 하네스 step 실행 | `phase-step-runner` | ✓ |
| review-remediation loop | `independent-review-remediation-loop` | ✓ |
| 자기채점 금지 | 〃 (내포) | ✓ |
| provenance 필수 | `evidence-or-discard` | ✓ |
| 음성 검증 필수 | `discriminating-gate-proof` | ✓ |
| 인프라 오류≠음성 성공 | 〃 (내포) | ✓ |
| TDD 가드 훅 | `test-first-pre-edit-hook` | ✓ |
| conventional commits + 2단계 커밋 | `phase-step-runner` (내포) | ✓ |
| step 단위 루프 금지 | `independent-review-remediation-loop` + `scope-containment-routing` | ✓ |
| 이중 게이트 | `evidence-or-discard` — 하드 게이트만, 소프트 게이트 누락 | △ |
| 불신 데이터 격리 | — | ✗ |
| 결정성 경계 (ADR-015) | — | ✗ |
| 서술적 태도 (ADR-006) | — | ✗ |

**미포착 3건은 SURVEY의 실패가 아니라 정답지의 결함이다.** 셋 다 uptake *제품이 구현하는 설계
원칙*이지 *기여자가 따르는 개발 규율*이 아니다. 프롬프트가 "the rules, gates, and rituals its
contributors actually follow, **not what the code does**"를 명시했으므로 에이전트는 지시를 정확히
따랐다. 정답지가 두 범주를 섞어 놓았던 것이다. SURVEY가 그 경계를 지킨다는 것 자체가 관찰 결과다.

### 정답지에 없던 실재 규율 2건

사람이 만든 정답지가 놓쳤고 SURVEY가 찾은 것:

- `stop-gate-full-verification` — Stop 훅이 `lint && build && test`를 돌려 실패 시 세션 종료를 막는다. 서브프로세스 출력을 stderr로 몰아 JSON stdout 채널을 비워 두는 계약까지 포착
- `dual-runtime-harness-parity` — 스킬 정본 1곳 + 심볼릭 링크, 훅은 두 규격을 한 스크립트에서 분기, payload 형태별 테스트 클래스 분리

## 해상도 증거

판정을 가른 축이므로 원문을 인용한다.

> A PreToolUse hook (`scripts/hooks/tdd-guard.sh`) intercepts Claude 'Edit|Write' and Codex
> 'apply_patch' tool calls … emits permissionDecision "deny" for any .ts/.tsx/.js/.jsx file that
> has no sibling `<name>.test.*` … **a directory whose name merely contains 'test' (e.g. `latest/`)
> does not grant exemption.** … `scripts/test_tdd_guard.py` asserts the deny path, not only the allow path.

> findings receive stable F-NNN ids plus a **sha1 fingerprint over (normalized first evidence path
> | sorted spec refs | title slug)** … a third agent — different from both the full reviewer and the
> fix implementer — performs the closure review.

`latest/` 예외나 fingerprint 조합식은 사람이 만든 정답지에도 없던 디테일이다. README 요약 수준이
아니라는 판정의 근거가 이것이다.

## 결론

**가정은 지지된다.** 네 축 전부 통과했고, 사람보다 세밀한 항목을 2건 더 찾았다.

## 한계 — 결론을 넘겨 읽지 마라

1. **표본 1회.** 모델 한 번의 관찰이다. 재현·변동폭을 보지 않았다.
2. **대상이 유별나게 친절하다.** uptake는 `AGENTS.md`에 CRITICAL 규칙이 나열돼 있고, 훅에 테스트가 붙어 있고, ADR이 결정을 남긴다. **이 실험은 상한선을 본 것이지 평균이 아니다.** 방법론이 암묵적인 저장소(문서 없이 관행만 있는 곳)에서 같은 결과가 나온다는 증거는 없다.
3. **정답지를 사람이 만들었다.** recall 분모 자체가 편향돼 있다 — 실제로 위 '정답지에 없던 실재 규율 2건'이 그 증거다.

## 실행 전에 얻은 부수 발견

첫 수집 규칙(`SIGNAL_RULES`)이 `scripts/execute.py`와 `scripts/remediate.py`를 놓쳤다. 문서와
에이전트 설정만 보면 "무엇을 하기로 했는가"는 알아도 **"무엇이 실제로 강제되는가"** 는 못 본다.
`automation` 규칙을 추가해 24→28 파일이 됐고, 최종 후보 9건 중 5건이 그 파일들을 evidence로 쓴다.

**방법론이 문서가 아니라 실행 가능한 기계로 존재할 때 수집이 취약하다** — phase 3 설계에
그대로 반영할 것.

---

# 2차 — 하한선 검증 (방법론이 문서로 명시되지 않은 저장소)

## 질문

1차 대상 uptake는 `AGENTS.md`에 CRITICAL 규칙이 나열된 유별나게 친절한 저장소였다. **문서 없이
관행만 있는 곳에서도 되는가?**

## 조건

- 대상: `tech-blog` — docs/ 0개, AGENTS/CLAUDE/CONTRIBUTING 0개. 방법론이 있다면 훅·CI·설정에만 존재
- 투입: **7개 파일 / 9.7KB / ≈2.8K 토큰** (1차의 1/15)
- 수행: 별도 fresh 에이전트. 도구 사용 Read·Write 2회뿐
- 사전 고정한 실패 모드: **재료가 부족할 때 그럴듯한 일반론을 지어내는가**

## 판정

| 축 | 결과 |
|---|---|
| provenance | evidence **12/12 resolve**, 환각 0건 |
| precision | 후보 4건 전부 대조 검증 통과 (아래) |
| 후보 수 | 9 → **4건**. 재료에 비례해 줄었다 |
| confidence 분포 | high 6/med 3 → **high 1 / med 1 / low 2** |
| 해상도 | 유지 |

주장 대조 (사람이 파일을 열어 확인):

| 주장 | 실제 |
|---|---|
| `npx --no-install lint-staged` | `.husky/pre-commit` 그대로 |
| test script가 아예 없다 | `scripts.test` 부재 확인 |
| lint-staged가 eslint --fix + prettier --write | 확장자 목록까지 일치 |
| `allBlogs.filter((post) => post.draft !== true)` | `scripts/rss.mjs:41` 그대로 |
| pages.yml이 main push, `needs: build`, `cancel-in-progress: false` | 전부 일치 |
| README는 Vercel인데 workflow는 GitHub Pages | README 5·30행 Vercel, 31행 기반 템플릿 명시 |

## 사전 고정한 실패 모드는 나타나지 않았다 — 정반대였다

1. **없는 것을 관찰했다.** "no test, type-check, or whole-repo pass is gated (package.json defines
   no test script at all)" / "rejected by no hook and no CI step, so beyond `draft` the contract is
   **documentation, not a gate**". 문서상 규칙과 실제 강제를 구분했다.
2. **자기 반증을 제시했다.** ③에 스스로 단서를 붙였다 — "README names Vercel while this workflow
   targets GitHub Pages … the workflow **may be inherited rather than the path actually practised**."
   1차에서는 나오지 않은 행동이다. 재료가 빈약하자 더 신중해졌다.

이것은 1차 결과의 방증이기도 하다. 1차의 high 편중이 "사전 지식으로 답한 것" 때문이었다면 재료를
1/15로 줄여도 confidence가 유지됐어야 한다. 실제로는 정직하게 떨어졌다 — **모델이 재료에
반응하고 있다.**

## 예상 못 한 발견 — SURVEY는 "존재하는 규율"을 찾지 "채택된 규율"을 찾지 않는다

저장소 소유자 확인 결과: **4건 중 저자가 의도한 것은 1건**(`fixed-tag-vocabulary`), 나머지 3건은
`tailwind-nextjs-starter-blog` 템플릿에서 상속된 것이었다. 소유자는 "개발 방법을 생각하고 진행한
게 아니다"라고 진술했다.

confidence는 **저자 의도가 아니라 강제력**을 반영했다. 유일하게 의도된 ④가 가장 낮은 등급
(descriptive/low)을 받았는데, 이는 옳은 판단이다 — 그 규칙을 검증하는 장치가 실제로 없다.

**함의:** `capability`(판별 오라클 유무)·`evidenceStatus`(근거 repo 수) 외에 **"이 저장소가 만든
것인가 / 상속받은 것인가"** 를 가르는 축이 필요하다. 남의 저장소를 분석했을 때 보일러플레이트를
"그 팀의 방법론"으로 제시하면 사용자는 잘못된 것을 배운다.

구분 신호 후보(미검증): git 히스토리(초기 커밋에 통째로 들어왔는지 vs 나중에 따로 추가됐는지),
README의 명시적 설명 유무, 기본값 대비 커스터마이징 흔적.

**비율은 일반화하지 마라.** tech-blog는 템플릿 기반 개인 블로그로 상속 비중이 극단적인 케이스다.
성숙한 OSS는 다를 것이다. "구분 축이 필요하다"는 결론만 유효하다.

## 2차의 한계

- recall 미측정. 소유자에게 "의도한 규율" 목록이 없어 정답지를 만들 수 없었다
- 여전히 표본 1회
- 두 대상 모두 사람이 아는 저장소다. 낯선 대형 OSS는 미검증

---

# 3차 — 낯선 대형 OSS (pytest)

## 질문

1·2차 대상은 모두 사람이 아는 저장소였다. **낯선 대형 OSS에서도 되는가?** 그리고 유명 저장소일수록
모델이 재료 대신 **사전 지식**으로 답할 위험이 있다 — 그것을 배제할 수 있는가?

## 조건

- 대상: `pytest-dev/pytest` (652 파일, shallow clone)
- 투입: 76개 파일 / 227.7KB / ≈67K 토큰
- 프롬프트에 사전 지식 사용을 명시적으로 금지
- 수행: 별도 fresh 에이전트

## 실행 전에 드러난 수집 결함 2건

| 결함 | 증상 | 조치 |
|---|---|---|
| **생태계 편향** | 문서 규칙이 `.md`만 봐서 `CONTRIBUTING.rst`와 `doc/` 129개를 통째로 누락. `agent-instructions` 0개, `design-docs` 0개 | `.rst`/`.txt` 추가 |
| **규모 대응** | 문서 129개가 예산 220KB를 독식해 `hooks`·`task-runner`·`test-config`가 전멸. 하필 잘린 것이 `.pre-commit-config.yaml`과 `tox.ini` | 카테고리별 라운드로빈(`interleaveByRule`) + 예산 초과 시 `continue` |

수정 후 7개 카테고리 전부 생존. uptake 재수집은 28파일 146.3KB로 1차와 동일해 재현성을 유지했다.

## 판정

| 축 | 결과 |
|---|---|
| provenance | evidence **87/87 resolve**, 환각 0건 |
| precision | 대조한 주장 전부 정확 (아래) |
| 후보 수 | **13건** — 재료 규모에 비례 |
| confidence | high 12 / medium 1 |
| 해상도 | `discipline` 평균 **1392자** — 3회 중 최고 |

capability는 generative 11 / descriptive 2.

주장 대조 (사람이 파일을 열어 확인):

| 주장 | 실제 |
|---|---|
| `py-path-deprecated`의 exclude 4항목 | `.pre-commit-config.yaml:166` 문자 단위 일치 |
| `language: pygrep` 로컬 훅 2개 | `:148`, `:164` |
| ruff `per-file-ignores`로 vendored 트리 예외 | `pyproject.toml:185` |
| CONTRIBUTING의 AI/LLM 정책, "will be closed" | `:187`, `:213-215` 정확히 인용 |
| `release.py`가 `Co-authored-by` 수집, `[bot]` 제외 | `:30`, `:41` — `if not name.endswith("[bot]") and name != "pytest bot"` 그대로 |

## 사전 지식 오염은 배제된다

가장 특이한 후보 `human-accountability-for-contributions`의 근거는 pytest의 **AI/LLM 기여 정책**이다.
최근 추가된 문서이고, 본문의 "clankers"(무인 에이전트 산출물을 부르는 은어) 같은 표현은 모델 기억에
있을 만한 것이 아니다. 재료에서 직접 읽었다는 증거다.

자기 반증도 유지됐다 — "zizmor가 강제하는 규칙셋은 제시된 파일에 없어 확인 불가, 워크플로의
균일성이 직접 증거일 뿐" / "quarantine된 파일 자체는 제시되지 않아 내용을 확인할 수 없고 그것을
지목하는 훅만 보인다".

## 상속 문제는 성숙도에 반비례한다

2차(tech-blog)는 4건 중 3건이 템플릿 상속이었다. pytest 13건은 **전부 자생**이다 — changelog
fragment, tox 단일 인터페이스, pygrep 격리, 플러그인 역의존성 테스트 모두 그 프로젝트가 겪은
문제에서 나온 것이다. "자생 vs 상속" 축은 여전히 필요하지만, 성숙한 OSS에서는 덜 심각하다.

---

# 세 실험 종합

| | uptake | tech-blog | pytest |
|---|---|---|---|
| 재료 | 28파일 / 43K tok | 7파일 / 2.8K tok | 76파일 / 67K tok |
| 후보 | 9건 | 4건 | 13건 |
| provenance | 60/60 | 12/12 | 87/87 |
| 환각 | 0건 | 0건 | 0건 |
| confidence | h6 m3 | h1 m1 l2 | h12 m1 |
| `discipline` 평균 | 849자 | — | 1392자 |
| 자생/상속 | 자생 | 1/4 자생 | 전부 자생 |

**후보 수는 재료 규모에, confidence는 재료 품질에 비례한다. 환각은 세 번 모두 0건이다.**
세 번 모두 확신이 부족한 지점에 자기 반증을 붙였다.

**가정은 확정한다** — 규모·성숙도·언어가 다른 세 저장소에서 일관된 결과가 나왔다.

## 가장 중요한 결론: 병목은 LLM이 아니라 수집 규칙이다

세 실험에서 발견된 결함은 전부 수집 규칙에 있었다:

| 실험 | 결함 | 놓친 것 |
|---|---|---|
| 1차 | `automation` 규칙 부재 | `execute.py`·`remediate.py` — 최종 후보 9건 중 5건의 근거 |
| 3차 | `.md`만 인식 | `CONTRIBUTING.rst`, `doc/` 전체 |
| 3차 | 카테고리 예산 독식 | `.pre-commit-config.yaml`, `tox.ini` |

세 번 다 규칙을 고치자 결과가 살아났다. **수집 규칙이 SURVEY의 성능 상한이며, 코드에 박을 것이
아니라 생태계별로 확장 가능한 데이터여야 한다.**

## 남은 미검증

- 각 대상 1회씩. 재현·변동폭 미측정
- recall은 1차에서만 측정 가능했다(정답지가 있는 유일한 대상)
- 상속 구분 신호(git 히스토리 등)는 아이디어일 뿐 미검증
- 모노레포, 문서가 위키에만 있는 저장소, 비영어권 저장소 미검증

## phase 3에 넘길 것

- `SIGNAL_RULES` + `EXCLUDE` — 7 카테고리 결정적 수집 규칙. 그대로 승격 후보
- `buildSurveyPrompt` — 특히 `discipline` 필드 요구("Uses TDD is useless; …is useful")가 해상도를 만들었다. 이 지시가 없으면 결과가 어떻게 달라지는지는 미검증
- `scoreCandidates` — provenance 자동 채점
- **상속 vs 자생 구분 축** — 2차의 최대 수확. `capability`·`evidenceStatus`와 직교하는 새 축이 필요하다
- 다음 검증(미실행): 낯선 대형 OSS. 두 실험 모두 사람이 아는 저장소였다
