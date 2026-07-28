#!/bin/bash
# Phase 최종 검증 — E2E 회귀.
#
# step 종료마다 도는 `hooks/stop-verify.sh`(lint/build/test)와 **분리된 게이트**다.
# E2E는 프로덕션 빌드 두 번과 브라우저를 띄우므로 step마다 돌리면 phase 하나가
# 몇 시간이 된다. 회귀는 step 경계가 아니라 phase 경계에서 잡는다.
#
# 호출자는 둘이며 **정의는 이 파일 하나다**:
#   - `scripts/execute.py` — phase의 모든 step이 통과한 뒤 1회
#   - CI — 워크플로우에서 `bash scripts/final-verify.sh`
# 명령을 늘릴 일이 생기면 여기에만 추가한다. 호출자에 복사하지 마라.
#
# 종료코드는 `npm run test:e2e`의 것을 그대로 흘려보낸다: 0 = green, 그 외 = red.
# 이 스크립트 자신은 판정하지 않는다 — 판정을 두 곳에 두면 갈라진다.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

npm run test:e2e
