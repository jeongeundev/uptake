# Step 0: approval-store

## 읽어야 할 파일

먼저 아래 파일들을 읽어라. 이 step은 이미 구현된 `apply`의 승인 결속 결함을 고친다:

- `/docs/ARCHITECTURE.md` — 「상태 관리」의 **"승인은 클라이언트 상태가 아니다"**(승인 레코드는 서버측에 남으며 최소한 타깃 경로·patternId·산출물 해시·타깃 base 해시·동결 argv에 결속된다. UI를 우회한 직접 API 호출로 미승인 적용이 일어나지 않는다)·「구현 중 결정」표의 **"승인의 서버측 결속"** 행. 이 step이 그 행을 확정한다.
- `/docs/PRD.md` — **AC-9**(승인=검증 산출물)·**AC-10**(타깃 쓰기는 사용자 승인 후에만, 승인 없는 경로에서 쓰기 호출 없음).
- `/AGENTS.md` — diff-미리보기-후-적용·개입 최소화.
- 기존 구현: `src/lib/engine/apply.ts`(수정 대상 — `applyGenerated`·`hashGenerated`·`hashTargetBase`·`ApprovalRecord`), `src/lib/engine/apply.test.ts`(갱신 대상), `src/lib/engine/verify.ts`(`hashGenerated`·`executeVerification`의 `awaiting-approval`).

## 배경 — 고쳐야 할 결함 (코드 리뷰에서 확인됨)

현재 `ApprovalRecord`는 **호출자가 직접 만들 수 있는 일반 구조체**다. `applyGenerated()`은 non-empty `patternId`/`frozenArgv`와 **호출자가 계산할 수 있는 해시**(`hashGenerated`·`hashTargetBase`)만 확인한다. 그래서 실제 사용자 승인 이벤트 없이도 레코드를 구성해 즉시 쓰기를 수행할 수 있다. 이는 AC-10("승인 없는 경로에서 쓰기 호출 자체가 없어야 한다")을 충족하지 못한다.

핵심: 승인은 **서버측 사실**이어야 하고, 적용은 **서버가 발급한 불투명 참조**로만 가능해야 한다. 호출자가 값 객체를 지어내 신뢰받는 경로를 없앤다.

## 작업

### 1. 서버측 승인 저장소 (`src/services/approval-store.ts`)

```ts
type StoredApproval = {
  patternId: string;
  targetRepoRoot: string;
  contentHash: string;      // 검증된 산출물 해시 (verify가 만든 값)
  targetBaseHash: string;   // 승인 시점 타깃 base 해시
  frozenArgv: string[];
  status: "pending" | "approved" | "consumed";
};

// 검증 성공(awaiting-approval) 직후 pending으로 등록하고 불투명 id를 발급한다.
function createApproval(input: Omit<StoredApproval, "status">): string; // verificationId

// 명시적 사용자 승인 이벤트. pending → approved.
function approveVerification(verificationId: string):
  | { ok: true }
  | { ok: false; reason: "unknown-approval" | "invalid-state" };

// apply 전용 조회·소비. approved만 반환하고, 반환 시 consumed로 전이(1회용).
function consumeApproved(verificationId: string):
  | { ok: true; approval: StoredApproval }
  | { ok: false; reason: "unknown-approval" | "not-approved" | "already-consumed" };
```

- 저장소는 **in-memory `Map`**이다. `verificationId`는 `crypto.randomUUID()`. 수명은 서버 프로세스 생명주기. (유예항목 "세션 저장 방식·수명"을 여기서 in-memory로 확정 — 로컬-우선이라 원격 저장소 없음. summary에 명시.)
- `createApproval`이 발급한 id만 유효하다. **호출자가 저장소 내용을 직접 만들거나 바꾸는 export를 두지 마라.**
- `consumeApproved`는 **approved 상태에서만** 성공하고, 성공 즉시 `consumed`로 바꿔 **재적용을 막는다**.
- 테스트를 위해 저장소를 비우는 내부 리셋 헬퍼는 둬도 되나, 승인 상태를 조작하는 공개 API는 두지 마라.

### 2. `applyGenerated`를 토큰 기반으로 변경 (`src/lib/engine/apply.ts`)

