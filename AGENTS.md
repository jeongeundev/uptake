# 프로젝트: uptake

오픈소스 저장소에 결합된 *코드가 아니라 개발 방법론*(MVP 앵커: Spec↔Verification 루프)을 재사용 가능한 파라미터화된 패턴으로 **추상화·이식·검증**하는 도구.
명제: "오픈소스가 코드에 해준 것을 개발 방법론에 한다."

## 문서 지도
- [`docs/PRD.md`](./docs/PRD.md) — 요구사항 (무엇을·누구를 위해) + **MVP 수용 기준** (구현 전 테스트로 옮길 대상)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 설계 (어떻게) + VERIFY 실행 계약 · 신뢰 경계 · 패턴 직렬화 계약
- [`docs/ADR.md`](./docs/ADR.md) — 결정 기록 (왜) · ADR-001~013
- [`docs/UI_GUIDE.md`](./docs/UI_GUIDE.md) — UI 가이드 (※ 잠정, 미확정)

## 기술 스택
- Next.js 15 (App Router) / TypeScript strict
- Tailwind CSS
- Anthropic SDK (Claude 최신 모델)
- 로컬-우선 실행 (사용자 repo에서 동작, 검증도 로컬 툴체인 = vitest)

## 아키텍처 규칙
- CRITICAL: 모든 추출·생성 결과는 **검증 가능한 provenance(실재하는 소스 파일 경로)**를 달아야 한다. resolve 안 되면 폐기. 환각 금지. (ADR-009)
- CRITICAL: 태도는 **서술적**이다 — "성공 repo가 *실제로* 이렇게 한다 + 트레이드오프". "이게 정답"이라는 규범적 단정 금지. (ADR-006)
- CRITICAL: 생성물은 **자기검증**을 통과해야 한다 — 양성(준수→green) **그리고** 음성(심은 위반→red로 잡힘). green만으론 증명이 아니다. 성공 위장 절대 금지 — 실패는 정직하게 표면화. (ADR-008)
- CRITICAL: 신뢰할 수 없는 repo 내용은 **데이터로 격리**한다(프롬프트 지시로 취급 금지). 생성 코드는 diff 미리보기+명시적 적용, 실행은 테스트 커맨드로 한정. (ARCHITECTURE.md)
- 번역 엔진은 3단계(EXTRACT→ABSTRACT→INSTANTIATE). 패턴의 **스택-불변 본질**과 **스택-종속 결합점**을 분리하고, 구현만 교체한다. 환원 불가능한 핵심 가치 = ABSTRACT(떼어내기). (ADR-004)
- 앱이 구현하는 범위는 phase마다 넓어진다 — MVP는 INSTANTIATE·VERIFY, phase 2가 EXTRACT·ABSTRACT를 앱 안으로 들였고(ADR-014), phase 3는 그 **앞단에 SURVEY(발견)를 놓아 제품 루트로 삼는다**(ADR-017). 사용자는 저장소만 지정하고 앱이 후보를 제안하며, intent는 입력이 아니라 산출이다. **현재 범위의 정본은 `docs/PRD.md`의 Phase 범위 절이다.**
- CRITICAL: 게이트의 **red는 exit code가 아니다** — 리포터 출력에서 `oracle.gateTestId` 테스트가 실패한 것만 red다. 리포터를 못 만든 실행(설치·설정·문법 오류, timeout, signal)은 `gate-error`이며 **음성 성공으로 계산하지 않는다**. 인프라 오류를 "위반을 잡았다"로 세는 것이 성공 위장의 가장 위험한 형태다. (ADR-008)
- 패턴은 **직교하는 두 축**으로 분류한다 — `capability`(`generative`/`descriptive`, 판별 오라클 유무·ADR-012)와 `evidenceStatus`(`observed`/`corroborated`, 근거 repo 수·ADR-005). 둘 다 "tier"라고 부르지 않는다. **세 번째 축을 추가하지 마라** — 자생/상속 구분은 실재하는 문제지만 검증 가능한 판정 신호가 없어 분류에 쓰지 않는다. 근거 없는 딱지는 사용자에게 틀린 확신을 준다. (ADR-019)
- CRITICAL: SURVEY의 수집 규칙("어디를 볼까")은 **생태계별로 확장 가능한 데이터**다. 코드에 박지 마라. 카테고리별 예산 배분 없이 한 카테고리가 전체를 독식하면 핵심 신호가 굶는다 — 실측으로 확인된 실패다. (ADR-018)
- 게이트는 **두 층**이다. 뭉치지 마라 — provenance resolve 실패·스키마 위반(`capability`↔`oracle` 불일치, `corroborated` 선언인데 독립 근거 미달)은 **카탈로그 로드 거부**(등재 자체가 없다). `generative` AND `corroborated` 미충족은 **등재·서술은 하되 생성만 차단**. (ADR-005/007/009/012)
- **탐지는 넓게(서술 포함) / 생성은 깊게(게이트형만)**. MVP 앵커는 Spec↔Verify 루프 하나. (ADR-002/003)
- 타깃 스택은 **JS/TS(vitest) 하나**. 씨앗 클러스터엔 타깃과 **다른 스택**을 최소 하나 포함(복사 아님을 증명). (ADR-013)

