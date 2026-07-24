"""
tdd-guard.sh (PreToolUse 훅) 자기검증.

이 훅은 두 규격을 모두 받는다:
- Codex   — tool_name=apply_patch, 패치 텍스트가 tool_input.command
- Claude  — tool_name=Edit|Write,  절대경로가 tool_input.file_path

양성: 테스트가 있는/불필요한 편집은 통과해야 한다 (green).
음성: 테스트 없는 구현 코드 편집은 반드시 deny로 잡혀야 한다 (red).
green만으로는 가드가 살아있다는 증명이 되지 않는다.
"""

import json
import subprocess
from pathlib import Path

import pytest

GUARD = Path(__file__).parent / "hooks" / "tdd-guard.sh"


def run_guard(cwd: Path, patch_body: str, *, tool_name: str = "apply_patch",
              command_as_list: bool = True) -> dict:
    """훅에 PreToolUse payload를 흘려넣고 (exit code, stdout) 를 돌려준다."""
    patch = f"*** Begin Patch\n{patch_body}*** End Patch"
    command = ["apply_patch", patch] if command_as_list else patch
    payload = {
        "hook_event_name": "PreToolUse",
        "tool_name": tool_name,
        "cwd": str(cwd),
        "tool_input": {"command": command},
    }
    r = subprocess.run(
        ["bash", str(GUARD)],
        input=json.dumps(payload), capture_output=True, text=True,
    )
    return {"code": r.returncode, "out": r.stdout, "err": r.stderr}


def run_guard_claude(file_path: Path, *, tool_name: str = "Write") -> dict:
    """Claude Code 규격(Edit|Write + file_path) payload를 흘려넣는다."""
    payload = {
        "hook_event_name": "PreToolUse",
        "tool_name": tool_name,
        "tool_input": {"file_path": str(file_path)},
    }
    r = subprocess.run(
        ["bash", str(GUARD)],
        input=json.dumps(payload), capture_output=True, text=True,
    )
    return {"code": r.returncode, "out": r.stdout, "err": r.stderr}


def is_denied(result: dict) -> bool:
    if not result["out"].strip():
        return False
    data = json.loads(result["out"])
    return data["hookSpecificOutput"]["permissionDecision"] == "deny"


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "src" / "lib").mkdir(parents=True)
    return tmp_path


# ---------------------------------------------------------------------------
# 음성 — 테스트 없는 구현 코드는 반드시 차단된다
# ---------------------------------------------------------------------------

class TestBlocksUntestedCode:
    def test_add_file_without_test_is_denied(self, repo):
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n")
        assert is_denied(r)
        assert "parser" in r["out"]

    def test_update_file_without_test_is_denied(self, repo):
        (repo / "src" / "lib" / "parser.ts").write_text("export const a = 1;")
        r = run_guard(repo, "*** Update File: src/lib/parser.ts\n@@\n-1\n+2\n")
        assert is_denied(r)

    def test_tsx_without_test_is_denied(self, repo):
        r = run_guard(repo, "*** Add File: src/lib/Widget.tsx\n+export const W = () => null;\n")
        assert is_denied(r)

    def test_one_bad_file_among_many_is_denied(self, repo):
        (repo / "src" / "lib" / "ok.test.ts").write_text("test('x', () => {})")
        body = (
            "*** Add File: src/lib/ok.ts\n+export const ok = 1;\n"
            "*** Add File: src/lib/bad.ts\n+export const bad = 1;\n"
        )
        r = run_guard(repo, body)
        assert is_denied(r)
        assert "bad" in r["out"]

    def test_command_as_plain_string_is_denied(self, repo):
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n",
                      command_as_list=False)
        assert is_denied(r)

    def test_dir_named_like_test_does_not_exempt(self, repo):
        # 'latest' 같은 디렉토리명에 test가 섞여 있다고 면제되면 안 된다.
        r = run_guard(repo, "*** Add File: latest/parser.ts\n+export const a = 1;\n")
        assert is_denied(r)


# ---------------------------------------------------------------------------
# 양성 — 테스트가 있거나 불필요한 편집은 통과한다
# ---------------------------------------------------------------------------

