# HANDOFF — phase 2 완료 / phase 3 방향 전환 대기

> 이 문서는 새 세션이 현재 저장소 상태를 오해하지 않고 이어가기 위한 실행 계약이다. 이미 정본에 있는 요구사항·아키텍처·리뷰 상세를 반복하지 않고 경로로 참조한다.
>
> 기준 시각: 2026-07-26
> 현재 브랜치: `feat-2-authoring-pipeline` (main 미머지, 131 커밋)

## 1. 새 세션이 할 일

**phase 2는 끝났다. 구현을 이어가지 마라.** 다음 작업은 제품 방향 재정의이며, 아직 문서로 물질화되지 않았다 — 3절이 정본이다.

phase 3의 step 설계를 바로 시작하지 마라. PRD·ADR 재정의가 선행한다.

## 2. 현재 판정

phase 0(엔진 INSTANTIATE·VERIFY) · phase 1(UI/API/E2E) · phase 2(저작 파이프라인) 모두 완료.

검증 상태 (2026-07-26, 커밋 `0c66c68` 기준 실측):

| 검증 | 결과 |
|---|---|
| `npm test` | 184 passed / 31 files |
| `npm run lint` | clean |
| `npm run build` | 성공 |
| `python3 -m pytest scripts/` | 114 passed |
| `npm run test:e2e` | 3 passed (기본 2 + unresolved 1) |

remediation 이력은 `remediation/README.md`가 정본이다. 요약: `2-authoring-pipeline-final` 루프가 F-001(major, `draft-store` 계약 결함)로 Escalate했고, `/harness`의 `2-fix` phase가 초안을 `hashAuthoringRequest` fingerprint에 결속해 해결했다. `2-fix` 루프 판정 **Ready**(score 100, open findings 0).

**루프를 다시 열지 마라** — `$remediate feat-2-authoring-pipeline`은 이미 돌았다. 새 구현이 들어가기 전까지 재리뷰 대상이 없다.

## 3. phase 3 방향 — 제품 루트 재정의 (전제 검증 완료, 문서 재정의 대기)

phase 2까지의 제품은 **사용자가 intent(찾을 방법론)를 지정할 수 있다**는 전제 위에 서 있다. 이 전제가 타깃 사용자와 모순이라는 판단이 섰다 — 무엇을 찾을지 아는 사용자는 이미 도구가 필요 없다.

**결정: 단일 저장소의 개발 체계를 자동 발견·구조화하는 단계(SURVEY)를 제품의 루트로 올리고, 기존 카탈로그·이식 파이프라인을 그 분석 결과의 후속 소비자로 재배치한다.**

```
[신규] SURVEY   repo 1개 → 개발 체계 후보 N개 (각 후보 = intent 문자열 + 근거 경로)
                             ↓ 사용자가 고른다
[기존] EXTRACT → ABSTRACT → observed/descriptive 초안 → 승인 → 등재
[기존] (독립 근거 ≥2로 corroborated 승급) → INSTANTIATE → VERIFY
```

핵심은 **intent를 없애는 것이 아니라 자동 생성하는 것**이다. `extractEvidence` 이하 파이프라인은 그대로 재사용되며, 사용자의 역할이 "무엇을 찾을지 떠올리기"에서 "제시된 것 중 고르기"로 바뀐다.

### 지켜야 할 것

- SURVEY 산출물도 **후보**다. 확정은 기존 게이트(provenance resolve → 참조 무결성 → 사용자 승인)가 한다. 자동 발견을 켜도 환각 봉쇄 장치는 그대로 작동해야 한다.
- **이식·VERIFY는 격하가 아니다.** 순서상 뒤로 갈 뿐, 발견 결과의 유일한 품질 판정 장치다. "LLM이 이 repo는 X를 한다고 말했다"와 "그 X를 심었더니 위반이 red로 잡혔다" 사이의 거리가 uptake와 링크 모음집을 가르는 전부다.
- `AGENTS.md`의 CRITICAL 규칙은 하나도 완화되지 않는다. SURVEY에도 전부 적용된다.

### 전제는 검증됐다 — 스파이크 결과