## 개발 프로세스
- 작업 흐름은 **한 방향**이다: 아이디어 → `docs/`(PRD·ADR·ARCHITECTURE) 갱신 → `$harness`로 phase 설계·구현 → **독립 세션에서 리뷰 한 번**. 리뷰는 판정만 하고 끝난다.
- 리뷰는 **두 축을 각각 다른 스킬이 맡는다.** 범용(코딩 표준·스펙 대조·코드 스멜)은 내장 `/code-review <base>`, uptake 고유 검증(성공 위장·provenance·반박 검증)은 `$review <base>`. 겹치지 않으므로 둘 다 돌린다. 자체 스킬에 범용 리뷰를 다시 구현하지 마라.
- CRITICAL: **리뷰 결과를 `phases/`로 되먹이지 마라.** `phases/`에는 정방향 구현만 들어간다. 리뷰가 지적한 것을 고칠지는 사람이 정하고, 고친다면 그것은 새 작업이지 그 phase의 연장이 아니다. 수정 루프를 phase로 만들면 phase 이름이 갈라지고 재진입 지점이 생긴다(실제 사고 기록: `remediation/README.md`).
- CRITICAL: 이 프로젝트는 자기가 설파하는 방법론을 **dogfooding**한다 — 새 기능은 스펙(수용 기준)을 먼저, 그 기준을 검사하는 테스트를 먼저 작성하고 통과시킨다 (TDD / Spec↔Verify).
- over-engineering 금지: 요청하지 않은 유연성·추상화·미래 대비를 넣지 않는다. 리스크/보안은 표적 수준으로만.
- 커밋 메시지는 conventional commits (feat:, fix:, docs:, refactor:).

## 명령어
> 스캐폴딩 착수 후 확정. 계획상 예정 명령어:
```
npm run dev      # 개발 서버 (로컬호스트)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트 (vitest)
npm run eval:proposer # 선택적 실제 proposer smoke (AC 아님; 키가 없으면 정상 skip)
```

실제 Anthropic proposer는 `ANTHROPIC_API_KEY`와 `UPTAKE_PROPOSER_MODEL`을 모두 요구한다. 구조화 출력(JSON schema)을 지원하는 모델을 명시해야 하며 권장 설정은 `UPTAKE_PROPOSER_MODEL=claude-opus-5`다(코드 기본값 없음).

## 하네스

Step 실행기는 Claude 전용이고, 훅과 스킬은 **Codex·Claude Code 양쪽에서 동작한다.**

| 대상 | 위치 |
|------|------|
| Step 실행기 | `scripts/execute.py` — `python3 scripts/execute.py <phase-dir> [--push]` (`claude -p` 호출, 모델 `sonnet`) |
| 훅 정의 | Codex `.codex/hooks.json` · Claude Code `.claude/settings.json` |
| 훅 스크립트 | `scripts/hooks/` — 두 규격을 한 파일에서 분기 처리한다 |
| 스킬 | `.agents/skills/<name>/SKILL.md` (정본) — Codex가 읽는 위치. 대화 중 `$`로 호출 |
| 슬래시 커맨드 | `.claude/commands/*.md` — 위 SKILL.md로 가는 **심볼릭 링크** |