class TestAllowsTestedOrExempt:
    def test_sibling_test_file_allows(self, repo):
        (repo / "src" / "lib" / "parser.test.ts").write_text("test('x', () => {})")
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n")
        assert not is_denied(r)

    def test_sibling_spec_file_allows(self, repo):
        (repo / "src" / "lib" / "parser.spec.ts").write_text("test('x', () => {})")
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n")
        assert not is_denied(r)

    def test_tests_dir_allows(self, repo):
        (repo / "src" / "lib" / "__tests__").mkdir()
        (repo / "src" / "lib" / "__tests__" / "parser.test.ts").write_text("test('x', () => {})")
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n")
        assert not is_denied(r)

    def test_root_tests_dir_allows(self, repo):
        (repo / "src" / "__tests__").mkdir()
        (repo / "src" / "__tests__" / "parser.test.ts").write_text("test('x', () => {})")
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n")
        assert not is_denied(r)

    def test_writing_a_test_file_allows(self, repo):
        r = run_guard(repo, "*** Add File: src/lib/parser.test.ts\n+test('x', () => {})\n")
        assert not is_denied(r)

    def test_markdown_allows(self, repo):
        r = run_guard(repo, "*** Add File: docs/NOTES.md\n+hello\n")
        assert not is_denied(r)

    def test_config_file_allows(self, repo):
        r = run_guard(repo, "*** Add File: next.config.ts\n+export default {};\n")
        assert not is_denied(r)

    def test_types_dir_allows(self, repo):
        r = run_guard(repo, "*** Add File: src/types/pattern.ts\n+export type P = string;\n")
        assert not is_denied(r)

    def test_nextjs_page_allows(self, repo):
        r = run_guard(repo, "*** Add File: src/app/page.tsx\n+export default () => null;\n")
        assert not is_denied(r)

    def test_delete_file_allows(self, repo):
        r = run_guard(repo, "*** Delete File: src/lib/parser.ts\n")
        assert not is_denied(r)

    def test_python_file_allows(self, repo):
        r = run_guard(repo, "*** Add File: scripts/tool.py\n+x = 1\n")
        assert not is_denied(r)

    def test_non_patch_tool_allows(self, repo):
        r = run_guard(repo, "*** Add File: src/lib/parser.ts\n+export const a = 1;\n",
                      tool_name="Bash")
        assert not is_denied(r)

    def test_empty_payload_allows(self):
        r = subprocess.run(["bash", str(GUARD)], input="{}",
                           capture_output=True, text=True)
        assert r.returncode == 0
        assert not r.stdout.strip()


# ---------------------------------------------------------------------------
# Claude Code 규격 (Edit|Write + file_path) — 같은 가드가 양쪽을 막아야 한다
# ---------------------------------------------------------------------------

class TestClaudePayload:
    def test_write_without_test_is_denied(self, repo):
        r = run_guard_claude(repo / "src" / "lib" / "parser.ts")
        assert is_denied(r)
        assert "parser" in r["out"]

    def test_edit_without_test_is_denied(self, repo):
        r = run_guard_claude(repo / "src" / "lib" / "parser.ts", tool_name="Edit")
        assert is_denied(r)

    def test_sibling_test_file_allows(self, repo):
        (repo / "src" / "lib" / "parser.test.ts").write_text("test('x', () => {})")
        r = run_guard_claude(repo / "src" / "lib" / "parser.ts")
        assert not is_denied(r)

    def test_tests_dir_allows(self, repo):
        (repo / "src" / "lib" / "__tests__").mkdir()
        (repo / "src" / "lib" / "__tests__" / "parser.test.ts").write_text("test('x', () => {})")
        r = run_guard_claude(repo / "src" / "lib" / "parser.ts")
        assert not is_denied(r)

    def test_writing_a_test_file_allows(self, repo):
        r = run_guard_claude(repo / "src" / "lib" / "parser.test.ts")
        assert not is_denied(r)

    def test_markdown_allows(self, repo):
        r = run_guard_claude(repo / "docs" / "NOTES.md")
        assert not is_denied(r)

    def test_types_dir_allows(self, repo):
        r = run_guard_claude(repo / "src" / "types" / "pattern.ts")
        assert not is_denied(r)

    def test_nextjs_page_allows(self, repo):
        r = run_guard_claude(repo / "src" / "app" / "page.tsx")
        assert not is_denied(r)

    def test_python_file_allows(self, repo):
        r = run_guard_claude(repo / "scripts" / "tool.py")
        assert not is_denied(r)
