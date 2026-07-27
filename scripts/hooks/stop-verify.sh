#!/bin/bash
# Stop hook — lint, build, test를 실행하되 hook JSON 채널인 stdout은 비워 둔다.
#
# 두 규격 차이: `stop_hook_active`는 **Claude Code 페이로드에만** 있다.
# Codex(.codex/hooks.json)도 이 스크립트를 물리지만 그쪽 Stop 페이로드에
# 대응 필드가 있는지 확인하지 못했다 — 없으면 아래 자가교정 1회 제한이
# Codex에서는 동작하지 않고 게이트가 매번 차단한다(= main의 옛 동작).
# 확인되지 않은 필드명을 추측해 넣지 않는다. Step 실행기는 Codex를 부르지
# 않고 Codex는 대화형으로만 쓰므로, 겉돌더라도 사람이 바로 끊을 수 있다.

INPUT=$(cat)

# 자가교정은 1회다. 이미 이 훅으로 한 번 이어붙였으면 게이트가 red여도 세션을
# 더 막지 않는다 — 계속 막으면 lint/build/test가 낫지 않을 때 세션이 끝나지 못하고
# 겉돌며, 할 일을 잃은 에이전트가 범위 밖 작업을 시작한다.
#
# 그렇다고 게이트를 건너뛰지는 않는다. red를 흔적 없이 통과시키면 성공 위장이다
# (ADR-008 — 실패는 정직하게 표면화). 막지 않되 stderr에 마커를 남긴다.
# 여기서 exit 2를 내면 `stop_hook_active`가 계속 참이라 무한루프이므로,
# 2회차의 실패 종료코드는 어떤 경로에서도 0이어야 한다.
if [ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ]; then
  BLOCK_ON_RED=0
else
  BLOCK_ON_RED=2
fi

fail() {
  if [ "$BLOCK_ON_RED" -eq 0 ]; then
    echo "GATE STILL RED: $1 — 자가교정 1회 후에도 게이트를 통과하지 못했습니다." >&2
  fi
  exit "$BLOCK_ON_RED"
}

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ]; then
  CWD=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
fi

cd "$CWD" || fail "작업 디렉터리로 이동하지 못했습니다: $CWD"

npm run lint >&2 &&
  npm run build >&2 &&
  npm run test >&2

STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  fail "lint/build/test 실패 (exit $STATUS)"
fi

exit 0