저장소 스킬은 **둘뿐이다**: `$harness`(구현) · `$review`(uptake 고유 검증 축). 서로를 호출하지 않는다.
범용 코드리뷰는 저장소가 아니라 **내장 `/code-review`**가 맡는다 — 중복 구현하지 마라.
step 실행 세션은 실행기가 `--disable-slash-commands`로 스킬 호출 능력을 **제거**한 채 띄운다 —
"하지 마라"를 프롬프트에 적는 것만으로는 확률적으로 샌다(실측).

실행 모델은 `StepExecutor.AGENT_MODEL`에 상수로 박혀 있다. step 실행은 확정된 설계를 코드로 옮기는 구현 노동이고, 품질은 AC 검증과 3회 자가교정 루프가 잡는다.

스킬 경로는 도구마다 다르다. Codex는 프로젝트 스킬을 `.agents/skills/`에서만 찾고 `.codex/skills/`는 보지 않는다. **Claude Code는 반대로 `.agents/skills/`를 읽지 않는다** — `.claude/commands/`의 심볼릭 링크를 지우면 Claude Code에서 스킬이 그대로 사라진다(실측). 링크는 편의가 아니라 필수이며, 내용은 정본 한 곳만 고친다.

훅 스크립트를 수정할 때는 두 규격을 모두 깨뜨리지 않았는지 확인한다:

```
python3 -m pytest scripts/ -q
```

`tdd-guard.sh`는 잘못 짜여도 에러를 내지 않고 **모든 편집을 조용히 통과시킨다.** 그래서 양성(테스트 있으면 통과)뿐 아니라 음성(테스트 없으면 차단)까지 검사한다 — 통과만 확인하면 가드가 죽은 것과 구분되지 않는다.

`.codex/hooks.json`은 **개별 훅이 신뢰(trust)되기 전까지 조용히 무시된다.** `~/.codex/config.toml`의 `[projects."<repo>"] trust_level = "trusted"`만으로는 부족하다 — 훅은 내용 해시 단위로 따로 승인되며, 훅을 수정하면 재승인해야 한다. 대화형 세션에서 `/hooks`로 검토·신뢰시킨다. (Codex를 대화형으로 쓸 때만 해당한다. Step 실행기는 Codex를 부르지 않는다.)

`scripts/execute.py`는 헤드리스로 돌아 승인 UI가 없으므로 `--dangerously-skip-permissions`를 붙인다 — 이 저장소의 훅만 벡팅했다는 전제다. Claude Code의 훅은 이 플래그와 무관하게 걸리므로 `tdd-guard`와 `stop-verify`는 step 실행 중에도 그대로 살아 있다.

### CRITICAL: 실행기 오류는 step 실패가 아니다

`claude`를 **띄우지 못한 것**(쿼터 소진·CLI 부재·타임아웃)과 **step 구현이 실패한 것**은 다르다. 실행기가 비정상 종료했는데 step이 `index.json`의 status를 건드리지도 못했다면 하네스 오류이며, `execute.py`는 이때:

- status를 `pending`으로 **남긴다** (`error`로 기록하지 않는다)
- 재시도를 태우지 않는다 (쿼터가 없는 상태에서 3회 헛도는 낭비를 막는다)
- 커밋하지 않는다 (반쪽 작업이 `feat(...)`로 들어가는 것을 막는다)
- `phases/index.json`을 건드리지 않고 **exit code 3**으로 멈춘다

원인이 해소되면 같은 명령을 그대로 재실행하면 된다 — 중단된 step부터 이어진다. 이것은 게이트의 `gate-error`와 같은 원칙이다(ADR-008): 인프라 오류를 결과로 계산하지 않는다. **exit 1(step 실패)과 exit 3(하네스 오류)을 뭉치지 마라.**

exit code: `1` = step 실패, `2` = blocked(사용자 개입 필요), `3` = 하네스 오류.
