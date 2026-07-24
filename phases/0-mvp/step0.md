# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — 프로젝트 정본 지침 (기술 스택·CRITICAL 규칙·개발 프로세스)
- `/docs/ARCHITECTURE.md` — 「제품 표면」·「디렉토리 구조」·「패턴」 절
- `/docs/PRD.md` — 「디자인」 절
- `/docs/UI_GUIDE.md` — 색상·컴포넌트 (이 step에서는 플레이스홀더에만 참고)

## 작업

Next.js 15 앱의 **스캐폴딩만** 만든다. 실제 기능 코드는 이후 step에서 작성한다.

### 1. 프로젝트 초기화

- Next.js 15 (App Router), TypeScript **strict**, Tailwind CSS, vitest.
- `tsconfig.json`: `"strict": true`, path alias `@/* → ./src/*`.
- 패키지 매니저는 `npm`을 쓴다 (`package-lock.json` 생성).

### 2. 디렉토리 구조

`/docs/ARCHITECTURE.md`의 「디렉토리 구조」를 그대로 만든다. 빈 디렉토리는 `.gitkeep`으로 유지한다:

```
src/
├── app/                # layout.tsx, page.tsx (플레이스홀더)
├── components/         # .gitkeep
├── lib/
│   ├── engine/         # .gitkeep
│   ├── catalog/        # .gitkeep
│   └── provenance/     # .gitkeep
├── services/           # .gitkeep
└── types/              # .gitkeep
catalog/                # .gitkeep (씨앗 패턴 JSON은 step 3에서 들어온다)
```

### 3. 스크립트

`package.json`에 아래 스크립트를 정의한다. **이 이름·동작은 AGENTS.md에 고정된 계약이다:**

```
dev    → next dev
build  → next build
lint   → next lint (또는 eslint)
test   → vitest run --passWithNoTests
```

`test`에 `--passWithNoTests`를 **반드시** 붙여라. 이유: 이 step에는 테스트가 스모크 하나뿐이고, 이후 step들이 각자 테스트를 추가하기 전까지 vitest가 "no test files"로 exit 1을 내면 Stop 훅(`lint && build && test`)이 매번 깨진다.

### 4. vitest 설정

- `vitest.config.ts`: `environment: "node"` (lib 로직은 Node 환경에서 검증한다. UI 컴포넌트 테스트는 이 phase 범위 밖).
- alias `@` 를 vitest에서도 해석하도록 설정한다 (`vite-tsconfig-paths` 또는 `resolve.alias`).

### 5. 플레이스홀더 페이지

- `src/app/layout.tsx`, `src/app/page.tsx` — 최소한의 다크 배경(`#0a0a0a`) 한 화면. 제목 텍스트 한 줄이면 충분하다.
- `src/app/globals.css` — Tailwind 지시자 + 페이지 배경.

### 6. 스모크 테스트

`src/__tests__/smoke.test.ts` 하나를 만든다 (`expect(true).toBe(true)` 수준). vitest·경로 alias가 실제로 도는지 확인하는 용도다.

### 7. .gitignore 확인

`/.gitignore`에 `node_modules/`, `.next/`, `.uptake/sources/`가 있는지 확인한다. **이미 있으면 건드리지 마라.** 없는 항목만 추가한다.

## Acceptance Criteria

```bash
npm install
npm run lint    # 에러 없음
npm run build   # 컴파일·빌드 성공 (플레이스홀더 페이지)
npm run test    # 스모크 통과 (--passWithNoTests)
```

## 검증 절차

1. 위 AC 커맨드를 순서대로 실행한다.
2. 아키텍처 체크리스트:
   - `/docs/ARCHITECTURE.md`의 디렉토리 구조와 일치하는가?
   - `tsconfig.json`의 `strict`가 `true`인가?
   - `package.json`의 스크립트 4종(dev/build/lint/test)이 AGENTS.md와 일치하는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 "스캐폴딩 완료 — Next.js 15/TS strict/Tailwind/vitest, 디렉토리 구조, npm scripts(dev/build/lint/test), 스모크 테스트" 형태로 산출물 요약
   - 3회 시도 후 실패 → `"status": "error"`, `"error_message"`에 구체적 에러
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"` 기록 후 중단

## 금지사항

- **UI 페이지를 실제로 구현하지 마라.** 이유: `/docs/UI_GUIDE.md`가 "잠정·미확정"이며 UI는 이 phase 범위 밖(엔진 코어만)이다. 플레이스홀더 한 화면이면 된다.
- **Anthropic SDK를 설치하지 마라.** 이유: 이 MVP는 INSTANTIATE·탐지를 결정적(고정 템플릿·규칙)으로 구현하기로 확정했다. LLM 의존성은 넣지 않는다.
- **`src/lib/**`, `src/services/**`, `src/types/**`에 기능 코드를 쓰지 마라.** 이유: 각 레이어는 이후 step에서 테스트-먼저로 만든다. 지금은 빈 디렉토리(`.gitkeep`)만.
- **`--passWithNoTests`를 빼지 마라.** 이유: 빼면 다음 step 전까지 Stop 훅이 매번 실패한다.
- 기존 테스트를 깨뜨리지 마라.
