# 아키텍처

## 제품 표면
**로컬-우선. 워크플로우의 정본은 CLI 명령과 디스크 산출물이다(phase 4·ADR-020).** 사용자는 `uptake init` → `survey` → `author` → `verify` → `apply` 다섯 단계를 실행하고, 각 단계는 `.uptake/runs/<id>/` 아래에 산출물을 남기며 다음 단계가 그것을 읽는다. 프로세스 경계를 넘어 재개되고, 중간 상태가 사람이 읽고 리뷰할 수 있는 파일로 남는다.

**Next.js 15 앱은 두 번째 표면이다.** phase 1~3에서 만든 노출 계층은 Node 런타임의 **Route Handler**이며, Route Handler가 파일시스템 접근·Anthropic SDK 호출·로컬 툴체인 실행(vitest via `child_process`)을 서버측 엔진에 위임한다. 클라이언트는 카탈로그 탐색·결합점 확인·diff 검토·검증 결과 표시만 한다. 외부 백엔드 없음.

**두 표면은 같은 엔진을 쓴다.** 엔진 함수는 인자만 받는 순수 함수이므로(유일한 예외였던 `applyGenerated`는 phase 5에서 해소 · ADR-022) CLI가 HTTP를 거치지 않고 직접 호출한다. 세션 쿠키·인메모리 workflow 저장소는 **웹 표면만의 관심사**다. 웹을 산출물 기반으로 옮기는 것은 후속이며, 그때까지 두 표면의 진행 상태는 공유되지 않는다.

