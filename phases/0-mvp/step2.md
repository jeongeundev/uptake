# Step 2: catalog-loader

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「패턴 스키마」·「두 층의 게이트」·「직렬화 계약」·「resolve 방법」 절 전체. **로드 거부 사유와 provenance resolve 규칙이 모두 여기 있다.**
- `/docs/PRD.md` — **MVP 수용 기준 표의 AC-1·AC-2·AC-2b·AC-3**. 이 step이 이 기준들을 테스트로 구현한다.
- `/docs/ADR.md` — ADR-005·009·012.
- `/AGENTS.md` — 두 층 게이트·provenance·환각 금지 CRITICAL 규칙.
- 이전 step 산출물: `src/types/pattern.ts` (Pattern 스키마 타입).

## 작업

**카탈로그 로더**를 만든다. 카탈로그의 **층 1(하드 게이트) — 로드 거부**를 구현한다. 근거 없는 패턴은 카탈로그에 **존재조차 할 수 없다**(ADR-009).

이 step은 **AC 자체를 테스트로 먼저 작성하고 통과시킨다**(dogfooding). 아래 각 로드 거부 사유마다 fixture를 만들고, 거부되는지 검사한다.

### 모듈 구성

- `src/lib/provenance/resolve.ts` — 소스 경로 resolve. 시그니처(내부 구현은 재량):
  ```ts
  type ResolveResult =
    | { ok: true; content: string }
    | { ok: false; reason: "provenance-unresolved" };

  // source root 아래에서 repository 식별자를 경로로 이어 붙여 찾고,
  // 고정 revision에서 path 파일 내용을 반환한다.
  function resolveProvenance(
    source: Source, provenance: Provenance, sourceRoot: string
  ): ResolveResult;
  ```
- `src/lib/catalog/load.ts` — 디렉토리에서 패턴 파일들을 로드하고 층 1 게이트를 적용. 시그니처:
  ```ts
  type LoadedPattern = { pattern: Pattern; generationEnabled: boolean };
  type RejectedPattern = { file: string; reason: string; detail?: string };
  type CatalogLoadResult = { loaded: LoadedPattern[]; rejected: RejectedPattern[] };

  function loadCatalog(catalogDir: string, sourceRoot: string): CatalogLoadResult;
  ```

### provenance resolve 규칙 (핵심 — 어기면 CRITICAL 위반)

`/docs/ARCHITECTURE.md`「resolve 방법」을 그대로 구현한다:

- source root는 환경변수 **`UPTAKE_SOURCE_ROOT`**, 미설정 시 기본값 **`./.uptake/sources`**.
- 로컬 위치 = source root + `repository` 식별자를 **그대로 이어 붙인** 경로. 예: root `./.uptake/sources` + `github.com/pytest-dev/pytest` → `./.uptake/sources/github.com/pytest-dev/pytest`.
- 파일 내용은 **`git show <revision>:<path>`로 읽는다. checkout 하지 마라.** 이유: 씨앗 repo의 작업 트리도 타깃과 마찬가지로 건드리지 않는다.
- **네트워크에 나가지 마라.** repo·revision·path 중 하나라도 로컬에서 resolve 안 되면 `provenance-unresolved`. clone·fetch 금지.
- 이어 붙인 경로가 source root를 **벗어나면(`..` 등) 거부**한다.
- resolve 성공 정의: repository가 로컬에 있고 + revision이 존재하며 + 그 revision에서 path가 실재 파일일 것. 셋 중 하나라도 실패 = resolve 실패.

### 층 1 — 로드 거부 사유 (전부 구현)

아래 중 하나라도 걸리면 그 패턴은 **로드하지 않는다**(`rejected`에 사유와 함께 담는다). `/docs/ARCHITECTURE.md`「층 1」과 AC-2를 정본으로 삼아라:

1. `provenance` 중 하나라도 resolve 실패.
2. 스키마 위반 — 필수 필드 누락, `schemaVersion` 불일치, `capability`↔`oracle` 유니온 위반.
3. `sources` 또는 `provenance`가 **빈 배열**.
4. 참조 무결성 **양방향**:
   - 정방향: `provenance[].sourceId`가 `sources`에 없음 / `provenance[].observedRole`이 `roles`에 없음.
   - 역방향 1: **고아 source** — 어떤 `provenance[].sourceId`에서도 참조되지 않는 `sources[].id`.
   - 역방향 2: **고아 role** — 어떤 `provenance[].observedRole`에서도 참조되지 않는 `roles[].id`.
5. `capability`↔`oracle` **양방향** 불일치 — `generative`인데 `oracle` 없음 / `descriptive`인데 `oracle` 있음.
6. `evidenceStatus` 선언과 데이터 불일치:
   - `corroborated`인데 (근거 파일이 달린 source 기준) distinct `independenceGroup` < 2 **또는** `isTargetStack: false`인 source가 하나도 없음 (AC-1).
   - `observed`인데 distinct `independenceGroup`이 1이 아님.
