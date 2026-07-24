#!/bin/bash
# Stop hook — lint, build, test를 실행하되 hook JSON 채널인 stdout은 비워 둔다.

INPUT=$(cat)
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
