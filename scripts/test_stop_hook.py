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


def test_stop_hook_active_surfaces_red_without_blocking(tmp_path):
    """자가교정 1회 후에는 세션을 막지 않되, red를 조용히 통과시키지 않는다.

    계속 막으면 lint/build/test가 낫지 않을 때 세션이 끝나지 못하고 겉돌며,
    할 일을 잃은 에이전트가 범위 밖 작업을 시작한다. 그렇다고 게이트를 건너뛰면
    red가 흔적 없이 green이 된다 — 성공 위장이다(ADR-008).
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text(
        "#!/bin/sh\n"
        'echo "$*" >> "$STOP_HOOK_CALLS"\n'
        "exit 1\n",
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
        input=json.dumps(
            {"hook_event_name": "Stop", "cwd": str(tmp_path), "stop_hook_active": True}
        ),
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0          # 세션을 막지 않는다
    assert result.stdout == ""             # hook JSON 채널은 비어 있다
    assert "GATE STILL RED" in result.stderr   # 실패는 표면화된다
    assert calls.read_text(encoding="utf-8").splitlines() == ["run lint"]


def test_payload_without_stop_hook_active_blocks(tmp_path):
    """`stop_hook_active`가 없는 페이로드(Codex 규격 포함)는 1회차로 취급한다.

    필드가 없으면 자가교정 제한이 걸리지 않고 게이트가 차단한다 — 안전한 쪽이다.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    npm.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}

    result = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps({"hook_event_name": "Stop", "cwd": str(tmp_path)}),
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 2
    assert result.stdout == ""
    assert "GATE STILL RED" not in result.stderr   # 차단했으므로 마커는 붙지 않는다


def test_stop_hook_active_green_leaves_no_marker(tmp_path):
    """자가교정이 실제로 통했으면 마커를 남기지 않는다 — 마커가 항상 붙으면 신호가 죽는다."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text(
        "#!/bin/sh\n"
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

    result = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps(
            {"hook_event_name": "Stop", "cwd": str(tmp_path), "stop_hook_active": True}
        ),
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert "GATE STILL RED" not in result.stderr
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "run lint",
        "run build",
        "run test",
    ]


def test_stop_hook_active_never_exits_2(tmp_path):
    """2회차에서는 어떤 실패도 exit 2를 내면 안 된다.

    `stop_hook_active`는 한 번 참이 되면 계속 참이므로, 여기서 막으면 무한루프다.
    """
    result = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps(
            {
                "hook_event_name": "Stop",
                "cwd": str(tmp_path / "does-not-exist"),
                "stop_hook_active": True,
            }
        ),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert result.stdout == ""
    assert "GATE STILL RED" in result.stderr


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