이 방향은 "repo를 주면 LLM이 개발 체계를 쓸 만한 해상도의 후보로 뽑아낸다"는 가정 위에 선다.
버리는 프로토타입으로 세 저장소에서 확인했고 **가정은 확정됐다.**

> 브랜치 [`proto-survey-spike`](https://github.com/jeongeundev/uptake/tree/proto-survey-spike) —
> 전체 기록은 `proto/survey-findings.md`, 코드는 `src/lib/engine/survey.prototype.mts`,
> 후보 원본은 `proto/survey-candidates*.json`.
> **main에 병합하지 않는다.** 검증된 결정만 phase 3 설계로 흡수한다.

| | uptake | tech-blog | pytest |
|---|---|---|---|
| 성격 | 방법론이 문서로 명시된 곳 | 문서 0 · 지침 0 (하한선) | 낯선 대형 OSS (652파일) |
| 재료 | 28파일 / 43K tok | 7파일 / 2.8K tok | 76파일 / 67K tok |
| 후보 | 9건 | 4건 | 13건 |
| provenance | 60/60 | 12/12 | 87/87 |
| 환각 | 0건 | 0건 | 0건 |
| confidence | high 6 / med 3 | high 1 / med 1 / **low 2** | high 12 / med 1 |

후보 수는 재료 규모에, confidence는 재료 품질에 비례했다. 세 번 모두 확신이 부족한 지점에
**자기 반증**을 붙였다("이 workflow는 템플릿 상속일 수 있어 실제 관행이 아닐 수 있다").
사전 지식 오염도 배제된다 — pytest에서 가장 특이한 후보의 근거가 최근 추가된 AI/LLM 기여
정책이었다.

### 검증에서 확정된 설계 제약

**1. 병목은 LLM이 아니라 수집 규칙이다.** 세 실험에서 발견된 결함이 전부 수집 쪽이었다.

| 결함 | 놓친 것 |
|---|---|
| `automation` 규칙 부재 | `execute.py`·`remediate.py` — 최종 후보 9건 중 5건의 근거 |
| 문서 규칙이 `.md`만 인식 | `CONTRIBUTING.rst`, `doc/` 전체 (생태계 편향) |
| 한 카테고리가 예산 독식 | `.pre-commit-config.yaml`, `tox.ini` (규모 대응) |

세 번 다 규칙을 고치자 결과가 살아났다. `docs/PRD.md`의 "하드코딩 없는 범용 분석 파이프라인"과의
긴장은 이렇게 해소한다 — **"어디를 볼까"는 결정적 수집 규칙, "그것이 무슨 방법론인가"는 LLM.**
수집 규칙은 코드가 아니라 **생태계별로 확장 가능한 데이터**여야 한다. 카테고리별 예산 배분
(라운드로빈)도 필수다.

**2. 프롬프트가 해상도를 만든다.** `discipline` 필드에 "Uses TDD is useless; …is useful"이라는
지시를 넣은 것이 849~1392자짜리 구체적 서술을 만들었다. 이 지시가 없을 때의 결과는 미검증이지만,
이것이 링크 모음집과 갈리는 지점이다.

**3. 자생 vs 상속 축이 필요하다.** tech-blog는 4건 중 3건이 템플릿(`tailwind-nextjs-starter-blog`)
상속이었고 저장소 소유자는 "개발 방법을 의식한 적 없다"고 진술했다. pytest 13건은 전부 자생이다.
**SURVEY는 "존재하는 규율"을 찾지 "채택된 규율"을 찾지 않는다** — 남의 저장소를 분석했을 때
보일러플레이트를 "그 팀의 방법론"으로 제시하면 사용자는 잘못된 것을 배운다. `capability`·
`evidenceStatus`와 직교하는 축이며, 구분 신호(git 히스토리·커스터마이징 흔적)는 미검증이다.

### 착수 전 선행 작업 (문서 재정의)

| 위치 | 현재 | 바꿀 것 |
|---|---|---|
| `docs/PRD.md` 사용자 | "이식하고 싶은 개발자" | "자기 repo/관심 repo의 개발 체계를 알고 싶은 개발자". 이식은 후속 단계 |
| `docs/PRD.md` 핵심 기능 | 발견 → 추상화 → 이식·검증 (발견 = 손 큐레이션) | 발견이 SURVEY가 됨. 세 기능의 위계 재정의 |
| `docs/PRD.md` MVP 제외 | 개방형 발견 = E2 비전 | 본선 승격 (스파이크로 실현 가능성 확인됨) |
| `docs/PRD.md` MVP 제외 | Discovery 시나리오 = "MVP 이후 별도 트랙" | 로드맵 편입 |
| `docs/ADR.md` | — | ADR-017: intent를 사용자 입력에서 SURVEY 제안으로 |
| `docs/ADR.md` | — | ADR-018: 수집 규칙을 확장 가능한 데이터로 (근거 = 위 제약 1) |
| `docs/ADR.md` | — | ADR-019: 자생/상속 축 도입 여부 (근거 = 위 제약 3) |

### 스파이크가 남긴 미검증

- 각 대상 1회씩 — 재현·변동폭 미측정
- recall은 uptake에서만 측정 가능했다(정답지가 있는 유일한 대상)
- 상속 구분 신호는 아이디어일 뿐
- 모노레포, 문서가 위키에만 있는 저장소, 비영어권 저장소 미검증

## 4. 완료된 제품 표면

```text
[이식]  catalog → target 적격성 → binding 탐지/입력 → generated add diff + frozen argv/cwd/timeout 사전 표시
        → positive/negative VERIFY → 서버측 승인 → apply

[저작]  소스 repo ≥1 + intent → 파일 후보 제안(LLM) → provenance resolve 폐기 → 대조(공통=role/차이=binding)
        → corroboration 계산·강등 → oracle 초안 + 자기검증 → 초안 검토 → 승인 → 스테이징 검증 후 원자적 등재
```

핵심 위치:

| 대상 | 경로 | 비고 |
|---|---|---|
| 이식 UI | `src/components/catalog-bindings-wizard.tsx` | phase 1 확정 계약 — 재구조화 금지 |
| 저작 UI | `src/components/authoring-wizard.tsx` | |
| Route Handlers | `src/app/api/` | `workflows/`(이식) · `authoring/`(저작) |
| 저작 엔진 | `src/lib/engine/extract.ts`, `abstract.ts` | SURVEY가 붙을 지점 |
| proposer 포트 | `src/services/proposer.ts` | 불신 데이터 경계 `untrustedBlock` 포함 |
| proposer 구현 | `proposer-stub.ts`(결정적) · `proposer-anthropic.ts`(실제) | 스텁은 명시적 env로만 활성 |
| 초안 저장소 | `src/services/draft-store.ts` | 입력 fingerprint 결속 — `2-fix`의 성과, 되돌리지 마라 |
| VERIFY/log | `src/lib/engine/verify.ts`, `src/services/gate-runner.ts` | |
| 브라우저 E2E | `e2e/` | 회귀 방지 증거 — 수정해서 통과시키지 마라 |
| 확정 UI 계약 | `docs/UI_GUIDE.md` | |

카탈로그 실물은 씨앗 1건뿐이다 — `catalog/spec-change-declaration-gate.json` (`generative` · `corroborated` · sources: backendai, pytest). **카탈로그를 넓게 채우는 것이 세 기능 전부의 전제다.**

## 5. 워크플로우 규약

- 구현 phase: `/harness`로 step 설계 → `python3 scripts/execute.py <phase-dir>`
- 리뷰: phase 구현이 **전부 끝난 뒤** `$remediate <loop-id>` 한 번. **step 단위 루프를 만들지 마라** — phase 2에서 루프가 7개로 갈라진 사고의 원인이다(`remediation/README.md`).
- 자기채점 리뷰는 계약상 무효다(ADR-008). 구현 세션이 스스로 remediation 루프를 열지 않는다.
- 에러 복구: `phases/<phase>/index.json`에서 해당 step의 `status`를 `"pending"`으로 되돌리고 `error_message`를 삭제한 뒤 재실행.
