"""Stop hook의 stdout 계약을 검증한다."""

import json
import os
import subprocess
from pathlib import Path


HOOK = Path(__file__).parent / "hooks" / "stop-verify.sh"


def test_success_keeps_stdout_empty(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text(
        "#!/bin/sh\n"
        'echo "npm $*"\n'
        'echo "$*" >> "$STOP_HOOK_CALLS"\n',
        encoding="utf-8",
    )
    npm.chmod(0o755)
    calls = tmp_path / "calls"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "STOP_HOOK_CALLS": str(calls),
    }
    payload = json.dumps({"hook_event_name": "Stop", "cwd": str(tmp_path)})

    result = subprocess.run(
        ["bash", str(HOOK)],
        input=payload,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "run lint",
        "run build",
        "run test",
    ]


def test_failure_blocks_without_writing_non_json_stdout(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text(
        "#!/bin/sh\n"
        'echo "$*" >> "$STOP_HOOK_CALLS"\n'
        'echo "npm $*"\n'
        '[ "$*" = "run build" ] && exit 1\n'
        "exit 0\n",
        encoding="utf-8",
    )
    npm.chmod(0o755)
    calls = tmp_path / "calls"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "STOP_HOOK_CALLS": str(calls),
    }

    result = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps({"hook_event_name": "Stop", "cwd": str(tmp_path)}),
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 2
    assert result.stdout == ""
    assert "npm run build" in result.stderr
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "run lint",
        "run build",
    ]