```ts
type ApplyResult =
  | { status: "completed"; written: string[] }
  | {
      status:
        | "diff-mismatch" | "apply-failed" | "base-changed"
        | "not-approved" | "unknown-approval";
      detail: string;
    };

// 값 객체가 아니라 서버가 발급한 verificationId로만 적용한다.
function applyGenerated(
  verificationId: string, files: GeneratedFile[], targetRepoRoot: string
): ApplyResult;
```

적용 규칙:
- `consumeApproved(verificationId)`로 승인 레코드를 조회한다. `unknown-approval`(미등록/위조)·`not-approved`(승인 안 됨)·`already-consumed`(재사용) → **쓰기 없이 거부**. (`not-approved`가 AC-10의 핵심 — approve를 안 거친 apply는 반드시 거부.)
- approved 레코드의 `contentHash`와 `hashGenerated(files)` 비교 → 불일치면 `diff-mismatch`(AC-9). `targetRepoRoot`도 레코드와 일치해야 한다.
- 레코드의 `targetBaseHash`와 `hashTargetBase(현재 타깃)` 비교 → 불일치면 `base-changed`.
- 기존의 신규-파일-only·경로 escape·부분 쓰기 롤백 로직은 **유지**한다.
- **거부 시에는 어떤 파일도 쓰지 않는다**(AC-10). `consumeApproved`가 소비로 전이한 뒤 해시 검사에서 거부되면 그 토큰은 소진된 것으로 둔다(재검증은 새 검증·승인으로).
- 값 객체 `ApprovalRecord`의 **공개 export는 제거**한다(저장소 내부 타입으로). 호출자가 승인 레코드를 만들 수 있는 표면을 없앤다.

### 3. 테스트 (`apply.test.ts` 갱신)

- **정상 경로**: `createApproval` → `approveVerification` → `applyGenerated(id)` → `completed`, 파일이 실제로 쓰임.
- **AC-10 핵심**: `createApproval` 후 **`approveVerification`을 생략**하고 `applyGenerated(id)` → `not-approved`, **쓰기 없음**.
- **위조/미등록** id → `unknown-approval`, 쓰기 없음.
- **재사용**: 성공 적용 후 같은 id 재적용 → `already-consumed`/거부, 쓰기 없음.
- **AC-9**: approve 후 산출물 변조 → `diff-mismatch`, 쓰기 없음.
- **base 변경**: approve 후 타깃 base 변경 → `base-changed`, 쓰기 없음.
- 적용은 fixture 타깃 **복사본**에 (원본 fixture 불변).

## Acceptance Criteria

```bash
npm run build
npm run test    # approval-store·apply 테스트 (AC-9·AC-10)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 승인이 **서버측 저장소**에만 존재하고, 호출자가 값 객체로 지어낼 수 없는가?
   - `approveVerification` **없이** `applyGenerated`가 호출되면 `not-approved`로 거부되고 **쓰기가 없는가**(AC-10)?
   - 승인 id가 **1회용**(consumed)인가?
   - 해시·base 검사가 유지되는가(AC-9)?
3. 결과에 따라 `phases/0-fix2/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/services/approval-store.ts(in-memory Map, createApproval/approveVerification/consumeApproved, verificationId=randomUUID, 1회용) + apply.ts를 verificationId 기반으로 변경. approve 없는 apply→not-approved 쓰기없음(AC-10), diff-mismatch/base-changed 유지(AC-9). ApprovalRecord 공개 export 제거. 승인 저장=in-memory·프로세스 수명 확정"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **호출자가 구성한 승인 값 객체를 신뢰하지 마라.** 이유: 그것이 정확히 AC-10을 뚫는 경로였다. 저장소가 유일한 진실원이다.
- **`approveVerification` 없이 쓰기가 가능한 경로를 남기지 마라.** 이유: AC-10. 승인은 명시적 이벤트여야 한다.
- **승인 id를 재사용 가능하게 두지 마라.** 이유: 한 번 승인·적용된 것을 재적용하면 base가 바뀐 뒤 미승인 쓰기가 될 수 있다.
- **`verify.ts`·`gate-runner.ts`·`instantiate.ts`를 바꾸지 마라.** 이유: 이번 step 범위는 승인 저장소와 apply뿐이다. `hashGenerated`는 verify의 것을 **재사용**한다(재구현 금지).
- 기존 테스트를 깨뜨리지 마라(새 API로 갱신은 허용).
