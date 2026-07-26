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

## phase 3에 넘길 것

- `SIGNAL_RULES` + `EXCLUDE` — 7 카테고리 결정적 수집 규칙. 그대로 승격 후보
- `buildSurveyPrompt` — 특히 `discipline` 필드 요구("Uses TDD is useless; …is useful")가 해상도를 만들었다. 이 지시가 없으면 결과가 어떻게 달라지는지는 미검증
- `scoreCandidates` — provenance 자동 채점
- 다음 검증: **방법론이 암묵적인 저장소**로 같은 실험. 그게 진짜 하한선이다
