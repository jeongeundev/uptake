# UI 디자인 가이드

> ⚠️ UI는 아직 grilling으로 확정하지 않았다. 아래는 PRD의 "도구 미학 / 정직·서술적" 원칙에서 도출한 **잠정 출발점**이며, UI 작업 착수 시 재검토한다.

## 디자인 원칙
1. **도구처럼 보여야 한다** — 매일 쓰는 로컬 대시보드. 마케팅 페이지가 아니다.
2. **상태가 곧 UI다** — 화면의 무게중심은 VERIFY 결과(green 통과 / red 차단)와 diff. 색은 **의미**(통과 / 차단 / tentative / 출처)에만 쓴다.
3. **정직·투명** — 실패를 숨기지 않는다. red는 결함이 아니라 정보다. provenance(출처 경로)는 항상 보이고 클릭 가능하게.

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
| 통과 (VERIFY green, corroborated) | #22c55e |
| 차단/위반 (VERIFY red) | #ef4444 |
| tentative/emerging (`observed` tier) | #f59e0b |
| 중립/기본 | #525252 |

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
provenance 경로는 클릭 가능(neutral-400 → hover neutral-200).
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
