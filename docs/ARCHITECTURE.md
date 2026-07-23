# 아키텍처

## 제품 표면
**로컬-우선으로 실행되는 Next.js 15 앱.** 사용자 머신에서 돌며, 서버측(route handlers / server actions, Node 런타임)이 파일시스템 접근·Anthropic SDK 호출·로컬 툴체인 실행(vitest via `child_process`)을 담당한다. 클라이언트는 카탈로그 탐색·결합점 확인·diff 검토·검증 결과 표시만 한다. 외부 백엔드 없음.

## 디렉토리 구조
> 아래는 스캐폴딩의 목표 구조다. 착수 후 확정.
```
src/
├── app/                # Next.js App Router
│   ├── (ui)/           # 페이지: 카탈로그 / 이식 마법사 / diff·검증 결과
│   └── api/            # 서버측 라우트: repo 읽기, 엔진 호출, 검증 실행
├── components/         # UI 컴포넌트
├── lib/
│   ├── engine/         # EXTRACT / ABSTRACT / INSTANTIATE / VERIFY
│   ├── catalog/        # 패턴 파일 로드·직렬화 (포터블 포맷)
│   └── provenance/     # 소스 경로 resolve·검증 (환각 차단)
├── services/           # Anthropic SDK 래퍼, 로컬 툴체인 실행 래퍼(vitest)
└── types/              # 패턴 스키마 등 타입 정의
catalog/                # 손 큐레이션 씨앗 패턴 파일들 (repo에 동봉 = 커먼즈의 실재 형태)
```

## 패턴
- **서버측 엔진 우선**: 파일시스템·툴체인·LLM에 닿는 모든 것은 서버측(route handlers / server actions)에서만. 클라이언트 컴포넌트는 인터랙션(카탈로그 선택·diff 검토·승인)에만.
- **불신 격리(untrusted-as-data)**: 사용자 repo 내용은 **데이터로 격리**한다 — 프롬프트 지시로 취급 금지. (ADR 참조)
- **diff-미리보기-후-적용**: 생성 코드는 절대 즉시 쓰지 않는다. diff를 보이고 명시적 승인 후에만 적용. 실행은 **테스트 커맨드로만** 한정.
- **3단계 번역 엔진**: 패턴의 **스택-불변 원리**(본질)와 **스택-종속 구현**(결합점)을 분리하고, 구현만 교체한다.

## 데이터 흐름
```
[카탈로그 구축 — 오프라인/손 큐레이션]
  씨앗 repo ≥2  (소스 스택은 임의; 최소 하나는 타깃과 다른 스택)
    → EXTRACT   (파일 관찰 + provenance 부착)
    → ABSTRACT  (대조: 공통=본질 / 차이=결합점, tier[observed/corroborated] 판정)
    → 패턴 아티팩트  → catalog/ (포터블 파일, 5-구성요소 스키마)

[이식 — 사용자 세션]
  사용자: 카탈로그에서 corroborated 패턴 선택 + 타깃 repo 지정
    → 타깃 결합점 자동 탐지  (스택·스펙형식·테스트러너·게이트위치)
    → INSTANTIATE  (파라미터 결속 → repo-native 산출물 생성 [+ 왜 주석·provenance])
    → VERIFY       (양성: 준수→green  /  음성: 심은 위반→red 로 잡힘)   [로컬 vitest]
    → diff 미리보기 → 사용자 승인 → 타깃 repo에 적용
```
음성 검증이 위반을 red로 잡지 못하면 이식은 **실패**로 표면화한다(성공 위장 금지).

## 패턴 스키마 (카탈로그 파일의 형태)
하나의 패턴 = 다음 5요소 + tier:
| 요소 | 예 (Spec↔Verification 루프) | 본질/파라미터 |
|---|---|---|
| 의도(intent) | "스펙과 어긋난 코드의 병합을 막는다" | 본질 |
| 불변 구조(roles) | `[스펙 산출물]`→`[스펙에 결속된 검사]`→`[실패 시 차단 게이트]` | 본질 |
| 결합점(binding points) | 스펙 형식 / 검사 도구 / 게이트 위치 / 네이밍·경로 | 파라미터 |
| 출처(provenance) | 이 패턴을 보이는 실재 repo·파일 경로(들) | 메타데이터 |
| 판별 오라클(oracle) | "위반은 이렇게 생겼다; 올바른 이식은 이를 red로 거부해야 한다" | 검증 계약 |

**tier**: `observed`(N=1, tentative) → `corroborated`(N≥2, 대조검증). 생성은 `corroborated`만.

## 상태 관리
- **서버 상태**(카탈로그·추출·추상화·검증 결과)는 서버측에서 계산해 전달. 로컬-우선이라 원격 상태 저장소 없음.
- **클라이언트 상태**(패턴 선택·diff 검토·승인 여부)는 최소한의 로컬 상태(useState/useReducer)로.

## 보안·안전 (표적 수준)
- **provenance 강제**: 모든 추출·생성 결과는 resolve 가능한 실재 소스 경로를 달아야 한다. resolve 안 되면 폐기.
- **불신 격리**: repo 내용 = 데이터, 지시 아님.
- **개입 최소화**: 생성물은 diff 승인 후에만 적용, 실행은 테스트 커맨드로 한정.
> 엣지케이스·에러·보안의 전수 처리는 아키텍처 확정 전에는 하지 않는다(over-engineering 금지). 리스크는 위 표적 수준으로만.
