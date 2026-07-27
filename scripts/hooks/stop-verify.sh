#!/bin/bash
# Stop hook — lint, build, test를 실행하되 hook JSON 채널인 stdout은 비워 둔다.

INPUT=$(cat)

# 이미 이 훅으로 한 번 이어붙였으면 게이트를 재실행하지 않는다(자가교정 1회).
# 가드가 없으면 lint/build/test가 계속 실패할 때 세션이 끝나지 못하고 겉돌며,
# 할 일을 잃은 에이전트가 범위 밖 작업을 시작한다.
if [ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ]; then
  CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
fi

cd "$CWD" || exit 2

npm run lint >&2 &&
  npm run build >&2 &&
  npm run test >&2

STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  exit 2
fi

exit 0
