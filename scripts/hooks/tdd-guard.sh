#!/bin/bash
# TDD Guard Hook — PreToolUse
# 구현 코드를 작성하려 할 때, 해당 모듈의 테스트 파일이 먼저 존재하는지 체크.
# 테스트 없이 구현 코드를 작성하려 하면 차단.
#
# 두 에이전트의 payload 규격을 모두 받는다:
#   Codex  — tool_name=apply_patch, tool_input.command 에 패치 텍스트
#            (문자열일 수도, ["apply_patch", "<patch>"] 배열일 수도 있다.)
#            대상 경로는 패치 봉투의 헤더 라인에서 뽑아내며 cwd 기준 상대경로다.
#   Claude — tool_name=Edit|Write, tool_input.file_path 에 절대경로

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ]; then
  CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
fi

# 대상 파일 목록과 그 경로가 상대경로인지를 규격별로 결정한다.
case "$TOOL_NAME" in
  apply_patch)
    PATCH=$(echo "$INPUT" | jq -r '
      .tool_input.command
      | if type == "array" then join("\n") else (. // "") end
    ')
    # "*** Add File: path" / "*** Update File: path" 에서 경로만 추출.
    # Delete File은 코드가 사라지는 것이므로 검사 대상이 아니다.
    FILES=$(echo "$PATCH" | sed -n -E 's/^\*\*\* (Add|Update) File: (.*)$/\2/p')
    PATHS_ARE_RELATIVE=true
    ;;
  Edit|Write)
    FILES=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    PATHS_ARE_RELATIVE=false
    ;;
  *)
    exit 0
    ;;
esac

if [ -z "$FILES" ]; then
  exit 0
fi

# 이 파일이 테스트를 요구하는가? 요구하는데 테스트가 없으면 0(=차단) 반환.
#   $1 = 메시지에 표시할 경로
#   $2 = 파일 존재 확인에 쓸 절대 경로
needs_test() {
  FILE_PATH="$1"
  ABS_PATH="$2"
  # 파일명 기준으로 볼 규칙과 경로 기준으로 볼 규칙을 나눈다.
  # 경로 전체에 *test* 를 매칭하면 'latest/' 같은 디렉토리명에 통째로 뚫린다.
  FILE_NAME=$(basename "$FILE_PATH")

  # 테스트 파일 자체를 작성하는 건 허용
  case "$FILE_NAME" in
    *test*|*spec*) return 1 ;;
  esac
  case "$FILE_PATH" in
    *__tests__*) return 1 ;;
  esac

  # 설정/타입/스타일 파일은 테스트 불필요 — 허용
  case "$FILE_NAME" in
    *.json|*.css|*.scss|*.md|*.yml|*.yaml|*.env*|*.config.*|*tailwind*|*postcss*|*next.config*|*tsconfig*) return 1 ;;
  esac

  # types/ 폴더는 테스트 불필요 — 허용
  case "$FILE_PATH" in
    types/*|*/types/*|*/types.ts|*/types.d.ts) return 1 ;;
  esac

  # Next.js 프레임워크 파일은 허용 (layout, page, loading, error, not-found, global styles)
  case "$FILE_PATH" in
    */layout.tsx|*/layout.ts|*/page.tsx|*/page.ts|*/loading.tsx|*/error.tsx|*/not-found.tsx|*/globals.css) return 1 ;;
  esac

  # JS/TS 소스가 아니면 이 가드의 대상이 아니다
  case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx) ;;
    *) return 1 ;;
  esac

  DIR=$(dirname "$ABS_PATH")
  BASENAME=$(basename "$ABS_PATH" | sed -E 's/\.(ts|tsx|js|jsx)$//')
  PARENT=$(dirname "$DIR")

  for EXT in ts tsx js jsx; do
    # 같은 폴더에 .test / .spec 파일
    [ -f "${DIR}/${BASENAME}.test.${EXT}" ] && return 1
    [ -f "${DIR}/${BASENAME}.spec.${EXT}" ] && return 1
    # __tests__ 폴더 (같은 레벨 / 상위 레벨)
    [ -f "${DIR}/__tests__/${BASENAME}.test.${EXT}" ] && return 1
    [ -f "${PARENT}/__tests__/${BASENAME}.test.${EXT}" ] && return 1
    # src/__tests__/ 루트 테스트 폴더
    [ -f "${CWD}/src/__tests__/${BASENAME}.test.${EXT}" ] && return 1
  done

  return 0
}

MISSING=""
while IFS= read -r FILE_PATH; do
  [ -z "$FILE_PATH" ] && continue
  if [ "$PATHS_ARE_RELATIVE" = true ]; then
    ABS_PATH="${CWD}/${FILE_PATH}"
  else
    ABS_PATH="$FILE_PATH"
  fi
  if needs_test "$FILE_PATH" "$ABS_PATH"; then
    MISSING="${MISSING}${MISSING:+, }${FILE_PATH}"
  fi
done <<EOF
$FILES
EOF

if [ -n "$MISSING" ]; then
  REASON="TDD GUARD: '${MISSING}'에 대한 테스트 파일이 존재하지 않습니다. 구현 코드를 작성하기 전에 테스트를 먼저 작성하세요. (테스트 파일 예: foo.test.ts)"
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
fi

exit 0