## 디렉토리 구조
> 아래는 스캐폴딩의 목표 구조다. 착수 후 확정.
```
bin/uptake.ts           # CLI 진입 — 명령 디스패치·종료 코드 (phase 4)
                        #   확장자는 `.ts`다 — tsconfig의 include가 `**/*.ts`뿐이라
                        #   `.mts`는 `npm run build`의 타입체크 밖으로 빠진다
src/
├── workflow/           # 워크플로우 층 (phase 4) — 아래 '워크플로우 산출물 계약' 참조
│   ├── paths.ts        # run 디렉터리 해석 · current 포인터
│   ├── artifacts.ts    # 산출물 읽기/쓰기 + 스키마 검증
│   ├── prerequisites.ts# 단계별 선행조건 (3-상태 판정)
│   └── steps/          # init · survey · author · verify · apply
├── app/                # Next.js App Router (두 번째 표면)
│   ├── (ui)/           # 페이지: 카탈로그 / 이식 마법사 / diff·검증 결과
│   └── api/            # 서버측 라우트: repo 읽기, 엔진 호출, 검증 실행
├── components/         # UI 컴포넌트
├── lib/
│   ├── engine/         # INSTANTIATE / VERIFY · EXTRACT / ABSTRACT (phase 2) · SURVEY (phase 3) — 아래 계약 참조
│   ├── catalog/        # 패턴 파일 로드·직렬화 (포터블 포맷)
│   └── provenance/     # 소스 경로 resolve·검증 (환각 차단)
├── services/           # Anthropic SDK 래퍼, 로컬 툴체인 실행 래퍼(vitest)
└── types/              # 패턴 스키마 등 타입 정의
templates/              # init이 복사하는 원본 (METHOD.md)
catalog/                # 손 큐레이션 씨앗 패턴 파일들 (repo에 동봉 = 커먼즈의 실재 형태)
survey-rules.json       # SURVEY 수집 규칙 (repo에 동봉된 데이터 — 코드가 아니다 · ADR-018)
```
`templates/`·`catalog/`·`survey-rules.json`·자기검증 fixture는 **패키지 동봉 자산**이며 설치 위치 기준으로 해석한다. 사용자 저장소로 복사하지 않는다(ADR-024 · 아래 '자산 경로 계약').

**사용자 저장소에 놓이는 것** (phase 4부터):
```
.uptake/
├── METHOD.md           # 원칙 + 단계 체인. 설명이며 집행 주체가 아니다 (편집해도 게이트 불변)
├── runs/
│   ├── current         # 현재 run 디렉터리명 한 줄 — 사람이 고쳐 쓰는 인터페이스
│   └── 001-<repo-slug>/
│       ├── survey.json         # 성공/실패 무관 항상 기록
│       ├── authoring.json      # 성공/실패 무관 항상 기록 (성공 시 pattern 포함)
│       ├── bindings.json       # phase 5
│       ├── generated.json      # phase 5 — 검증된 정확한 생성물
│       ├── verify.json         # phase 5
│       ├── apply.json          # phase 5
│       └── logs/{positive,negative}.log
└── sources/            # 씨앗·근거 저장소 (기존 그대로 · gitignore)
```
**단계당 상태 파일은 하나다.** 한 단계의 상태를 두 파일이 주장하면 어긋날 수 있는 두 번째 기록이 생긴다 — 릴레이를 파일로 내린 이유가 상태가 여러 곳에 사는 것을 없애려는 것이었다. 단계가 파일을 여럿 쓰는 것(`verify`의 `generated.json`·`logs/`)은 무방하되, **`status`를 싣는 파일은 단계당 하나**이고 판정은 그것만 본다. 설정 파일과 실행 원장은 두지 않는다 — 설정은 `인자 > 환경변수 > 기본값`으로 해결되고, "무엇을 언제 시도했는가"는 각 단계 상태 파일에 이미 있다.
`runs/`를 커밋하면 방법론 도입 과정이 리뷰 가능한 diff가 된다 — 커밋 여부는 사용자가 정하고 `init`은 `.gitignore` 제안만 한다(`logs/`는 제외 권장).

## 패턴
- **서버측 엔진 우선**: 파일시스템·툴체인·LLM에 닿는 모든 것은 서버측(route handlers / server actions)에서만. 클라이언트 컴포넌트는 인터랙션(카탈로그 선택·diff 검토·승인)에만.
- **불신 격리(untrusted-as-data)**: 사용자 repo 내용은 **데이터로 격리**한다 — 프롬프트 지시로 취급 금지. (ADR 참조)
- **diff-미리보기-후-적용**: 생성 코드는 절대 즉시 쓰지 않는다. diff를 보이고 명시적 승인 후에만 적용. 실행은 **테스트 커맨드로만** 한정.
- **3단계 번역 엔진**: 패턴의 **스택-불변 원리**(본질)와 **스택-종속 구현**(결합점)을 분리하고, 구현만 교체한다.

## 데이터 흐름
```
[발견 — phase 3: SURVEY]
  사용자: 저장소 1개만 지정  (intent는 입력이 아니라 산출)
    → 결정적 수집  (확장 가능한 규칙이 "어디를 볼까"를 정함 + 카테고리별 예산 배분)
    → 후보 제안   (LLM: 개발 체계 후보 = intent 서술 + 근거 경로)
    → provenance resolve 폐기 → 사용자 선택 → observed/descriptive 등재

[카탈로그 저작 — MVP: 오프라인 손 큐레이션 / phase 2: 앱 내 대상 지정 추출]
  씨앗 repo ≥2  (소스 스택은 임의; 최소 하나는 타깃과 다른 스택)
    → EXTRACT   (파일 관찰 + provenance 부착)
    → ABSTRACT  (대조: 공통=본질 / 차이=결합점, evidenceStatus[observed/corroborated] 판정)
    → 패턴 아티팩트  → catalog/ (포터블 파일, 5-구성요소 스키마)

[이식 — 사용자 세션]
  사용자: 카탈로그에서 corroborated 패턴 선택 + 타깃 repo 지정
    → 타깃 결합점 자동 탐지  (스택·스펙형식·테스트러너·게이트위치)
    → INSTANTIATE  (파라미터 결속 → repo-native 산출물 생성 [+ 왜 주석·provenance])
    → VERIFY       (양성: 준수→green  /  음성: 심은 위반→red 로 잡힘)   [로컬 vitest]
    → diff 미리보기 → 사용자 승인 → 타깃 repo에 적용
```
음성 검증이 위반을 red로 잡지 못하면 이식은 **실패**로 표면화한다(성공 위장 금지).

**EXTRACT·ABSTRACT는 MVP 앱의 런타임 기능이 아니었다 — phase 2에서 앱 기능이 된다.** MVP에선 위 흐름의 첫 블록이 오프라인 손 큐레이션 절차였고, 산출물인 패턴 JSON이 `catalog/`에 동봉된 채로 제품에 들어왔다. 앱이 구현한 것은 **INSTANTIATE와 VERIFY**뿐이었다. **phase 2는 대상 지정 추출로 그 첫 블록을 앱 안에 들인다** — 사용자가 소스 저장소 ≥2개와 추출할 방법론을 지정하면 앱이 근거를 수집·대조해 초안을 만들고, 승인 후에만 `catalog/`에 기록한다(아래 'EXTRACT·ABSTRACT 저작 계약'). ABSTRACT가 프로젝트의 핵심 가치라는 것(ADR-004)을 이제 앱이 실제로 수행한다.

**개방형 발견은 더 이상 E2 비전이 아니다 — phase 3에서 SURVEY로 본선 승격됐다(ADR-017).** phase 2까지는 사용자가 "무엇을 추출할지"를 지정해야 했고 ADR-014가 개방형을 E2로 미뤄뒀으나, 그 전제가 타깃 사용자와 모순된다는 판단으로 폐기됐다 — intent를 지정할 수 있는 사용자는 이미 도구가 필요 없다. phase 3는 저장소 하나만 받아 후보를 제안하는 **SURVEY**를 흐름의 맨 앞에 놓고, 기존 EXTRACT·ABSTRACT는 그 결과를 소비한다(아래 'SURVEY 계약').

**phase 4는 이 흐름 전체를 다섯 개의 명령과 디스크 산출물로 물질화한다(ADR-020).** 위 세 블록은 기능으로는 존재했으나 서로를 몰랐다 — 각 위저드가 인메모리 저장소에 살아 프로세스가 죽으면 사라지고, 앞 블록의 산출물을 뒤 블록이 읽는 경로가 없었다. phase 4·5는 각 단계가 산출물을 파일로 남기고 다음 단계가 그것을 입력으로 소비하게 한다(아래 '워크플로우 산출물 계약').

## 워크플로우 산출물 계약 (phase 4·5)
방법론을 **실행 가능한 워크플로우로 배포**하는 계약이다(ADR-020). 새 기능이 아니라 기존 엔진 위에 얹는 **명령 표면 · 산출물 영속화 · 선행조건 검사** 세 층이다.

**단계와 릴레이.**

| 명령 | 읽기 | 성공 산출물 | 항상 쓰는 것 |
|---|---|---|---|
| `init` | — | `METHOD.md` | — |
| `survey <repository>` | 동봉 수집 규칙 · 소스@HEAD | `survey.json` (status=`surveyed`) | `survey.json` |
| `author --candidate <id>` | `survey.json` | `authoring.json` (status=`drafted` · `pattern` 포함) | `authoring.json` |
| `verify --target <abs>` | `authoring.json`의 `pattern` · 타깃 | `generated.json` · `verify.json` (status=`verified`) | `bindings.json` · `verify.json` · `logs/` |
| `apply` | `generated.json` · `bindings.json` · `verify.json` | 타깃 파일 · `apply.json` | `apply.json` |

`author`에는 **두 번째 소스 옵션이 없다** — CLI는 SURVEY 채택 경로만 태우고 채택 산출물은 항상 `descriptive`/`observed`다. 대조 저작과 `generative` 승격은 후속 phase다(ADR-023).

**`author`는 카탈로그에 등재하지 않는다.** 위 표를 보면 등재된 카탈로그를 **되읽는 행이 없다** — `verify`는 앞 단계 산출물을 읽는다. 아무도 소비하지 않는 산출물은 릴레이의 일부가 아니므로, 등재는 카탈로그를 실제로 읽는 단계와 함께 설계한다. 그 대신 **소비 시점에 층 1 하드 게이트를 건다**(ADR-025 · 아래 '층 1 재검증').

각 명령은 인자 없이 `runs/current`가 가리키는 run에서 앞 단계 산출물을 찾는다. **프로세스 경계를 넘어 재개된다** — 중단 후 같은 명령을 다시 치면 이어진다.

**run은 `survey`가 만든다.** `survey <repository>`는 인자를 받는 유일한 조사 명령이고, 실행할 때마다 **새 run 디렉터리를 만들고 `current`를 갱신한다** — 같은 저장소를 다시 조사해도 앞 run을 덮어쓰지 않는다. 조사는 revision을 새로 고정하는 행위이므로 재개가 아니라 새 작업이다. 위의 "재개된다"는 `author` 이후 단계의 성질이며, 그 단계들은 `current`가 가리키는 run만 읽는다.

**여러 run 중 다른 것을 고르려면 `current`를 고쳐 쓴다.** `runs/current`는 디렉터리명 한 줄짜리 파일이고, **사람이 고치라고 만든 인터페이스**다 — 조사를 여러 번 해보고 그중 하나를 채택하는 것은 SURVEY 사용자의 정상 행동이며(ADR-017: 사용자는 제시된 것 중 고른다), 그 선택을 명령 옵션으로 만들면 "각 명령은 인자 없이 앞 단계를 찾는다"는 릴레이 계약에 예외가 생긴다. phase 5의 "**산출물 직접 편집은 공식 경로가 아니다**"는 **승인·검증 산출물에 한정**된다 — 그쪽은 무엇에 동의했는지를 고정한 기록이라 편집이 곧 우회지만, `current`는 어느 run을 볼지 가리키는 포인터일 뿐이고 가리켜진 run은 자기 게이트를 그대로 통과해야 한다.

**3-상태 모델.** 산출물 타입은 이미 판별 유니온이고 실패 진단을 싣고 있으므로, **엔진이 반환한 것을 그대로 직렬화한다.** 새 상태 타입을 만들지 않는다.

| 상태 | 디스크 | 판정 |
|---|---|---|
| 미실행 | 파일 부재 | 선행조건 미충족 |
| 실행·실패 | 파일 존재 + `status` ∈ 실패 집합 | 선행조건 미충족 (사유를 그대로 보인다) |
| 실행·성공 | 파일 존재 + `status` ∈ 성공 집합 | 다음 단계 진행 |

**게이트 실패도 산출물을 남긴다.** 다음 단계가 소비할 성공 산출물만 만들지 않으며, 실패 코드·폐기 근거·고정 revision은 기록한다 — "실행하지 않은 상태"와 "실행했지만 실패한 상태"를 디스크에서 구분할 수 있어야 한다. `no-candidate`가 이미 `repository`·`revision`·`collected`·`skipped`·`discardedEvidence`·`discardedCandidates`를 반환하므로 그대로 쓴다. **로그 파일은 항상 남긴다** — `gate-error`·`timeout`의 원인은 리포터 출력에만 있고, 그것이 사라지면 인프라 오류와 진짜 red를 구별할 수 없다.

**revision이 고정된 뒤의 실패는 예외 없이 revision을 싣는다.** 지금 `no-signal`은 revision을 이미 알면서도 `detail`만 반환한다 — 그 상태로 직렬화하면 "무엇을 조사했는지 모르는 실패 기록"이 남아 재현이 끊긴다. 반환 형태를 넓혀 revision(그리고 이미 확정된 `collected`·`skipped`)을 함께 싣는다. **새 상태를 만드는 것이 아니라 기존 실패 분기에 필드를 더하는 것**이며, 위의 "엔진이 반환한 것을 그대로 직렬화한다"는 원칙은 유지된다. revision을 고정하기 **전**에 끝난 실패(`repository-unresolved`·`revision-unpinnable`)에는 실을 revision이 없고, 그것이 곧 진단이다.

**성공 판별자는 한 파일에만 있다.** 단계마다 `status`를 싣는 상태 파일이 하나뿐이므로(`survey.json`·`authoring.json`·`verify.json`) 판정은 그 파일의 `status` 하나로 끝난다. 성공 시에만 생기는 **별도의 파일**을 성공 판별자로 삼지 않는다 — 그러면 "`status`는 성공인데 그 파일이 없다"는 상태(쓰기 중단·부분 실패)가 가능해지고, 선행조건 검사가 무엇을 믿을지 정할 수 없게 된다. 크지 않은 산출은 상태 파일 안의 필드로 담고(`authoring.json`의 `pattern`), 따로 두는 것은 부피가 큰 내용뿐이다(`generated.json`·`logs/`) — 그것들은 판별자가 아니라 상태 파일이 성공일 때 함께 있어야 하는 내용이다.

**종료 코드.** `0` 성공 · `1` 게이트 실패(작업이 틀렸다) · `2` 실행 전제 미충족 · `3` 인프라 오류. 하네스 실행기(`scripts/execute.py`)의 분류 원칙과 같다 — 인프라 오류를 결과로 계산하지 않는다.

**exit 2가 워크플로우를 가르친다.** `2`의 실체는 "**지금 이 명령을 실행할 수 없고, 대신 무엇을 해야 하는지 알려준다**"이다. 선행 산출물이 없거나 실패 상태인 것(순서 위반)이 그 대표형이고, **아직 배포되지 않은 명령을 친 것**도 같은 부류다. 어느 쪽이든 실행하지 않고 다음에 칠 것을 출력한다. 워크플로우를 문서가 아니라 명령이 가르치는 지점이다.

**미구현 단계의 표현.** `METHOD.md`는 **다섯 단계를 다 적되 현재 배포된 명령을 밝힌다** — 방법론 문서이지 구현 현황 문서가 아니므로 체인을 잘라내지 않는다. 반대로 **CLI는 아직 없는 명령의 이름을 알지 않는다**: 아는 명령 외에는 전부 unknown으로 처리해 사용 가능한 명령 목록을 출력하고 `exit 2`로 나간다. 미래 명령의 이름과 인자를 코드에 박아두면 시그니처가 바뀔 때 죽은 문자열이 남고, 구현되지 않은 단계를 코드가 미리 아는 형태가 된다. 마지막 배포 단계의 성공 메시지는 다음 명령 대신 **"여기까지가 현재 배포된 워크플로우"**를 말한다.

**CLI 호출 규약.** phase 4의 진입점은 `bin/uptake.ts`이고 `npx tsx bin/uptake.ts <command>`로 호출한다. 배포·번들링(`npm link`·`bin` 필드·바이너리)은 phase 4 비범위이므로, 통합 테스트도 이 형태로 **별개 프로세스를 띄운다**. 진입 파일 확장자를 `.ts`로 두는 것은 취향이 아니다 — tsconfig의 `include`가 `**/*.ts`뿐이라 `.mts`는 `npm run build`의 타입체크에 포함되지 않고, 그러면 CLI 전체가 게이트 밖에서 green으로 통과한다.

**cwd가 저장소 밖이면 `--tsconfig`가 필요하다.** `tsx`는 `@/*` 경로 별칭을 진입 파일의 위치가 아니라 **`cwd`에서부터 올라가며 찾은 `tsconfig.json`** 기준으로 해석한다(내부적으로 `TSX_TSCONFIG_PATH` 환경변수가 없으면 `process.cwd()`를 기본값으로 쓴다). 사용자의 프로젝트 디렉터리에서 실행하면 그 탐색이 uptake의 `tsconfig.json`을 찾지 못해 `@/...` import가 전부 `MODULE_NOT_FOUND`로 깨진다 — `.uptake/`를 프로젝트 루트에 쓰는 계약(위 '경로가 분리된다')과는 별개로, **모듈 해석 자체가 cwd에 매여 있다.** 그래서 실제 호출은 `npx tsx --tsconfig <uptake-repo>/tsconfig.json bin/uptake.ts <command>`이고, 통합 테스트도 이 플래그로 uptake 저장소 밖 cwd에서 실행됨을 검증한다(`--tsconfig`는 `tsx`가 제공하는 표준 플래그이며 uptake가 만든 것이 아니다).

### 층 1 재검증 (ADR-025)
웹에서 이식 대상 패턴은 **언제나 `loadCatalog`를 통과해서** 들어온다(`workflow-store.ts`) — `instantiate`·`verify`는 provenance를 재검증하지 않으므로, 층 1 하드 게이트의 보증은 전적으로 카탈로그 로드가 지고 있다. CLI는 카탈로그를 거치지 않으므로 그 보증이 다른 곳에서 와야 한다.

**산출물에서 패턴을 읽는 단계가 소비 직전에 `validatePatternValue`를 건다.** 웹의 `loadCatalog`가 부르는 바로 그 함수이며, 통과하지 못하면 그 단계가 실패한다. 산출물을 **쓰는** 단계의 의무는 하나뿐이다 — 그 함수가 그대로 먹는 형태로 직렬화할 것.

- **편집을 탐지하지 않는다.** 해시·fingerprint로 산출물 변조를 잡는 방식은 (1) 원래 내용이 잘못이었던 경우를 못 잡고, (2) 산출물을 사람이 읽고 고칠 수 있다는 ADR-020의 전제와 싸운다. 묻는 것을 "누가 고쳤는가"에서 "**지금 이 내용이 게이트를 통과하는가**"로 옮기면 둘 다 성립한다.
- **웹의 draft fingerprint 결속과 역할이 다르다.** 웹의 `requestFingerprint`(`draft-store`)는 HTTP 세션이 사람의 의사를 대신 주장하는 구간에서 입력↔초안 불일치를 막는 장치다. CLI에는 그 구간이 없다.
- 검증·적용 산출물의 해시 3중 대조(아래 phase 5)는 이것과 별개다 — 그쪽은 "무엇에 동의했는지"를 고정하는 장치이고, 이쪽은 "근거가 실재하는지"를 확인하는 장치다.

### 자산 경로 계약 (ADR-024)
경로는 **두 종류뿐이며 기준이 다르다.** 하나로 뭉치면 명령이 uptake 저장소 밖에서 도는 순간 깨진다.

| 종류 | 대상 | 해석 기준 |
|---|---|---|
| 패키지 동봉 자산 | `survey-rules.json` · 씨앗 `catalog/` · `templates/` · 자기검증 fixture | **설치 위치** |
| 사용자 상태 | `.uptake/`(`METHOD.md`·`runs/`·`sources/`) | **프로젝트 루트** (실행 시 작업 디렉터리) |

**적용은 그 자산을 실제로 읽는 코드 경로가 생길 때 한다.** 읽지 않는 자산의 경로를 미리 고치면 그것이 옳은지 검증할 실행이 없다. phase 4가 둘(`survey-rules.json`·`templates/METHOD.md`), phase 5가 하나(vitest 바이너리)를 다룬다.

| 자산 | 언제 읽는가 | 해법 |
|---|---|---|
| `survey-rules.json` | `survey`(phase 4) | **모듈 import** — 경로 해석 자체를 없앤다 |
| `templates/METHOD.md` | `init`(phase 4) | 설치 위치 해석 (`init` 전용) |
| vitest 바이너리 | `verify`의 게이트 실행(phase 5) | 설치 위치 해석 (`process.getBuiltinModule("module").createRequire`) |
| 씨앗 `catalog/` | 아니오 (CLI는 카탈로그를 읽지 않는다) | 유예 |
| 자기검증 fixture | 아니오 (`generative` 전용 · ADR-023) | 유예 |

- **`survey-rules.json`은 모듈로 import한다.** 이 파일은 CLI와 웹이 **둘 다** 읽는데, 웹은 Next가 서버 코드를 번들하므로 `import.meta.url` 기준 해석이 출력 청크 위치를 가리킬 위험이 있다(이 저장소엔 `next.config.*`가 없어 파일 추적 보정 수단도 없다). 모듈 import는 두 표면에서 동일하게 동작하고 경로가 개입하지 않는다. 파일은 저장소에 그대로 남고 `UPTAKE_SURVEY_RULES` 오버라이드는 fs 읽기로 유지되므로 ADR-018의 "확장 가능한 데이터"는 보존된다.
- **`init`의 `templates/` 복사는 명시적 예외다.** 복사를 금지하는 이유는 사본과 원본이 갈라져 **게이트 동작이 사본마다 달라지는 것**을 막기 위해서인데, `METHOD.md`는 편집해도 게이트가 바뀌지 않는 설명 문서다(아래 'METHOD.md의 지위'). 갈라져도 무해하므로 복사한다. 갈라지면 안 되는 것은 판정에 쓰이는 자산(수집 규칙·씨앗 패턴·fixture)이다.
- **설정 우선순위는 `명시 인자 > 환경변수 > 기본값`이다.** 설정 파일은 두지 않는다 — 지금 기본값 아닌 값이 필요한 시나리오가 없고, 아무것도 결정하지 않는 설정 통로는 어긋날 수 있는 두 번째 경로만 만든다. 기존 `UPTAKE_SOURCE_ROOT`·`UPTAKE_SURVEY_RULES` 등은 중간 단으로 남으며 폐기하지 않는다.
- **씨앗 소스(`.uptake/sources/`)는 이 계약이 해결하지 않는다.** `init`은 네트워크에 나가지 않으므로 근거 저장소를 받아오지 못하고, 없으면 그 패턴은 `provenance-unresolved`로 거부된다 — 정상 동작이다. `METHOD.md`가 무엇을 왜 받아야 하는지 설명한다.

**`METHOD.md`의 지위.** 원칙(provenance·서술적 태도·양성/음성·불신 격리·2층 게이트·직교 2축·자생/상속 한계)과 **다섯 단계 체인**을 담고, 그중 현재 배포된 명령을 밝힌다. **설명 문서이며 집행 주체가 아니다** — 편집해도 게이트는 바뀌지 않고 게이트의 정본은 코드다. 파일 첫 줄에 그 사실을 못박는다. 각 원칙에는 집행 게이트의 **상태 이름**만 붙인다(`negative-not-caught`·`provenance-unresolved` 등). `file:line`은 쓰지 않는다 — 라인 드리프트로 죽은 참조가 된다. Spec Kit의 `constitution.md`와 이름을 달리한 이유가 이것이다: 거기서는 사용자가 작성·개정하는 문서지만, uptake의 원칙은 제품이 집행하는 불변식이다.

**revision 고정.** `survey`가 개시 시점 HEAD SHA를 한 번 고정하면 이후 단계는 HEAD를 다시 읽지 않는다. 실패는 근거를 실제로 읽을 수 없을 때만 일어난다 — 커밋 객체 해석 불가는 `revision-unresolvable`, 경로 읽기 불가는 `provenance-unresolvable`. HEAD 이동은 실패 사유가 아니다(ADR-021).

**phase 4에는 승인 경계가 없다.** `author`는 카탈로그에 등재하지 않고 run 디렉터리 안에 산출물만 쓰므로, 사용자 저장소의 다른 곳이나 타깃 저장소를 바꾸지 않는다 — 동의를 받을 대상이 없다. 웹 표면의 draft → approve → register 3단계는 **HTTP 세션이 사람의 의사를 대신 주장하기 때문에** 필요한 구조이고, CLI에는 그 간극이 없다. 승인이 필요해지는 지점은 타깃 저장소를 바꾸는 `apply`이며 그것은 TTY 대화형이다(아래 phase 5 · ADR-022). **등재를 CLI에 붙일 때 웹의 인메모리 draft 저장소에 승인을 심지 마라** — 등재 엔진(`registerPattern`)은 이미 인자만 받는 순수 함수다.

**verify → apply 결속 (phase 5).** `verify`가 instantiate한 **정확한 파일들**을 `generated.json`에 고정하고, `apply`는 **다시 생성하지 않고** 그 파일을 읽어 적용한다. 세 해시를 검증 시점에 고정하고 적용 직전 재계산해 대조한다.

| 해시 | 대상 | 잡는 사고 |
|---|---|---|
| `contentHash` | `generated.json`의 files | 검증 후 생성물 변조 |
| `bindingsHash` | `bindings.json`의 해소된 바인딩 (정렬) | 검증 후 바인딩 편집 |
| `targetBaseHash` | 타깃 트리(`.git` 제외) | 검증 후 타깃 변경 |

`bindingsHash`는 `contentHash`로 대체되지 않는다 — 현재 `instantiate`는 바인딩 중 checker 하나만 읽으므로 `spec-format`·`naming`을 바꿔도 생성물이 변하지 않고, 그러면 대조가 조용히 통과한다. 이식 산출물의 파라미터화가 진행되면 두 해시가 함께 움직이게 되고, 그때도 **무엇이 바뀌었는지 정확한 이름으로 실패**하게 해준다.

**승인 경계 (phase 5).** 엔진은 저장 방식 어휘 없는 **승인 입력**만 받고, 조립과 일회성 소비는 호출자 책임이다(ADR-022). CLI의 승인은 `apply` 안에서 검증 결과와 적용 파일을 보인 뒤 **대화형으로** 받고 즉시 적용·봉인한다 — 승인이 프로세스보다 오래 살지 않는다. 자동 승인 플래그와 산출물 직접 편집은 공식 경로가 아니며, **stdin이 TTY가 아니면 `apply`는 실패한다**(동의를 받을 수 없는 환경에서 자동 승인으로 흐르지 않는다).

**에이전트 통합은 어댑터다.** 파일 기반 워크플로우가 본질이고, `.claude/commands/uptake.*.md` 같은 설치물은 그 위의 선택 어댑터다(`--agent` 옵션). Spec Kit이 35개 이상의 통합을 갖는 것은 그쪽의 규모 문제이며 uptake가 흉내낼 이유가 없다.

## SURVEY 계약 (phase 3)
저장소 하나를 받아 그 저장소의 개발 체계 후보를 제시하는 계약이다. 제품의 루트이며(ADR-017), 아래 저작 계약의 **앞단**이다. SURVEY는 새 등재 경로를 만들지 않는다 — `AuthoringRequest`를 자동 조립해 기존 EXTRACT·ABSTRACT·승인·등재를 **그대로 통과**시킨다. intent를 없애는 것이 아니라 자동 생성하는 것이다.

**범위.** 저장소 1개 → 후보 N개 → 사용자가 고른 하나 → `observed`/`descriptive` 등재. 다중 저장소 동시 분석·유사 프로젝트 추천·`corroborated` 자동 승급·`generative` 자동 합성은 범위 밖이다(PRD 'Phase 3 범위').

**입력과 revision 고정.** 사용자는 `UPTAKE_SOURCE_ROOT` 아래 저장소 식별자만 지정한다. intent는 입력이 아니다. SURVEY 개시 시 그 저장소의 HEAD 커밋 SHA를 고정하고, 이후 모든 수집과 근거 읽기는 **그 revision에서만** 일어난다 — 경로 목록은 `git ls-tree -r --name-only <revision>`, 내용은 `git show <revision>:<path>`다. **작업 트리를 읽지 않는다.** 분석 대상 저장소는 읽기 전용이며 checkout·네트워크·코드 실행이 없다(기존 provenance resolve 계약과 동일).

**고정 revision은 후속 단계까지 이어진다.** SURVEY 결과를 채택하는 단계는 그 revision을 그대로 쓰고 **HEAD를 다시 읽지 않는다.** 실패는 근거를 실제로 읽을 수 없을 때만 일어난다 — `revision-unresolvable`(커밋 객체 해석 불가) 또는 `provenance-unresolvable`(경로 읽기 불가). "SURVEY 이후 HEAD가 움직였다"는 실패 사유가 아니다(ADR-021). SURVEY를 거치지 않는 직접 저작 경로는 **저작 개시 시점** HEAD를 고정한다 — 두 경로의 고정 시점이 다른 것은 정상이다.

**수집 — "어디를 볼까"는 결정적 데이터가 정한다(ADR-018).** 수집 규칙은 코드가 아니라 repo 동봉 데이터 파일이다. 각 규칙은 `{ id, include }`(정규식 문자열 목록)이고, 전역 `exclude`와 예산(파일별 상한·총 상한)을 함께 싣는다.

```
경로 목록 (고정 revision)
  → exclude 제외 → 첫 매칭 규칙에 배정 → (ruleId, path) 사전식 정렬
  → 카테고리 라운드로빈      ← 한 규칙이 예산을 독식하지 못하게 한다
  → 파일별 상한 초과분 절단 · 총예산 초과 파일은 skip (중단 아님)
  → 수집 목록 확정
```

- 규칙 파일이 없거나 정규식이 컴파일되지 않으면 **명시적 오류로 표면화**한다. 조용히 빈 규칙으로 진행하지 않는다 — "규칙이 죽었다"와 "신호가 없다"는 구별되어야 한다.
- 총예산 초과는 `break`가 아니라 `skip`이다. 큰 파일 하나가 뒤 카테고리를 통째로 굶기면 안 된다(실측 결함).
- 같은 revision·같은 규칙이면 수집 결과는 **순서까지 항상 같다**.

**후보 제안 — LLM은 후보만(ADR-015).** SURVEY도 proposer 포트를 거치고, 수용 기준 테스트는 그 포트를 스텁으로 주입해 결정적 기계만 검증한다. 수집한 파일 내용은 `untrustedBlock` 경계 안에 **데이터로** 넣는다(신뢰 경계). 후보의 형태:

```ts
type SurveyCandidate = {
  id: string;          // kebab-case — 채택 시 patternId가 된다
  name: string;
  intent: string;      // 한 문장 — 이 방법론이 달성하는 것
  discipline: string;  // 무엇을 강제·금지하며 어떤 기계로 그렇게 하는가
  tradeoffs: string;   // 이 방법론이 치르는 비용 (ADR-006의 물질적 형태)
  evidence: string[];  // 수집 목록에 실재하는 repo-상대 경로
  confidence: "high" | "medium" | "low";
};
```

- `discipline`은 **구체적이어야 한다**. "TDD를 쓴다"는 쓸모없고 "같은 변경에 테스트 파일이 없으면 pre-edit 훅이 소스 편집을 거부한다"가 쓸모 있다. 이 요구가 해상도를 만들었다는 것이 스파이크의 실측 결과이며, 링크 모음집과 갈리는 지점이다.
- `tradeoffs`는 **후보 단계에서 함께 제시된다**. 채택 시점에 따로 생성하면 사용자가 보지 못한 텍스트가 등재물에 들어간다 — 무엇을 감수하는지 보고 고르는 것이 선택이다.
- `capability`는 후보에 **없다**. phase 3 등재물은 항상 `descriptive`이므로 쓰이지 않는 필드다.
- `confidence`는 선택 화면의 판단 보조로만 쓰고 **등재물에 담지 않는다**. 분류축은 둘뿐이다(ADR-019).

**환각 폐기 — 2단.**

1. **SURVEY 단계**: `evidence` 중 **수집 목록에 없는 경로**를 폐기한다. 기준은 repo 전체가 아니라 **LLM에 실제로 제시한 목록**이다 — 보여주지 않은 파일을 근거로 대는 것은 환각이다. 남은 evidence가 0이면 후보 자체를 폐기한다.
2. **등재 단계**: 기존 provenance resolve 하드 게이트가 다시 건다.

두 단계의 폐기는 **사유와 함께 사용자에게 보인다**. 조용히 사라지는 후보는 없다(ADR-009).

**채택 — LLM 호출은 0회다.** SURVEY 경로에서 LLM은 후보 제안 **한 번만** 들어온다. 사용자가 후보를 고른 뒤의 채택·조립·등재는 전부 결정적이다. 저장소가 하나뿐이라 `intent`·`discipline`·`tradeoffs`·근거가 이미 후보에 다 들어 있고, 더 물을 것이 없기 때문이다.

**채택은 ABSTRACT를 거치지 않는다.** EXTRACT(근거 확정)와 등재 하드 게이트는 그대로 재사용하지만, `contrastEvidence`는 통과시키지 않는다 — 그 함수는 **대조**로 role을 뽑는 장치인데 대조할 두 번째 저장소가 없다. 통과시키려면 결정적 값을 LLM 포트에 흘려보내야 하고, 그것은 하지 않은 대조를 한 것처럼 보이게 하는 위장이다. 채택 경로는 아래 조립표에 따라 패턴을 **직접 구성**하고, 참조 무결성·독립성·`capability`↔`oracle` 검사는 등재 전·후의 층 1 하드 게이트가 맡는다(검사를 건너뛰는 것이 아니라, 검사하는 층이 다르다).

**`AuthoringRequest` 자동 조립.** 사용자가 후보 하나를 고르면 아래를 결정적으로 조립해 EXTRACT에 넣는다. LLM은 이 조립에 관여하지 않는다.

| 필드 | 값 | 근거 |
|---|---|---|
| `patternId`·`name`·`intent` | 후보에서 그대로 | |
| `capability` | `"descriptive"` **고정** | oracle 초안·자기검증은 앵커 형태 한정(ADR-016) |
| `evidenceStatus` | `"observed"` **고정** | 저장소 1개 = 독립 그룹 1개(ADR-005) |
| `sources[0].repository` | 사용자가 지정한 저장소 식별자 | |
| `sources[0].id`·`independenceGroup` | 저장소 식별자를 `isId`(kebab-case)로 **정규화한 값**. 정규화할 수 없으면 채택을 거부한다 | 그룹이 1개인 것은 판정이 아니라 자명한 사실이다. **raw 식별자를 통과시키려고 층 1 게이트의 `isId` 검사를 낮추지 마라** — SURVEY 하나의 편의로 phase 0~2 전체의 계약을 약화시키는 일이다 |
| `sources[0].independenceNote` | 단일 저장소 관찰임을 밝히는 고정 문구 | |
| `sources[0].isTargetStack` | `detect.ts`의 결정적 관찰 결과 | 추론이 아니라 관찰 |
| `sources[0].stack` | 관찰된 표시 라벨, 없으면 `"unspecified"` | 표시용이며 비교에 쓰지 않는다 |

**근거는 재추출하지 않는다.** 살아남은 후보 `evidence` 경로를 **그대로** EXTRACT에 주입한다 — 파일 후보 제안을 다시 호출하지 않는다. 사용자가 화면에서 보고 고른 근거와 등재된 `provenance`가 달라지는 경로는 없다(이식의 AC-9와 같은 성격의 요구다).

**role은 하나다.** 주입되는 evidence 전부가 후보 하나에 대응하는 **단일 role**로 묶인다. 저장소가 하나뿐이면 무엇이 스택-불변 본질이고 무엇이 결합점인지 **가를 근거가 없다**(ADR-005: 공통=본질 / 차이=결합점). role을 쪼개는 것은 대조가 하는 일이며, 이 패턴이 두 번째 저장소와 대조돼 `corroborated`로 승급할 때 비로소 갈라진다. 따라서 SURVEY 등재물의 `bindingPoints`는 비어 있고, **비어 있는 것이 정직하다.**

**revision 이동은 실패가 아니다 (ADR-021로 교체됨).** 이전 계약은 "채택 시점에 EXTRACT가 고정한 revision이 SURVEY의 것과 다르면 등재를 거부한다"였다. 그 판정(`revision-moved`)은 **폐기한다** — 채택 경로는 HEAD를 다시 읽지 않고 SURVEY가 고정한 revision에서만 읽으므로, 애초에 두 값을 비교할 일이 없다. 사용자가 본 근거와 등재되는 근거가 다른 커밋의 것이 되는 경로가 없다는 요구는 그대로이며, **비교가 아니라 재조회 금지로** 달성된다. 실패는 근거를 실제로 읽을 수 없을 때만 일어난다(`revision-unresolvable`·`provenance-unresolvable`). 위 '고정 revision은 후속 단계까지 이어진다'와 같은 규칙이다.

**승인·등재는 기존 계약 그대로.** 초안은 승인 전까지 카탈로그에 쓰지 않고, 입력 fingerprint에 결속된 draft로 남으며, 승인 이벤트가 한 번 소비돼 `catalog/<patternId>.json`에 원자적으로 기록된다. 기존 파일을 덮어쓰지 않고 patternId 충돌은 등재 거부다(씨앗 보호). 기록 전·후로 층 1 하드 게이트를 통과한다.

**결과 화면은 한계를 밝힌다.** 자생/상속을 구분하지 않는다는 것(ADR-019), `observed`는 "이 저장소가 실제로 이렇게 한다"까지만 주장한다는 것(ADR-006)을 숨기지 않는다. 서술적 태도의 물질적 형태다.

**SURVEY 표면.** 제품의 첫 섹션은 저장소 식별자 입력 → 후보 선택 → 채택 초안 검토 → 승인 → 등재 순서로 진행한다. 후보는 `name`·`intent`·`discipline`·`tradeoffs`·판단 보조용 `confidence`와 모든 evidence 경로를 펼쳐 보이고, `discardedEvidence`·`discardedCandidates`·수집 `skipped`는 항목별 사유와 함께 같은 결과 영역에 표시한다. 조사 revision과 자생/상속 미구분·`observed` 주장 범위 고지는 후보 결과와 채택 초안에 항상 노출한다. 채택은 SURVEY 세션에 결속된 API가 기존 authoring draft를 만들고, 클라이언트는 그 draft의 `AuthoringRequest`로 기존 서버 승인 API를 호출해 승인 응답을 받은 뒤에만 기존 등재 API를 호출한다. 등재 충돌과 하드 게이트 거부는 성공과 구별되는 실패 결과로 표시한다.

**SURVEY proposer 경계.** 실제 Anthropic 어댑터는 코드 기본값 없이 `UPTAKE_PROPOSER_MODEL`의 모델 ID와 `ANTHROPIC_API_KEY`를 사용하고 provider·model ID를 메타데이터에 기록한다. 후보는 `output_config.format` JSON schema 구조화 출력으로 받되 결정적 코드가 전체 응답을 다시 검증하며, JSON 파싱이나 스키마 검증 실패는 최대 2회 재시도한 뒤 부분 후보 없이 오류로 표면화한다. 저장소 경로와 내용은 모두 `untrustedBlock` 안의 데이터로 전달하고 내부의 명령형 문장이 작업을 바꾸지 못한다는 시스템 계약을 함께 보낸다. 프롬프트는 저장소 기여자가 실제로 따르는 규칙·게이트·의례를 찾고, 구체적인 `discipline`과 제시된 목록 안의 evidence만 요구하며, 단순 의존성·프레임워크 선택·`capability`·자생/상속 분류는 요구하지 않는다. 모호한 다수보다 날카로운 소수를 선호하고 불확실성은 한계로 밝힌다.

## EXTRACT·ABSTRACT 저작 계약 (phase 2)
카탈로그를 손이 아니라 앱이 저작하는 계약이다. **결정성 경계**(ADR-015)를 지탱한다 — LLM은 후보만 내고, 무엇이 카탈로그에 남을지는 결정적 게이트와 사용자가 정한다.

**범위 경계.** "어떤 저장소에도"는 **분석 대상(소스) 측**이다 — 이식 타깃은 ADR-013(JS/TS vitest) 그대로. 분석과 `descriptive` 등재까지는 범용이고, `generative`의 이식·검증은 현재 엔진이 합성하는 **앵커 형태(spec-artifact/spec-check/blocking-gate 3역할)에 한정**한다. 임의 패턴의 자동 합성은 후속 phase다.

**입력 — 대상 지정.** 사용자가 `UPTAKE_SOURCE_ROOT` 아래의 소스 저장소 ≥2개와 **추출할 방법론의 의도(intent)**를 지정한다. 앱(LLM proposer)이 role·binding·provenance 후보와 초안 전체를 제안하고, 사용자는 **승인/거부만** 한다(후보 편집은 후속). 개방형 발견(저장소만 지정)은 E2 비목표다.

**EXTRACT — 근거 수집.** 각 소스 저장소를 **읽기 전용**으로 관찰한다. `revision`은 저작 개시 시점의 저장소 HEAD 커밋 SHA로 **자동 고정**하고, 근거 파일 내용은 기존 provenance resolve 계약(루트 기반 `git show <revision>:<path>`)을 **그대로 재사용**해 읽는다 — checkout·네트워크·코드 실행은 없다. 소스가 `UPTAKE_SOURCE_ROOT` 아래에 있으므로 저작-시점 resolve와 로드-시점 하드 게이트 resolve가 동일해진다(등재 후 자기 거부 방지). proposer는 방법론 의도에 맞는 역할을 보일 법한 **파일 후보를 제안**하며, 채택된 후보는 provenance(`sourceId`+`path`+`observedRole`)로 결속된다. 저장소 내용은 불신 데이터로, 명확한 경계 블록에 데이터로 넣어 LLM에 전달한다(아래 신뢰 경계). resolve되지 않는 근거는 초안에 담기지 않는다(ADR-009).

**ABSTRACT — 대조.** 소스 간 대조로 **공통점 = `roles`(본질) 후보**, **차이점 = `bindingPoints`(파라미터) 후보**로 분리한다(ADR-005). **`corroborated` 저작에서** 각 `roles` 후보는 서로 다른 `independenceGroup`의 provenance ≥2개로 뒷받침되어야 하며(역할 단위 대조 = 층 1 하드 게이트), 단일 저장소(단일 `independenceGroup`)만 지지하는 후보는 role이 아니라 binding으로 내려간다.

**oracle 초안 + 자기검증.** `generative` 후보에는 앱이 `oracle`(`violation`·`gateTestId`·`InjectionTemplate`)을 **초안**한다. 등재 전에 그 oracle로 **번들 정규 fixture 타깃**(최소 JS/TS+vitest repo)에 대해 **실제 VERIFY(양성 green + 음성 red)를 돌려 판별력을 입증**한 초안만 통과시킨다 — 판별력을 보이지 못하면 등재를 거부하고 사용자가 다시 시도하거나 `descriptive`로 남긴다(ADR-016). 자기검증은 oracle의 판별력을 증명하는 것이고, 실제 사용자 타깃 검증은 이식 시점 VERIFY에서 그대로 다시 일어난다. `oracle`이 없는 `descriptive` 초안은 이 단계를 건너뛴다.

**INSTANTIATE 매칭 — 역할 형태.** `instantiate`는 `patternId` 문자열이 아니라 **역할 형태(role shape)**로 템플릿을 매칭하도록 리팩터한다(합성 범용화가 아니라 하드코딩 부채 청산). 그래야 저작이 부여한 **새 `patternId`**를 가진 앵커 형태 패턴도 이식·자기검증된다. 앵커 형태를 벗어난 `generative` 패턴은 여전히 `generation-failed`이며, 그 임의 합성은 후속 phase다.

**판정 주체.** `independenceGroup`·`isTargetStack`·"공통점이 본질"의 **최종 해석·승인은 사용자**가 한다. 앱은 provenance·target stack 탐지 결과(detect.ts 재사용) 등 **결정적 사실과 그 근거를 자동으로 제시**할 수 있으나, 판정을 대신 내리지 않는다 — GitHub 메타데이터로 자동 추론하지 않는다(ADR-005/015).

**초안 수명 · 승인 · 등재.** 초안은 승인 전까지 **카탈로그에 쓰지 않는다** — 서버 프로세스 수명의 in-memory pending 저장소에 둔다(검증 승인의 `approval-store` 패턴 재사용). 사용자 승인 이벤트가 초안을 `pending`에서 `approved`로 전이하고, 등재는 이를 한 번 소비해 `catalog/<patternId>.json`을 **작업 트리에 원자적으로 쓴다**(git 커밋은 사용자 몫). patternId는 **항상 새 파일**이어야 하며 **기존 `catalog/` 파일을 덮어쓰지 않는다** — 충돌 시 등재를 거부한다(씨앗 보호; 기존 패턴 편집은 후속). 기록 **전과 후 모두** 기존 층 1 하드 게이트(카탈로그 로드 거부 조건)로 검증한다. 이 "승인 전 미기록"은 타깃 repo 쓰기의 AC-10과 대칭이다.

**결정성 경계.** LLM은 후보 제안에만 들어온다. provenance resolve·참조 무결성(양방향)·독립성/스택 검사·`capability`↔`oracle` 일치·injection·VERIFY 판정은 MVP와 동일하게 **결정적**이다. proposer는 포트 뒤에 두고, 수용 기준 테스트는 이 포트를 **스텁으로 주입**해 임의·적대적 후보에도 게이트가 옳게 걸러내는지 검증한다 — "LLM이 좋은 패턴을 뽑는가"는 게이트가 아니라 eval의 몫이다(ADR-015).

**LLM proposer 경계.** 실제 어댑터의 모델 ID는 코드 기본값 없이 `UPTAKE_PROPOSER_MODEL` 설정값으로 고정하며, provider와 model ID를 저작 세션 메타데이터에 기록한다. 세 제안 호출은 `output_config.format`의 JSON schema 구조화 출력을 사용하지만, 반환값은 결정적 코드로 다시 검증한다. JSON 파싱·스키마 검증 실패는 최대 2회 재시도한 뒤 오류로 표면화하며 부분 후보를 보정하지 않는다. 저장소에서 온 파일 경로·근거 발췌를 포함한 요청 데이터는 `untrustedBlock` 경계 안에 직렬화하고, 경계 안의 명령형 문장을 지시로 취급하지 않는 시스템 계약을 함께 보낸다. 실제 모델 품질은 비차단 `eval:proposer`에서 관찰하며 수용 테스트는 주입된 결정적 스텁과 가짜 SDK 클라이언트만 사용한다.

**oracle 초안 경계.** 앵커 형태의 `gateTestId`와 injection(`targetRole`·`marker`·`replacement`)은 `src/lib/engine/oracle-draft.ts`의 결정적 템플릿에서 파생한다. LLM proposer는 `violation` 서술 후보만 제공하며 실행 문자열을 만들지 않는다. 등재 전 자기검증은 `tests/fixtures/authoring-selfverify-target/`의 번들 JS/TS+vitest 타깃을 복제해 실제 양성 green·음성 red를 확인한다.

## 결합점 탐지 계약
`detectBindings(pattern, targetRepoRoot)`는 패턴의 `bindingPoints` 순서를 보존해 각 결합점을 다음 셋 중 하나로 반환한다.

- `detected`: 결정적 규칙으로 관찰한 `value`와 이를 뒷받침하는 repo-상대 `evidence[].path`
- `user-provided`: 사용자가 명시한 `value` (자동 탐지 근거로 위장하지 않으므로 evidence 없음)
- `binding-unresolved`: 관찰 근거가 없어 사용자 입력이 필요한 상태

복수 후보는 정해진 우선순위와 경로 정렬에서 첫 번째로 결정한다. `checker`는 `package.json`의 dependency 또는 `scripts.test` 문자열에서 vitest를 관찰하고, `gate-location`은 `vitest.config.{ts,js,mts}` 또는 `vite.config.*`의 `test` 설정을 관찰한다. 러너만 있고 설정이 없으면 `package.json`을 근거로 co-location 관습을 반환한다. `spec-format`과 `naming`은 `.changeset/`, `changes/`, `changelog/` 순으로 실재 선언 파일의 확장자와 경로 관습을 관찰한다. 관습이 없으면 기본값을 만들지 않고 `binding-unresolved`로 남긴다.

탐지는 읽기 전용이다. `package.json`은 JSON 데이터로 파싱하고 설정 파일은 텍스트로 관찰할 뿐, package script나 설정을 import·실행하지 않는다. 사용자 입력은 별도 병합 단계에서 동일 `bindingId`의 결과를 `user-provided`로 교체한다.

## VERIFY 실행 계약
CRITICAL 규칙(자기검증·diff후적용)을 실제로 지탱하는 실행 계약이다. 검증은 **타깃 repo 밖에서** 일어난다.

```
타깃 repo (읽기 전용)
  → W_pos 생성        임시 워크스페이스에 작업 트리 복제
  → 생성물 적용        W_pos 에만
  → 양성 실행          게이트 → gateTestId `pass` 기대
  → W_neg 생성        W_pos 를 복제한 별도 워크스페이스
  → 위반 삽입          결속된 InstantiatedInjection → W_neg 에만
  → 음성 실행          게이트 → gateTestId `fail` 기대 (`error`는 실패로 간주)
  → 워크스페이스 폐기   W_pos · W_neg 통째로 삭제
  → 검증된 diff 표시   + 산출물 내용 해시 기록
  → 사용자 승인
  → 해시 재확인 → 타깃 repo 적용
```

결정 사항:

- **타깃 repo는 검증 중 불변이다.** 검증은 복제본에서만 돌고, 실제 repo에 대한 쓰기는 마지막 적용 단계에만 존재한다(AC-5).
- **위반은 삽입 후 제거하지 않는다.** 위반은 `W_neg`에만 심고 워크스페이스를 통째로 버린다. "심었다가 롤백"은 롤백 실패 시 오염이 남으므로 채택하지 않는다. 위반의 내용은 패턴의 `oracle`에서 파생한다 — 검증기가 스스로 만들어내면 자기채점이 된다(ADR-008).
- **승인된 diff = 검증된 diff.** 검증에 사용한 산출물의 내용 해시를 기록하고, 적용 직전에 재계산해 일치할 때만 쓴다. 불일치는 `diff-mismatch`로 적용을 거부한다(AC-9). 재생성으로 "다시 만들어 적용"하지 않는다.
- **실행 형태.** 게이트 커맨드는 **고정 argv**로 실행한다. shell 문자열 조합 금지. `cwd`는 임시 워크스페이스 루트로 한정하고, timeout을 건다.
- **argv의 출처와 동결.** argv는 사람이 타이핑하는 값이 아니라 **결합점 탐지 결과에서 결속된다** — `checker`(테스트 러너)와 `gate-location`(게이트 테스트 경로) 결합점이 확정되면 argv가 확정된다. 순서는 이렇다.

  ```
  결합점 확정 → 생성물 확정 → argv 동결 → 실행 개시 화면에 표시 → 실행
  ```

  동결 이후 결합점이나 생성물이 바뀌면 **argv를 다시 동결하고 다시 표시한다** — 표시된 것과 다른 argv로 실행하는 경로는 없다(AC-12). 실행 직전에 동결된 argv와 실제 호출 argv의 동일성을 확인한다.
- **출력은 보존하고, 표시는 제한한다.** stdout/stderr **전문**은 임시 로그 파일에 남긴다. UI에는 정해진 분량만 표시하고, **잘렸다는 사실과 전체 로그 경로를 함께** 보인다. 정직성이 요구하는 것은 원문에 접근 가능할 것이지 인메모리 무제한 전달이 아니다.
- **중간 실패는 단계별 상태로 반환한다.** 어느 단계에서 멈췄는지가 UI의 정직성을 결정한다.

### 게이트 결과 판별 — "red"의 정의
**non-zero 종료는 red가 아니다.** 모듈 설치 실패·설정 오류·문법 오류·OOM·signal 종료도 non-zero다. 이것을 red로 세면 *위반을 잡지 못했는데 잡았다고 보고하는* 성공 위장이 성립하며, 이는 ADR-008이 막으려는 것 자체다.

게이트 실행은 exit code가 아니라 **구조화된 리포터 출력**으로 판정한다(vitest JSON reporter). 결과는 셋 중 하나다.

| 결과 | 조건 |
|---|---|
| `pass` | 리포터가 정상 산출됐고, 오라클이 지목한 게이트 테스트가 **통과** |
| `fail` | 리포터가 정상 산출됐고, 오라클이 지목한 게이트 테스트가 **실패** |
| `error` | 리포터가 산출되지 않음 — spawn 실패, 설치·설정 오류, 문법 오류, timeout, signal 종료, 파싱 불가 |

**`error`는 절대 `fail`로 계산하지 않는다.** `gate-error` 상태로 이식을 중단한다. 그래야 "인프라가 깨져서 non-zero"와 "위반을 잡아서 red"가 구별된다.

판정 규칙:
- **양성 성공** = `pass`
- **음성 성공** = `fail` **이면서**, 실패한 것이 *양성에서 통과했던 바로 그 게이트 테스트*일 것. 무관한 기존 테스트가 실패해 `fail`이 된 경우는 음성 성공이 아니다 — 양성·음성 두 실행의 테스트별 결과를 **대조**해 확인한다.
- 오라클이 지목하는 게이트 테스트의 식별자는 패턴에서 온다(아래 `oracle.gateTestId`).

| 상태 | 의미 |
|---|---|
| `binding-unresolved` | 결합점을 탐지하지 못함 — 사용자 입력 필요 |
| `provenance-unresolved` | 근거 경로가 resolve 안 됨 — 패턴 폐기 |
| `generation-failed` | INSTANTIATE 산출 실패 |
| `positive-failed` | 준수 상태인데 게이트가 green이 아님 |
| `injection-failed` | 위반을 심지 못함 (경로 이탈, `marker` 0회·2회 이상) — 음성 검증 불가 = 이식 실패 |
| `gate-error` | 게이트가 결과를 산출하지 못함 (spawn·설치·설정·문법 오류, signal) — **음성 성공으로 계산하지 않는다** |
| `negative-not-caught` | **위반을 심었는데 게이트가 잡지 못함** — 추상화 미성립, 이식 실패 |
| `timeout` | 게이트 커맨드가 제한 시간 초과 — `gate-error`의 일종이나 사용자 조치가 달라 따로 보고한다 |
| `awaiting-approval` | 검증 통과, 사용자 승인 대기 |
| `diff-mismatch` | 승인된 diff ≠ 검증된 산출물 — 적용 거부 |
| `apply-failed` | 타깃 repo 쓰기 실패 |
| `completed` | 적용 완료 |

`negative-not-caught`는 **일반 테스트 실패와 의미가 반대다** — 테스트가 통과(green)했기 때문에 실패다. 별도 상태로 분리하지 않으면 UI에서 green이 성공으로 위장된다. 이름에 "failed"를 쓰지 않는 이유도 같다(AC-8).

## 패턴 스키마 (카탈로그 파일의 형태)
하나의 패턴 = 5요소 + 두 개의 **독립된** 분류축.

| 요소 | 예 (Spec↔Verification 루프) | 본질/파라미터 |
|---|---|---|
| 의도(intent) | "스펙과 어긋난 코드의 병합을 막는다" | 본질 |
| 불변 구조(roles) | `[스펙 산출물]`→`[스펙에 결속된 검사]`→`[실패 시 차단 게이트]` | 본질 |
| 결합점(binding points) | 스펙 형식 / 검사 도구 / 게이트 위치 / 네이밍·경로 | 파라미터 |
| 출처(provenance) | 이 패턴을 보이는 실재 repo·파일 경로(들) | 메타데이터 |
| 판별 오라클(oracle) | "위반은 이렇게 생겼다; 올바른 이식은 이를 red로 거부해야 한다" | 검증 계약 |

### 두 분류축 (혼동 금지)
서로 다른 질문에 답하는 **직교하는** 축이다. 예전에 둘 다 "tier"로 불렀으나, 한 단어가 두 축을 가리키면 생성 조건을 정확히 쓸 수 없다.

| 축 | 값 | 묻는 것 | 근거 |
|---|---|---|---|
| `capability` | `generative` / `descriptive` | 판별 오라클이 **있는가** (게이트형인가) | ADR-012 |
| `evidenceStatus` | `observed` / `corroborated` | 근거 repo가 **몇 개인가** (N=1 / N≥2) | ADR-005 |

### 두 층의 게이트 (혼동 금지)
카탈로그 **로드**와 생성 **점등**은 다른 층위다. 앞은 패턴이 존재할 자격, 뒤는 남의 repo에 써 넣을 자격이다. 하나로 뭉치면 "근거 없는 패턴을 등재만 해둔다"는 CRITICAL 규칙 위반이 생긴다.

**층 1 — 카탈로그 로드 거부 (하드 게이트).** 아래는 등재도 표시도 하지 않는다. 근거 없는 주장은 카탈로그에 **존재할 수 없다**(ADR-009 · AC-2).
- `provenance` 중 하나라도 resolve 실패
- 스키마 위반 — 필수 필드 누락
- `sources` 또는 `provenance`가 **빈 배열** — 근거가 0인 패턴은 `observed`로도 등재하지 않는다
- 참조 무결성 위반 — **양방향으로 검사한다**. 정방향: `provenance[].sourceId`가 `sources`에 없음, `observedRole`이 `roles`에 없음. 역방향 둘: **`sources[].id` 중 어느 `provenance[].sourceId`에서도 참조되지 않는 것**(고아 source — 근거 파일 없는 repo), **`roles[].id` 중 어느 `provenance[].observedRole`에서도 참조되지 않는 것**(고아 role — 근거 없이 선언된 역할). 역방향을 source에만 걸고 role에 안 걸면 "관찰했다고 주장하는 역할"이 근거 없이 통과한다
- `capability`와 `oracle`의 불일치 — **양방향 모두**. `generative`인데 `oracle`이 없거나, `descriptive`인데 `oracle`이 있으면 데이터 오류다. `capability`는 곧 오라클 유무의 선언이므로 둘은 항상 일치해야 한다
- **`evidenceStatus` 선언이 데이터와 불일치** — `corroborated`인데 distinct `independenceGroup`이 2 미만이거나 `isTargetStack: false`인 source가 없음(AC-1). `observed`인데 distinct `independenceGroup`이 1이 아님(ADR-005의 N=1 정의). 사람이 선언한 값을 엔진이 조용히 강등·승급하지 않는다 — 선언과 근거의 불일치는 **명시적 데이터 오류**이고, 조용한 보정은 성공 위장의 사촌이다
- **`corroborated`인데 대조되지 않은 role이 있음** — `roles` 중 어느 하나가 단일 `independenceGroup`의 provenance로만 뒷받침됨. `roles`는 **불변 구조**, 즉 대조로 확인된 공통점이다(ADR-005: 공통=본질 / 차이=결합점). 한 repo에서만 보인 것은 본질이 아니라 그 repo의 특성이므로 `roles`가 아니라 `bindingPoints`에 가야 한다. **패턴 전체가 N≥2인 것과 각 역할이 N≥2인 것은 다르다** — 후자를 검사하지 않으면 role A는 repo1에서만, role B는 repo2에서만 관찰돼도 "대조 추상화"로 통과한다

**층 2 — 생성 진입 차단 (소프트 게이트).** 로드된 패턴 중 아래 둘을 만족할 때만 생성이 점등된다.
```
capability     === "generative"
evidenceStatus === "corroborated"
```
못 만족하면 카탈로그에 **등재·서술은 하되** 생성 진입만 차단한다(AC-3). `descriptive` 패턴에 `oracle`이 없는 것은 정상이며, 생성은 이 층에서 막힌다.

### 직렬화 계약
한 패턴 = **JSON 파일 하나**(`catalog/<patternId>.json`). 손 큐레이션이라도 실제로는 엔진 출력물을 사람이 검토하는 형태이므로, 의존성 0으로 파싱·타입 검증·왕복 export가 되는 JSON을 쓴다. 서술 텍스트는 마크다운 문자열로 담는다.

```ts
type Source = {
  id: string;                  // provenance가 참조하는 키
  repository: string;          // 예: "github.com/roberts/laravel-wallets"
  revision: string;            // 고정 커밋 SHA (브랜치·태그 금지 — 움직이면 검증이 무의미)
  stack: string;               // 표시용 라벨, 예: "php/pest" — 사람이 읽는 값 (비교에 쓰지 않음)
  isTargetStack: boolean;      // 비교용 판정값 — 이 source가 타깃 스택(JS/TS+vitest)인가 (AC-1)
  independenceGroup: string;   // 같은 값끼리는 독립 1건으로 센다 (ADR-005)
  independenceNote: string;    // 큐레이터가 그렇게 판정한 근거
};

type Provenance = {
  sourceId: string;      // Source.id 참조
  path: string;          // repo-상대 경로
  observedRole: string;  // roles[].id — 이 파일에서 관찰한 역할
};

// 패턴에 저장되는 추상 오라클 — 타깃을 모른다
type InjectionTemplate = {
  operation: "replace";     // MVP 앵커에 필요한 연산 하나뿐
  targetRole: string;       // roles[].id — 어느 역할의 생성물에 심는가
  marker: string;           // INSTANTIATE가 그 생성물에 심는 고정 marker (치환 대상)
  replacement: string;      // marker를 대체해 위반 상태로 만드는 코드
};

// INSTANTIATE가 결합점을 결속해 산출하는 실행 오라클 — 타깃 경로에 묶인다
type InstantiatedInjection = {
  operation: "replace";
  path: string;             // 워크스페이스-상대 경로 (결속 후 확정)
  marker: string;
  replacement: string;
};

type Pattern = {
  schemaVersion: 1;
  patternId: string;              // 안정 식별자 (파일명과 일치)
  name: string;
  capability: "generative" | "descriptive";
  evidenceStatus: "observed" | "corroborated";
  intent: string;
  roles: { id: string; description: string }[];          // 불변 구조
  bindingPoints: {
    id: string;
    description: string;
    kind: "spec-format" | "checker" | "gate-location" | "naming";
  }[];
  sources: Source[];              // 근거 repo (독립성·스택 메타데이터)
  provenance: Provenance[];       // 근거 파일 (어느 source의 어느 파일이 어느 role인지)
  oracle?: {                      // capability = generative 일 때 필수 (없으면 로드 거부)
    violation: string;            // 위반이 어떻게 생겼는지 (서술)
    gateTestId: string;           // 판정 대상 게이트 테스트의 식별자 (리포터 출력에서 찾는 키)
    injection: InjectionTemplate;
    expect: "red";                // 올바른 이식은 이를 red로 거부해야 한다
  };
  tradeoffs: string;              // 서술적 태도의 물질적 형태 (ADR-006)
};
```

- **여러 근거의 연결**: `provenance[].sourceId` → `sources[].id`, `provenance[].observedRole` → `roles[].id`. "어느 주장이 어느 repo의 어느 파일에서 왔는가"는 이 두 참조로만 성립한다. `repository`·`revision`을 파일마다 반복하지 않는다.
- **모든 `sources[].id`는 최소 하나의 `provenance[].sourceId`에서 참조되어야 한다.** `sources`는 근거 repo의 **목록이 아니라 색인**이다 — 실재하는 근거 파일이 가리키는 대상일 때만 존재 이유가 있다. 이 역방향 검사가 없으면 `provenance`가 하나도 없는 더미 source를 넣어 `independenceGroup`을 채우고 `corroborated`로 승급시킬 수 있다. `sources`에 적히는 것은 주장이고, `provenance`에 적히는 것이 근거다(ADR-009).
- **생성물의 근거 추적**: INSTANTIATE 산출물의 각 블록에는 자신이 파생된 `patternId` + `roles[].id`를 왜-주석으로 단다. 이 참조는 **카탈로그가 있어야 원본까지 되짚을 수 있다** — uptake 없이도 추적 가능하게 만들려면 패턴 JSON 동봉이나 provenance manifest가 필요하고, 그 방식은 이식 산출물 확정 시 정한다(아래 유예 표). 그때까지 "export 후에도 되짚을 수 있다"고 주장하지 않는다.
- **resolve 성공의 정의**: `sources[].repository`가 로컬에서 접근 가능하고, `revision`이 존재하며, 그 revision에서 `path`가 실재하는 파일일 것. 셋 중 하나라도 실패하면 resolve 실패이며 패턴은 **로드되지 않는다**(AC-2).
- **resolve 방법**: `repository`는 URL이 아니라 **식별자**이고, 로컬 위치는 **source root** 아래에서 식별자를 그대로 경로로 이어 붙여 찾는다. 예: source root가 `~/src`이고 `repository`가 `github.com/roberts/laravel-wallets`면 `~/src/github.com/roberts/laravel-wallets`다(중첩 디렉터리 그대로). source root는 환경변수 `UPTAKE_SOURCE_ROOT`로 지정하며 기본값은 `./.uptake/sources`다. 미설정·부재는 `provenance-unresolved`이고, 이어 붙인 경로가 source root를 벗어나면(`..` 등) 거부한다. MVP는 **네트워크에 나가지 않는다** — 없으면 clone하지 않고 `provenance-unresolved`다. 씨앗 repo는 사용자가 미리 받아둔다. 고정 revision의 파일 내용은 `git show <revision>:<path>`로 읽고 **checkout하지 않는다** — 씨앗 repo의 작업 트리도 타깃과 마찬가지로 건드리지 않는다. 검사 시점은 카탈로그 로드 시다.

**독립성·스택은 큐레이터가 판정하고 엔진은 검사만 한다.** `independenceGroup`과 `isTargetStack`은 사람이 부여한다 — fork·동일 스캐폴딩 템플릿·동일 조직이면 같은 `independenceGroup`을 준다(ADR-005). GitHub 메타데이터로 자동 추론하지 않는다: 로컬-우선·의존성 0 범위를 벗어나고, 판정 책임이 LLM으로 넘어가면 서술적 태도가 무너진다.

엔진이 하는 일은 `corroborated` 패턴에 대해 **서로 다른 `independenceGroup`이 2개 이상인지**, **`isTargetStack: false`인 source가 최소 하나 있는지**를 확인하는 것뿐이며, **실패하면 층 1에서 로드를 거부한다**(AC-1). 검사 결과가 아무 게이트에도 연결되지 않으면 기준이 아니라 장식이다.

이 계산의 대상은 **근거 파일이 연결된 source뿐이다.** 고아 source는 참조 무결성 검사에서 이미 거부되므로, 로드에 성공한 패턴에서는 모든 source가 실재하는 provenance를 갖는다 — 즉 N을 세는 단위는 "선언된 repo"가 아니라 "근거가 달린 repo"다.

`stack`을 자유 문자열로 두고 비교는 `isTargetStack`으로 하는 이유: `js/vitest`·`typescript/vitest`·`node`가 같은 스택인지 문자열로는 판정할 수 없고, 그렇다고 범용 스택 분류 체계를 만드는 것은 타깃이 하나뿐인 MVP에 과하다. 표시(사람이 읽는 라벨)와 비교(기계가 쓰는 boolean)를 분리하면 둘 다 단순해진다.

**추상 오라클 → 실행 오라클.** 패턴의 `injection`은 소스 스택 기준의 **템플릿**이라 그대로 실행할 수 없다 — 타깃에서는 게이트 테스트가 다른 경로에 생성된다. INSTANTIATE가 결합점을 결속하면서 `InjectionTemplate.targetRole` → 그 역할로 생성된 **실제 산출물 경로**를 해석해 `InstantiatedInjection`을 함께 산출한다. 즉 생성물과 실행 오라클은 **같은 단계에서 같은 결속으로** 나오며, 따로 만들어져 어긋날 수 없다.

**삽입 대상은 생성물뿐이다.** 타깃 repo의 기존 파일은 음성 fixture에서도 변조하지 않는다.

**치환 대상은 자유 문자열이 아니라 marker다.** 패턴에 적힌 문자열을 타깃 생성물에서 그대로 찾으려 하면, 생성 방식(고정 템플릿이든 LLM이든)에 따라 그 문자열이 없을 수 있어 **정상 생성이 `injection-failed`가 된다**. 그래서 계약을 뒤집는다 — INSTANTIATE가 `targetRole`에 해당하는 생성물 블록에 패턴이 지정한 `marker`를 **심고**, injection은 그 marker를 치환한다. marker의 심기는 uptake가 통제하므로 1회 등장이 결정적으로 보장된다.

이 구조는 자기채점도 막는다. `marker`와 `replacement`는 **패턴에서 오지 생성 단계에서 만들어지지 않는다** — 생성기가 자기가 통과시킬 오라클을 함께 지어낼 수 없다(ADR-008). 생성물에 marker가 0회 또는 2회 이상 나타나면 그것은 **생성 오류**이며 `injection-failed`로 중단한다.

**위반 삽입 계약** — 자유 문자열이 아니라 구조화된 치환 하나로 제한한다. 문자열을 명령처럼 해석하면 untrusted-as-data 규칙이 깨지고, 음성 검증을 일관되게 구현할 수도 없다.
- `path`는 정규화 후 **워크스페이스 루트 내부**여야 한다. `..`·절대경로·바깥을 가리키는 symlink는 거부한다. (이 검사는 **injection path에 한정**한다 — repo 전체의 symlink 위협 모델은 다루지 않는다. 아래 신뢰 경계 참조.)
- `marker`는 대상 생성물에서 **정확히 1회** 나타나야 한다. 0회면 심을 곳이 없고, 2회 이상이면 어디를 바꿀지 모호하다 — 둘 다 거부한다.
- 치환은 **순수 문자열 연산**이다. `marker`/`replacement`는 코드로 평가되지 않는다.
- 같은 입력에 같은 결과를 낸다(결정적). 삽입 실패는 `injection-failed`이며, 음성 검증을 못 하므로 이식 실패다 — 조용히 건너뛰지 않는다.
- 연산은 `replace` 하나뿐이다. 두 번째 패턴이 실제로 다른 연산을 요구할 때 늘린다(over-engineering 금지).

## 상태 관리
> 아래는 **웹 표면**의 상태 계약이다(phase 1~3). CLI 표면의 상태는 디스크 산출물이며 위 '워크플로우 산출물 계약'을 따른다. 두 표면의 진행 상태는 공유되지 않는다(ADR-020).

- **서버 상태**(카탈로그·결합점 탐지·생성·검증·적용 결과)는 서버측에서 계산해 전달. 로컬-우선이라 원격 상태 저장소 없음.
- **클라이언트 상태**(패턴 선택·diff 검토·UI상의 승인 조작)는 최소한의 로컬 상태(useState/useReducer)로.
- **승인은 클라이언트 상태가 아니다.** 위의 "승인 여부"는 화면 조작일 뿐이고, 적용 API는 **클라이언트가 보낸 boolean을 신뢰하지 않는다.** 승인 레코드는 서버 프로세스 수명의 in-memory 저장소에 남으며 타깃 경로 · `patternId` · 산출물 해시 · 타깃 base 해시 · 동결된 argv에 결속된다. 검증 성공 시 발급한 불투명 `verificationId`를 명시적 승인 이벤트가 `pending`에서 `approved`로 전이하고, 적용은 이 ID를 한 번 소비해 `consumed`로 만든다. 프로세스 재시작 뒤에는 재검증·재승인이 필요하며, UI를 우회한 직접 API 호출이나 승인 ID 재사용으로 쓰는 경로는 없다(AC-10).
- **HTTP 세션 소유권**: Route Handler가 불투명 session ID를 HttpOnly 쿠키로 발급하고, 서버측 in-memory workflow 저장소가 session ID와 workflow를 결속한다. workflow/API 계층이 `verificationId`가 현재 소유 세션의 workflow에서 발급된 것인지 확인한 뒤 승인·적용 엔진을 호출한다.
  - **부분 대체 (ADR-022 · phase 5)**: "기존 `approval-store`의 엔진 계약은 바꾸지 않는다"는 단서는 폐기된다. `applyGenerated`는 저장 방식 어휘 없는 **승인 입력**을 인자로 받는 순수 함수가 되고, 승인 레코드 조립과 일회성 소비는 **호출자 책임**이 된다 — 웹은 위 in-memory 저장소가, CLI는 검증 산출물이 각자 조립한다. 위 문단의 나머지(클라이언트 boolean 불신, 해시 결속, 세션 소유권 확인, ID 재사용 경로 없음)는 유효하다. 해시는 `bindingsHash`가 추가되어 셋이 된다.
- **수명**: workflow 상태는 서버 프로세스 수명에만 존재한다. 사용자가 이전 입력을 바꾸면 downstream 생성·검증·승인 상태를 폐기한다. 새로고침 진행 상태 복구와 서버 재시작 후 복구는 phase 1 비목표이며, 사용자는 재검증·재승인한다.

## Phase 1 UI/API 결정

- 사용자가 타깃 repo의 **절대 경로**를 입력한다. MVP 적격성은 해당 경로가 Git worktree이고 읽을 수 있는 `package.json`을 가지며 결합점 탐지로 vitest checker가 확인되는 경우로 한정한다. monorepo 자동 탐색과 의존성 설치는 하지 않는다.
- 생성 산출물과 diff는 신규 파일별 `{ operation: "add", path, role, content }`로 표현한다. 기존 apply 계약대로 기존 파일 수정과 삭제는 지원하지 않는다.
- 준비 응답은 `frozenArgv`의 인자 경계, 타깃 밖 임시 워크스페이스라는 cwd 설명, timeout을 실행 전에 제공한다. 공개된 argv와 실제 호출 argv가 같을 때만 VERIFY를 실행한다(AC-12).

## 보안·안전 (표적 수준)
- **provenance 강제**: 모든 추출·생성 결과는 resolve 가능한 실재 소스 경로를 달아야 한다. resolve 안 되면 폐기.
- **불신 격리**: repo 내용 = 데이터, 지시 아님.
- **개입 최소화**: 생성물은 diff 승인 후에만 적용, 실행은 테스트 커맨드로 한정.

### 신뢰 경계
**"테스트 커맨드만 실행한다"는 그 자체로 안전장치가 아니다.** vitest 설정·테스트 파일·`package.json` script는 모두 임의 코드를 실행할 수 있다. 그러니 아래를 계약으로 명시한다.

- **불신 입력의 범위**: 씨앗 repo 내용, 타깃 repo 내용, 그 설정·테스트·package script는 전부 신뢰하지 않는 입력이다. 타깃 repo가 사용자 소유라는 사실은 LLM 입력으로서의 신뢰도를 바꾸지 않는다.
- **LLM 프롬프트**: repo에서 읽은 내용은 지시가 아니라 데이터로, 명확한 경계 블록에 넣어 전달한다. 그 안의 명령형 문장은 실행 대상이 아니라 관찰 대상이다.
- **실행 형태**: 고정 argv로만 실행하고 shell 문자열을 조합하지 않는다. `cwd`는 임시 워크스페이스로 한정, timeout 필수, 환경변수는 상속을 최소화한다.
- **실행 커맨드 사전 공개**: 게이트 커맨드와 실행 위치를 **이식 실행 개시 화면에 표시**한다. 사용자가 "이식 실행"을 누른 것이 그 커맨드 실행에 대한 승인이며, 검증 도중 추가 승인은 받지 않는다(마찰만 늘고 안전은 늘지 않는다). 계약의 실체는 **표시하지 않은 커맨드는 실행하지 않는다**는 것이다(AC-12). 사용자가 자기 손으로 `npm test`를 돌리는 것과 같은 신뢰 수준이지만, 대신 돌려주는 쪽은 무엇을 돌리는지 밝혀야 한다.

> **범위 한정**: symlink escape 검사는 **injection path에 대해서만** 한다. 타깃 repo 전체의 symlink·경로 이탈 위협 모델과 샌드박싱은 다루지 않는다(over-engineering 금지). 위 항목은 CRITICAL 규칙을 실제로 지탱하는 **최소 계약**이며, 그 이상의 리스크 처리는 아키텍처 확정 후로 미룬다.

## 구현 중 결정 (의도적 유예)
아래는 **아직 정하지 않았다는 사실 자체를 기록해둔** 항목이다. 누락이 아니라 유예다 — 코드 없이 지금 정하면 계약이 아니라 추측이 되고, 첫 구현에서 되돌려야 한다. 각 항목은 해당 단계를 구현할 때 이 문서에 확정해 넣는다.

| 항목 | 확정 시점 |
|---|---|
| hash 대상·알고리즘, 적용 직전 **타깃 base 상태** 확인, 부분 쓰기 실패 시 롤백 | apply 구현 (AC-9·AC-10) |
| 워크스페이스 복제 범위 — tracked/untracked/ignored, `node_modules`, 의존성 설치 시점, 권한 비트 | VERIFY 실행기 구현 (AC-5) |
| INSTANTIATE의 LLM 경계 — 고정 템플릿인지 LLM 생성인지, 모델 ID 고정, structured output, 재시도 | INSTANTIATE 구현 |
| 환경변수 허용 목록, `.env` 취급, CI 플래그 | 게이트 실행기 구현 |
| 상태 taxonomy 확장 — 단계별 timeout 구분, 사용자 조치 가능/불가 구분 | 상태 머신 구현 |
| 생성물 provenance의 포터블 표현 — 패턴 JSON 동봉 / 주석에 source 직접 기재 / 별도 manifest | 이식 산출물 확정 시 |
| 스키마 세부 — ID 문자 제약·중복 금지, unknown field, 경로 정규화, `schemaVersion` 미지원 거부, 파일 하나 오류 시 전체 로드 실패 여부 | 로더 구현 (AC-2) |
| timeout 기본값, 출력 인코딩, cleanup 실패 처리 | 게이트 실행기 구현 |
| `descriptive` 패턴 최소 수량(ADR-003의 "넓게") · 씨앗 "성공 repo" 선정 근거 기록 | M0 카탈로깅 스파이크 |
| **ABSTRACT 대조 규칙** — role/binding 후보 경계, 역할 정합·병합, 근거 중복 제거 | ABSTRACT 구현 (phase 2) |
| **카탈로그 쓰기** — `patternId` 생성·충돌, 원자적 쓰기, 기존 파일 덮어쓰기 정책, 승인 저장소 결속 | 카탈로그 쓰기 구현 (phase 2) |