7. **역할 단위 대조 미달** (AC-2b) — `corroborated`인데 `roles` 중 어느 하나가 단일 `independenceGroup`의 provenance로만 뒷받침됨. **각 role이 서로 다른 `independenceGroup`의 provenance ≥2개**를 가져야 한다.

**독립성 카운트의 대상은 "근거 파일(provenance)이 연결된 source"뿐이다.** 고아 source는 이미 4번에서 거부되므로, 로드에 성공한 패턴에서는 모든 source가 실재 provenance를 가진다.

### 층 2 — 생성 점등 (여기서는 boolean만 계산)

로드된 패턴에 대해 `generationEnabled = (capability === "generative" && evidenceStatus === "corroborated")`를 계산해 `LoadedPattern.generationEnabled`에 담는다. **`observed`이거나 `descriptive`인 패턴도 로드는 되지만** `generationEnabled === false`다 (AC-3의 엔진 측 차단). 실제 UI 차단은 이 phase 밖이다.

### 유예 항목 확정 (이 step에서 결정)

`/docs/ARCHITECTURE.md`「구현 중 결정」표의 **"스키마 세부"** 행을 이 step에서 코드로 확정한다: ID 문자 제약·중복 금지, unknown field 처리, 경로 정규화, `schemaVersion` 미지원 거부, **파일 하나가 오류일 때 전체 로드를 실패시키지 않고 그 패턴만 `rejected`에 담는다**(다른 패턴은 계속 로드). 결정한 규칙을 summary에 명시하라. (docs는 수정하지 마라 — 아래 금지사항 참고.)

### 테스트 (AC를 테스트로)

- provenance resolve 테스트는 **임시 git repo fixture를 코드에서 생성**해 검증하라 (`git init` → 파일 커밋 → 그 SHA로 `git show`). **실제 씨앗 repo(`.uptake/sources/**`)에 의존하지 마라.** 이유: CI·헤드리스 환경에 씨앗이 없을 수 있고, 60MB repo를 테스트가 읽으면 느리다. 정상 resolve·revision 부재·path 부재·source root escape 각각을 fixture로 검사한다.
- 로드 거부 테스트는 **거부 사유별 fixture 패턴 JSON**을 각각 만들어 `loadCatalog`가 거부하는지 검사한다. AC-2가 요구하는 fixture를 반드시 포함: **더미-source fixture**(근거 파일 없는 source로 `independenceGroup`만 채운 것), **고아 role fixture**, `observed`인데 독립 그룹 0개·2개인 fixture, **role A는 그룹1에서만·role B는 그룹2에서만** 관찰된 fixture(AC-2b).
- 정상 로드 fixture 하나로 `loaded`에 담기고 `generationEnabled`가 올바른지 검사한다.

## Acceptance Criteria

```bash
npm run build   # 타입 컴파일 에러 없음
npm run test    # loader·resolve 테스트 전부 통과
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - resolve가 **네트워크에 나가지 않고**, **checkout 없이 `git show`**로만 읽는가?
   - source root escape(`..`)를 거부하는가?
   - 참조 무결성이 **양방향**(고아 source·고아 role 둘 다)인가?
   - `corroborated` 검사가 **패턴 전체 N≥2가 아니라 각 role별 N≥2**(AC-2b)인가?
   - 선언≠데이터를 **로드 거부**로 처리하고 조용히 강등·승급하지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/lib/catalog/load.ts + src/lib/provenance/resolve.ts — 층1 하드게이트(AC-1/2/2b) 로드 거부, git show 기반 provenance resolve, generationEnabled 계산. 스키마 세부 규칙: <확정한 내용 요약>. loadCatalog(dir, sourceRoot)/resolveProvenance(source, prov, root) 시그니처"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **조용한 강등·승급을 하지 마라.** 이유: 선언(`corroborated`)과 근거의 불일치는 **고쳐야 할 데이터 오류**이지 자동 보정 대상이 아니다(ADR-005). 엔진이 `observed`로 슬쩍 내리면 성공 위장의 사촌이 된다.
- **네트워크로 clone·fetch 하지 마라.** 이유: MVP는 로컬-우선·의존성 0. 씨앗은 사용자가 미리 받아둔다. 없으면 `provenance-unresolved`.
- **씨앗 repo를 checkout 하지 마라.** 이유: 작업 트리를 건드리면 안 된다. `git show <rev>:<path>`만 쓴다.
- **참조 무결성을 source에만 걸고 role에 안 걸지 마라.** 이유: 그러면 "관찰했다고 주장하는 역할"이 근거 없이 통과한다.
- **`docs/ARCHITECTURE.md`를 수정하지 마라.** 이유: 문서는 가드레일로 매 step 프롬프트에 주입된다. 유예 항목 확정 내용은 **코드와 summary로** 남기고, 문서 반영은 phase 완료 후 사람이 한다.
- **실제 씨앗 repo에 의존하는 테스트를 만들지 마라.** 이유: 위에 설명. 임시 git fixture를 써라.
- 기존 테스트를 깨뜨리지 마라.
