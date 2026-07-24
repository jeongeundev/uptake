# UI 디자인 가이드

> 이 문서는 phase 1 단일 페이지 UI의 확정 계약이다. 기존 엔진의 INSTANTIATE·VERIFY·승인·적용 계약을 사용자에게 정직하게 노출한다.

## 디자인 원칙
1. **도구처럼 보여야 한다** — 매일 쓰는 로컬 대시보드. 마케팅 페이지가 아니다.
2. **상태가 곧 UI다** — 화면의 무게중심은 VERIFY 결과(green 통과 / red 차단)와 diff. 색은 **의미**(통과 / 차단 / tentative / 출처)에만 쓴다.
3. **정직·투명** — 실패를 숨기지 않는다. red는 결함이 아니라 정보다. provenance(출처 경로)는 항상 로컬 근거 경로로 보이게 한다.

## 단일 페이지 흐름

wizard는 한 페이지에서 다음 순서로 진행한다.

1. 카탈로그에서 패턴을 고른다.
2. 사용자가 타깃 repo의 절대 경로를 입력한다.
3. 자동 탐지된 결합점과 근거 파일을 확인하고, `binding-unresolved`인 결합점만 직접 입력한다. 빈 값이 남아 있으면 다음 단계로 진행할 수 없다.
4. 생성물을 준비한 뒤 실행 명령을 확인한다.
5. VERIFY 결과와 생성 diff를 검토한다.
6. `awaiting-approval`일 때 명시적으로 승인하고 적용한다.

사용자가 패턴, 타깃 경로 또는 결합점 입력을 바꾸면 그 이후의 서버측 생성·검증·승인 상태를 폐기하고 다시 준비한다. 새로고침이나 서버 재시작 뒤 진행 상태는 복구하지 않으며 재검증·재승인이 필요하다.

## 카탈로그와 근거

각 패턴에는 `capability`, `evidenceStatus`, `generationEnabled`, `tradeoffs`와 provenance 경로를 함께 표시한다. provenance는 웹 링크처럼 꾸미지 않고 검증된 로컬 근거 경로 텍스트로 표시한다.

실제 source root가 없어 패턴이 하드 게이트에서 load 거부되면 빈 성공 화면을 보여주지 않는다. rejected reason인 `provenance-unresolved`를 표시해 사용자가 근거 부재와 빈 카탈로그를 구별할 수 있게 한다.

## 실행 직전 공개

`frozenArgv`는 shell 문자열로 합치지 않고 인자 경계를 보존한 목록으로 표시한다. 실행 버튼 바로 앞에 다음 세 항목을 함께 공개한다.

- `frozenArgv`의 각 인자
- cwd: 타깃 repo 밖의 임시 워크스페이스
- timeout

사용자가 **이식 실행**을 클릭하는 것이 공개된 명령 실행에 대한 승인이다. 결합점이나 생성물이 바뀌면 기존 공개 내용은 폐기하고 새 `frozenArgv`를 준비·표시한 뒤에만 실행한다.

## 생성물과 diff

생성물은 현재 엔진과 apply 계약 그대로 파일별 `add` operation으로 표시한다. 각 항목은 repo-상대 경로, 역할, 추가될 전체 내용을 포함한다. phase 1 UI는 기존 파일의 수정이나 삭제를 지원하거나 암시하지 않는다.

## VERIFY 상태

양성에서 gate test가 green이고 음성에서 같은 gate test가 red인 두 조건이 모두 성립해야만 전체 결과를 green으로 표시한다. `awaiting-approval`만 검증 성공이며 나머지 실행 결과는 모두 적용을 차단한다.

| 상태 | 사용자 문구 | 색/행동 |
|---|---|---|
| `awaiting-approval` | 양성 green과 음성 red가 확인되었습니다. 승인 대기 중입니다. | green, 승인 가능 |
| `positive-failed` | 준수 상태의 게이트가 통과하지 못했습니다. | red, 차단 |
| `injection-failed` | 판별 위반을 생성물에 심지 못했습니다. | red, 차단 |
| `gate-error` | 게이트가 판정 가능한 결과를 만들지 못했습니다. | red, 차단 |
| `negative-not-caught` | 게이트가 심은 위반을 잡지 못했습니다. | red, 차단 |
| `timeout` | 게이트 실행이 제한 시간을 초과했습니다. | red, 차단 |

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

## 색상
### 배경
| 용도 | 값 |
|------|------|
| 페이지 | #0a0a0a |
| 카드 | #141414 |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | text-white |
| 본문 | text-neutral-300 |
| 보조 | text-neutral-400 |
| 비활성 | text-neutral-500 |

### 데이터/시맨틱 색상
색은 오직 의미에만. 브랜드 장식으로 쓰지 않는다.
| 용도 | 값 |
|------|------|
| VERIFY 통과 | #22c55e |
| VERIFY 차단/위반 | #ef4444 |
| tentative (`evidenceStatus: observed`) | #f59e0b |
| 중립/기본 (`corroborated` 라벨 포함) | #525252 |

> **두 축은 색을 공유하지 않는다.** green/red는 **VERIFY 결과 전용**이다. `evidenceStatus`는 텍스트 라벨로 표시하고 `corroborated`에는 중립색을 쓴다 — 근거가 충분하다는 뜻일 뿐 검증을 통과했다는 뜻이 아니다. `observed`만 주의를 끌기 위해 앰버를 쓴다. `capability`(`generative`/`descriptive`) 역시 색이 아니라 라벨로 구분한다.

> ⚠️ **음성 검증에서 green은 실패다.** 게이트가 위반을 잡지 못한 것(`negative-not-caught`)이므로, 테스트 러너의 raw green을 그대로 green으로 칠하면 안 된다. 색은 러너의 출력이 아니라 **기대와의 일치 여부**를 따른다 — 양성 green = green, 음성 red = green, 음성 green = **red**.

## 컴포넌트
### 카드
```
rounded-lg bg-[#141414] border border-neutral-800 p-6
```

### 버튼
```
Primary: rounded-lg bg-white text-black hover:bg-neutral-200   (예: "적용", "이식 실행")
Text:    text-neutral-500 hover:text-neutral-300                 (보조 액션)
```

### 입력 필드
```
rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3
```

### diff / 코드 / provenance 경로
```
font-mono text-xs — diff, 생성 코드, 출처 파일 경로는 항상 모노스페이스로.
provenance 경로는 로컬 근거 경로 텍스트(neutral-400)로 표시한다.
```

## 레이아웃
- 전체 너비: max-w-5xl
- 정렬: 좌측 정렬 기본. 중앙 정렬 금지.
- 간격: gap-3~4, 섹션 간 space-y-8

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-4xl font-semibold text-white |
| 카드 제목 | text-sm font-medium text-neutral-400 |
| 본문 | text-sm text-neutral-300 leading-relaxed |
| 코드/경로/diff | font-mono text-xs |

## 애니메이션
- fade-in (0.4s), slide-up (0.5s) 만 허용.
- 그 외 모든 애니메이션 금지 (특히 글로우·펄스).

## 아이콘
- SVG 인라인, strokeWidth 1.5.
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.
