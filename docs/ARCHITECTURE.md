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
│   ├── engine/         # INSTANTIATE / VERIFY  (EXTRACT·ABSTRACT는 앱 밖 — 아래 참조)
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

**EXTRACT·ABSTRACT는 MVP 앱의 런타임 기능이 아니다.** 위 흐름의 첫 블록은 오프라인 큐레이션 절차이며, 산출물인 패턴 JSON이 `catalog/`에 동봉된 채로 제품에 들어온다. 앱이 구현하는 것은 **INSTANTIATE와 VERIFY**뿐이다. ABSTRACT가 프로젝트의 핵심 가치라는 것(ADR-004)과, 그것을 MVP에서 **앱 기능으로 만드는 것**은 별개다 — MVP가 증명해야 하는 것은 "떼어낸 패턴이 다른 스택에 실제로 이식되고 검증된다"이고, 떼어내는 작업 자체는 큐레이터가 손으로 한다. 자동 채굴이 MVP 밖인 것(PRD)과 같은 이유다.

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
- **서버 상태**(카탈로그·결합점 탐지·생성·검증·적용 결과)는 서버측에서 계산해 전달. 로컬-우선이라 원격 상태 저장소 없음.
- **클라이언트 상태**(패턴 선택·diff 검토·UI상의 승인 조작)는 최소한의 로컬 상태(useState/useReducer)로.
- **승인은 클라이언트 상태가 아니다.** 위의 "승인 여부"는 화면 조작일 뿐이고, 적용 API는 **클라이언트가 보낸 boolean을 신뢰하지 않는다.** 승인 레코드는 서버 프로세스 수명의 in-memory 저장소에 남으며 타깃 경로 · `patternId` · 산출물 해시 · 타깃 base 해시 · 동결된 argv에 결속된다. 검증 성공 시 발급한 불투명 `verificationId`를 명시적 승인 이벤트가 `pending`에서 `approved`로 전이하고, 적용은 이 ID를 한 번 소비해 `consumed`로 만든다. 프로세스 재시작 뒤에는 재검증·재승인이 필요하며, UI를 우회한 직접 API 호출이나 승인 ID 재사용으로 쓰는 경로는 없다(AC-10).

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
| 생성 산출물·diff 표현 — 파일 목록 / unified diff / operation 중 무엇인지, 신규·수정·삭제 지원 범위 | INSTANTIATE 구현 |
| hash 대상·알고리즘, 적용 직전 **타깃 base 상태** 확인, 부분 쓰기 실패 시 롤백 | apply 구현 (AC-9·AC-10) |
| 워크스페이스 복제 범위 — tracked/untracked/ignored, `node_modules`, 의존성 설치 시점, 권한 비트 | VERIFY 실행기 구현 (AC-5) |
| INSTANTIATE의 LLM 경계 — 고정 템플릿인지 LLM 생성인지, 모델 ID 고정, structured output, 재시도 | INSTANTIATE 구현 |
| 타깃 적격성 규칙 — vitest 선재 여부, monorepo 대상 선택, 미충족 시 거부 상태 | 타깃 선택 구현 |
| 환경변수 허용 목록, `.env` 취급, CI 플래그 | 게이트 실행기 구현 |
| 상태 taxonomy 확장 — 단계별 timeout 구분, 사용자 조치 가능/불가 구분 | 상태 머신 구현 |
| 생성물 provenance의 포터블 표현 — 패턴 JSON 동봉 / 주석에 source 직접 기재 / 별도 manifest | 이식 산출물 확정 시 |
| 스키마 세부 — ID 문자 제약·중복 금지, unknown field, 경로 정규화, `schemaVersion` 미지원 거부, 파일 하나 오류 시 전체 로드 실패 여부 | 로더 구현 (AC-2) |
| timeout 기본값, 출력 인코딩, cleanup 실패 처리 | 게이트 실행기 구현 |
| `descriptive` 패턴 최소 수량(ADR-003의 "넓게") · 씨앗 "성공 repo" 선정 근거 기록 | M0 카탈로깅 스파이크 |
