"""최종 검증 스크립트(scripts/final-verify.sh)의 계약을 검증한다.

step 종료 훅(stop-verify.sh)과 역할이 겹치지 않아야 한다 — 여기서 lint/build/test를
다시 돌리면 phase 경계에서 같은 게이트를 두 번 돌리는 것이고, 반대로 stop-verify가
E2E를 돌리면 step마다 브라우저가 뜬다. 두 방향 모두 검사한다.
"""

import os
import subprocess
from pathlib import Path


SCRIPT = Path(__file__).parent / "final-verify.sh"
REPO_ROOT = SCRIPT.parent.parent


def _run(tmp_path, npm_body, cwd=None):
    """npm을 스텁으로 갈아끼우고 스크립트를 실행한다. (result, calls_file) 반환."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text("#!/bin/sh\n" + npm_body, encoding="utf-8")
    npm.chmod(0o755)

    calls = tmp_path / "calls"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FINAL_VERIFY_CALLS": str(calls),
    }
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd) if cwd else None,
    )
    return result, calls


def test_runs_e2e_and_exits_zero(tmp_path):
    result, calls = _run(tmp_path, 'echo "$*" >> "$FINAL_VERIFY_CALLS"\n')

    assert result.returncode == 0
    assert calls.read_text(encoding="utf-8").splitlines() == ["run test:e2e"]


def test_does_not_repeat_the_step_gate(tmp_path):
    """lint/build/test는 step 종료 훅의 몫이다 — phase 경계에서 다시 돌리지 않는다."""
    _, calls = _run(tmp_path, 'echo "$*" >> "$FINAL_VERIFY_CALLS"\n')

    ran = calls.read_text(encoding="utf-8").splitlines()
    assert "run lint" not in ran
    assert "run build" not in ran
    assert "run test" not in ran   # "run test:e2e"와 구분된다


def test_propagates_failure_exit_code(tmp_path):
    """스크립트는 판정하지 않는다 — 판정을 두 곳에 두면 갈라진다."""
    result, _ = _run(tmp_path, 'echo "$*" >> "$FINAL_VERIFY_CALLS"\nexit 1\n')

    assert result.returncode == 1


def test_runs_from_repo_root_regardless_of_cwd(tmp_path):
    """실행기·CI가 서로 다른 cwd에서 부른다 — 스크립트가 루트를 스스로 잡는다."""
    _, calls = _run(tmp_path, 'pwd >> "$FINAL_VERIFY_CALLS"\n', cwd=tmp_path)

    assert calls.read_text(encoding="utf-8").strip() == str(REPO_ROOT)


def test_stop_hook_does_not_run_e2e():
    """반대 방향 — step 종료 훅에 E2E가 새어 들어가면 step마다 브라우저가 뜬다."""
    stop_hook = (Path(__file__).parent / "hooks" / "stop-verify.sh").read_text(
        encoding="utf-8"
    )

    assert "test:e2e" not in stop_hook
