# Step 8: apply

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「VERIFY 실행 계약」의 승인·해시 부분·「상태 관리」의 **"승인은 클라이언트 상태가 아니다"**·「구현 중 결정」표의 **"hash 대상·알고리즘, 타깃 base 상태 확인, 부분 쓰기 롤백"·"승인의 서버측 결속"** 행. 이 step이 그 행들을 확정한다.
- `/docs/PRD.md` — **AC-9·AC-10**.
- `/AGENTS.md` — diff-미리보기-후-적용·개입 최소화 CRITICAL 규칙.
- 이전 step 산출물: `src/lib/engine/instantiate.ts`(`GeneratedFile[]`), **`src/lib/engine/verify.ts`(`awaiting-approval`의 `contentHash`·`frozenArgv`, `hashGenerated`)**, `catalog/spec-change-declaration-gate.json`, step 4 fixture 타깃.

## 작업

검증된 산출물을 **사용자 승인 후에만, 검증된 것과 동일함을 확인하고** 타깃 repo에 적용한다. UI는 이 phase 밖이므로 **서버측 순수 로직**으로 구현한다.

### 시그니처

`src/lib/engine/apply.ts`:
```ts
// 승인 레코드는 서버측 사실이다. 클라이언트 boolean이 아니라 검증 산출물에 결속된다.
type ApprovalRecord = {
  patternId: string;
  targetRepoRoot: string;
  contentHash: string;    // step 7에서 검증된 산출물의 내용 해시
  targetBaseHash: string; // 승인 시점 타깃 base 상태 해시
  frozenArgv: string[];   // 검증에 쓰인 동결 argv
};

type ApplyResult =
  | { status: "completed"; written: string[] }
  | { status: "diff-mismatch" | "apply-failed" | "base-changed"; detail: string };

function applyGenerated(
  approval: ApprovalRecord, files: GeneratedFile[], targetRepoRoot: string
): ApplyResult;
```

해시는 **step 7의 `hashGenerated`를 재사용**한다 — 검증 해시와 적용 직전 재계산 해시가 **동일한 알고리즘·직렬화**여야 한다. 다시 구현하지 마라(공유 유틸).

### 적용 규칙 (CRITICAL)

- **승인된 diff = 검증된 diff (AC-9).** 적용 직전 `hashGenerated(files)`를 재계산해 `approval.contentHash`와 비교한다. 불일치면 `diff-mismatch`로 **적용을 거부**한다. 재생성으로 "다시 만들어 적용"하지 마라.
- **타깃 base 확인.** 적용 직전 타깃 base 상태 해시를 재계산해 `approval.targetBaseHash`와 비교한다. 승인 이후 타깃이 바뀌었으면 `base-changed`로 거부한다(검증 전제가 무너졌으므로).
- **승인 없는 쓰기 없음 (AC-10).** `applyGenerated`는 `ApprovalRecord`를 **필수 인자**로 받으며, 유효한 승인·해시 일치 없이는 어떤 파일도 쓰지 않는다. 승인 레코드를 우회해 파일을 쓰는 경로가 존재하면 안 된다.
- **부분 쓰기 롤백.** 여러 파일을 쓰다 중간 실패하면 이미 쓴 신규 파일을 삭제해 원상 복구하고 `apply-failed`를 반환한다. 이 phase 생성물은 신규 파일뿐이므로 롤백 = 생성한 파일 제거다.

### 유예 항목 확정 (이 step에서 결정)

`/docs/ARCHITECTURE.md`「구현 중 결정」표의 다음을 코드로 확정하고 summary에 명시(docs 수정 금지):
- **hash 대상·알고리즘** — step 7의 `hashGenerated`와 동일함을 확인(예: SHA-256 over 정렬된 `GeneratedFile` path+content 직렬화).
- **타깃 base 상태 확인** 방식.
- **부분 쓰기 실패 롤백** 방식.
- **승인의 서버측 결속** — 이 phase에서는 `ApprovalRecord`가 산출물 해시·base 해시·argv에 결속된 값 객체임을 확정한다. 세션/토큰 수명·다중 탭·API route 노출은 **UI phase(phase 1)로 유예**하고, 그 사실을 summary에 남긴다.

### 테스트 (AC-9·AC-10을 테스트로)

- **AC-9**: 승인 산출물 == 검증 산출물(해시 일치) → `completed`, 파일이 타깃에 실제로 쓰임. 산출물을 변조(해시 불일치)한 경우 → `diff-mismatch`, **쓰기 없음**.
- **AC-10**: 승인 레코드가 없거나 위조된(해시 불일치) 경로에서 **어떤 파일도 쓰이지 않음**을 검사한다. base가 바뀐 경우 `base-changed`로 거부하고 쓰기 없음.
- 적용은 fixture 타깃 **복사본**에 대해 수행하라(원본 fixture를 변경하지 마라 — 테스트 격리).

### (선택) 엔진 파이프라인 통합 스모크

씨앗(`.uptake/sources/`)이 있는 환경에서, 로드→탐지→생성→검증→적용을 함수 호출로 엮는 통합 테스트를 하나 추가하면 좋다(AC-11의 엔진 부분 선증명). 씨앗 부재 시 `test.skip`. **UI를 포함한 완전한 E2E(AC-11)는 이 phase 밖이다.**

## Acceptance Criteria

```bash
npm run build
npm run test    # apply 테스트 (AC-9·AC-10) + 기존 전부
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 적용 직전 **해시 재확인**으로 검증≠승인을 거부하는가(AC-9)?
   - 승인 레코드 없이 쓰는 경로가 **없는가**(AC-10)?
   - `hashGenerated`가 step 7 검증 해시와 **같은 방식**인가(재사용)?
   - 부분 실패 시 롤백하는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "src/lib/engine/apply.ts — applyGenerated(approval, files, targetRoot): 해시 재확인(diff-mismatch)·base 확인(base-changed)·승인결속(AC-10)·부분쓰기 롤백. hashGenerated 공유유틸(step7과 동일). ApprovalRecord=산출물해시+base해시+argv 결속. 세션/토큰·API route는 phase1 유예. AC-9/10 통과"
   - 실패 → `"status": "error"` + `"error_message"`
   - 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- **해시 불일치인데 재생성해서 적용하지 마라.** 이유: 승인된 것과 다른 것을 쓰는 것이다. 불일치는 `diff-mismatch`로 거부한다(AC-9).
- **승인 레코드를 우회해 파일을 쓰지 마라.** 이유: UI를 우회한 직접 호출로 미승인 적용이 일어나면 AC-10 위반이다. 승인은 클라이언트 boolean이 아니라 서버측 결속이다.
- **API route·server action·세션 토큰 모델을 지금 만들지 마라.** 이유: UI가 이 phase 밖이라 노출 계층은 죽은 코드가 된다. 순수 lib 함수로 두고 phase 1에서 얇게 감싼다.
- **step 7의 해시 로직을 다시 구현하지 마라.** 이유: 두 해시가 어긋나면 정상 산출물이 `diff-mismatch`가 된다. 공유 유틸을 재사용하라.
- **원본 fixture 타깃을 변경하지 마라.** 이유: 적용은 복사본에. 테스트 격리.
- 기존 테스트를 깨뜨리지 마라.
