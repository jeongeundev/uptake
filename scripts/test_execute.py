"""
execute.py 리팩터링 안전망 테스트.
리팩터링 전후 동작이 동일한지 검증한다.
"""

import contextlib
import json
import os
import subprocess
import sys
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import execute as ex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_project(tmp_path):
    """phases/, AGENTS.md, docs/ 를 갖춘 임시 프로젝트 구조."""
    phases_dir = tmp_path / "phases"
    phases_dir.mkdir()

    agents_md = tmp_path / "AGENTS.md"
    agents_md.write_text("# Rules\n- rule one\n- rule two")

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "arch.md").write_text("# Architecture\nSome content")
    (docs_dir / "guide.md").write_text("# Guide\nAnother doc")

    return tmp_path


@pytest.fixture
def phase_dir(tmp_project):
    """step 3개를 가진 phase 디렉토리."""
    d = tmp_project / "phases" / "0-mvp"
    d.mkdir()

    index = {
        "project": "TestProject",
        "phase": "mvp",
        "steps": [
            {"step": 0, "name": "setup", "status": "completed", "summary": "프로젝트 초기화 완료"},
            {"step": 1, "name": "core", "status": "completed", "summary": "핵심 로직 구현"},
            {"step": 2, "name": "ui", "status": "pending"},
        ],
    }
    (d / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    (d / "step2.md").write_text("# Step 2: UI\n\nUI를 구현하세요.")

    return d


@pytest.fixture
def top_index(tmp_project):
    """phases/index.json (top-level)."""
    top = {
        "phases": [
            {"dir": "0-mvp", "status": "pending"},
            {"dir": "1-polish", "status": "pending"},
        ]
    }
    p = tmp_project / "phases" / "index.json"
    p.write_text(json.dumps(top, indent=2))
    return p


@pytest.fixture
def executor(tmp_project, phase_dir):
    """테스트용 StepExecutor 인스턴스. git 호출은 별도 mock 필요."""
    with patch.object(ex, "ROOT", tmp_project):
        inst = ex.StepExecutor("0-mvp")
    # 내부 경로를 tmp_project 기준으로 재설정
    inst._root = str(tmp_project)
    inst._phases_dir = tmp_project / "phases"
    inst._phase_dir = phase_dir
    inst._phase_dir_name = "0-mvp"
    inst._index_file = phase_dir / "index.json"
    inst._top_index_file = tmp_project / "phases" / "index.json"
    return inst


# ---------------------------------------------------------------------------
# _stamp (= 이전 now_iso)
# ---------------------------------------------------------------------------

class TestStamp:
    def test_returns_kst_timestamp(self, executor):
        result = executor._stamp()
        assert "+0900" in result

    def test_format_is_iso(self, executor):
        result = executor._stamp()
        dt = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert dt.tzinfo is not None

    def test_is_current_time(self, executor):
        before = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0)
        result = executor._stamp()
        after = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0) + timedelta(seconds=1)
        parsed = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert before <= parsed <= after


# ---------------------------------------------------------------------------
# _read_json / _write_json
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    def test_roundtrip(self, tmp_path):
        data = {"key": "값", "nested": [1, 2, 3]}
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, data)
        loaded = ex.StepExecutor._read_json(p)
        assert loaded == data

    def test_save_ensures_ascii_false(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"한글": "테스트"})
        raw = p.read_text()
        assert "한글" in raw
        assert "\\u" not in raw

    def test_save_indented(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"a": 1})
        raw = p.read_text()
        assert "\n" in raw

    def test_load_nonexistent_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            ex.StepExecutor._read_json(tmp_path / "nope.json")


# ---------------------------------------------------------------------------
# _load_guardrails
# ---------------------------------------------------------------------------

class TestLoadGuardrails:
    def test_loads_agents_md_and_docs(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "# Rules" in result
        assert "rule one" in result
        assert "# Architecture" in result
        assert "# Guide" in result

    def test_sections_separated_by_divider(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "---" in result

    def test_docs_sorted_alphabetically(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        arch_pos = result.index("arch")
        guide_pos = result.index("guide")
        assert arch_pos < guide_pos

    def test_no_agents_md(self, executor, tmp_project):
        (tmp_project / "AGENTS.md").unlink()
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "AGENTS.md" not in result
        assert "Architecture" in result

    def test_no_docs_dir(self, executor, tmp_project):
        import shutil
        shutil.rmtree(tmp_project / "docs")
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "Rules" in result
        assert "Architecture" not in result

    def test_empty_project(self, tmp_path):
        with patch.object(ex, "ROOT", tmp_path):
            # executor가 필요 없는 static-like 동작이므로 임시 인스턴스
            phases_dir = tmp_path / "phases" / "dummy"
            phases_dir.mkdir(parents=True)
            idx = {"project": "T", "phase": "t", "steps": []}
            (phases_dir / "index.json").write_text(json.dumps(idx))
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
            result = inst._load_guardrails()
        assert result == ""


# ---------------------------------------------------------------------------
# _build_step_context
# ---------------------------------------------------------------------------

class TestBuildStepContext:
    def test_includes_completed_with_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "Step 0 (setup): 프로젝트 초기화 완료" in result
        assert "Step 1 (core): 핵심 로직 구현" in result

    def test_excludes_pending(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "ui" not in result

    def test_excludes_completed_without_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        del index["steps"][0]["summary"]
        result = ex.StepExecutor._build_step_context(index)
        assert "setup" not in result
        assert "core" in result

    def test_empty_when_no_completed(self):
        index = {"steps": [{"step": 0, "name": "a", "status": "pending"}]}
        result = ex.StepExecutor._build_step_context(index)
        assert result == ""

    def test_has_header(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert result.startswith("## 이전 Step 산출물")


# ---------------------------------------------------------------------------
# _build_preamble
# ---------------------------------------------------------------------------

class TestBuildPreamble:
    def test_includes_project_name(self, executor):
        result = executor._build_preamble("", "")
        assert "TestProject" in result

    def test_includes_guardrails(self, executor):
        result = executor._build_preamble("GUARD_CONTENT", "")
        assert "GUARD_CONTENT" in result

    def test_includes_step_context(self, executor):
        ctx = "## 이전 Step 산출물\n\n- Step 0: done"
        result = executor._build_preamble("", ctx)
        assert "이전 Step 산출물" in result

    def test_includes_commit_example(self, executor):
        result = executor._build_preamble("", "")
        assert "feat(mvp):" in result

    def test_includes_rules(self, executor):
        result = executor._build_preamble("", "")
        assert "작업 규칙" in result
        assert "AC" in result

    def test_no_retry_section_by_default(self, executor):
        result = executor._build_preamble("", "")
        assert "이전 시도 실패" not in result

    def test_retry_section_with_prev_error(self, executor):
        result = executor._build_preamble("", "", prev_error="타입 에러 발생")
        assert "이전 시도 실패" in result
        assert "타입 에러 발생" in result

    def test_includes_max_retries(self, executor):
        result = executor._build_preamble("", "")
        assert str(ex.StepExecutor.MAX_RETRIES) in result

    def test_includes_index_path(self, executor):
        result = executor._build_preamble("", "")
        assert "/phases/0-mvp/index.json" in result


# ---------------------------------------------------------------------------
# _update_top_index
# ---------------------------------------------------------------------------

class TestUpdateTopIndex:
    def test_completed(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "completed"
        assert "completed_at" in mvp

    def test_error(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("error")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "error"
        assert "failed_at" in mvp

    def test_blocked(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("blocked")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "blocked"
        assert "blocked_at" in mvp

    def test_other_phases_unchanged(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        polish = next(p for p in data["phases"] if p["dir"] == "1-polish")
        assert polish["status"] == "pending"

    def test_nonexistent_dir_is_noop(self, executor, top_index):
        executor._top_index_file = top_index
        executor._phase_dir_name = "no-such-dir"
        original = json.loads(top_index.read_text())
        executor._update_top_index("completed")
        after = json.loads(top_index.read_text())
        for p_before, p_after in zip(original["phases"], after["phases"]):
            assert p_before["status"] == p_after["status"]

    def test_no_top_index_file(self, executor, tmp_path):
        executor._top_index_file = tmp_path / "nonexistent.json"
        executor._update_top_index("completed")  # should not raise


# ---------------------------------------------------------------------------
# _checkout_branch (mocked)
# ---------------------------------------------------------------------------

class TestCheckoutBranch:
    def test_current_branch_mode_does_not_switch_branches(self, executor):
        executor._use_current_branch = True
        executor._run_git = MagicMock()

        executor._checkout_branch()

        executor._run_git.assert_not_called()

    def _mock_git(self, executor, responses):
        call_idx = {"i": 0}
        def fake_git(*args):
            idx = call_idx["i"]
            call_idx["i"] += 1
            if idx < len(responses):
                return responses[idx]
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

    def test_already_on_branch(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="feat-mvp\n", stderr=""),
        ])
        executor._checkout_branch()  # should return without checkout

    def test_branch_exists_checkout(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_branch_not_exists_create(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="not found"),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_checkout_fails_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="dirty tree"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 3   # git 문제는 step 구현 실패가 아니다

    def test_no_git_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=1, stdout="", stderr="not a git repo"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 3   # git 문제는 step 구현 실패가 아니다


# ---------------------------------------------------------------------------
# _commit_step (mocked)
# ---------------------------------------------------------------------------

class TestCommitStep:
    def test_two_phase_commit(self, executor):
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_calls = [c for c in calls if c[0] == "commit"]
        assert len(commit_calls) == 2
        assert "feat(mvp):" in commit_calls[0][2]
        assert "chore(mvp):" in commit_calls[1][2]

    def test_no_code_changes_skips_feat_commit(self, executor):
        call_count = {"diff": 0}
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                call_count["diff"] += 1
                if call_count["diff"] == 1:
                    return MagicMock(returncode=0)
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_msgs = [c[2] for c in calls if c[0] == "commit"]
        assert len(commit_msgs) == 1
        assert "chore" in commit_msgs[0]


# ---------------------------------------------------------------------------
# _invoke_agent (mocked)
# ---------------------------------------------------------------------------

class TestInvokeAgent:
    @staticmethod
    def _prompt_of(cmd):
        return cmd[cmd.index("-p") + 1]

    def test_invokes_claude_with_correct_args(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"result": "ok"}', stderr="")
        step = {"step": 2, "name": "ui"}
        preamble = "PREAMBLE\n"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            output = executor._invoke_agent(step, preamble)

        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "claude"
        assert "-p" in cmd
        assert cmd[cmd.index("--model") + 1] == "sonnet"
        assert "--dangerously-skip-permissions" in cmd
        assert cmd[cmd.index("--output-format") + 1] == "json"
        # step 세션은 스킬을 호출할 수 없어야 한다 — 금지를 프롬프트에 맡기지 않는다.
        assert "--disable-slash-commands" in cmd
        assert "PREAMBLE" in self._prompt_of(cmd)
        assert "UI를 구현하세요" in self._prompt_of(cmd)

    def test_saves_output_json(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"ok": true}', stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result):
            executor._invoke_agent(step, "preamble")

        output_file = executor._phase_dir / "step2-output.json"
        assert output_file.exists()
        data = json.loads(output_file.read_text())
        assert data["step"] == 2
        assert data["name"] == "ui"
        assert data["exitCode"] == 0

    def test_nonexistent_step_file_exits(self, executor):
        """step 파일이 없으면 실행기를 띄울 수조차 없다 = 하네스 오류."""
        step = {"step": 99, "name": "nonexistent"}
        with pytest.raises(SystemExit) as exc_info:
            executor._invoke_agent(step, "preamble")
        assert exc_info.value.code == 3

    def test_timeout_is_1800(self, executor):
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_agent(step, "preamble")

        assert mock_run.call_args[1]["timeout"] == 1800

    def test_timeout_becomes_nonzero_exit(self, executor):
        """타임아웃은 스택트레이스로 죽지 않고 실행기 실패로 보고된다."""
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 1800)):
            output = executor._invoke_agent(step, "preamble")

        assert output["exitCode"] != 0
        assert "1800" in output["stderr"]

    def test_missing_cli_becomes_nonzero_exit(self, executor):
        """claude가 PATH에 없어도 스택트레이스가 아니라 실행기 실패로 보고된다."""
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", side_effect=FileNotFoundError("claude")):
            output = executor._invoke_agent(step, "preamble")

        assert output["exitCode"] != 0
        assert "claude" in output["stderr"]


# ---------------------------------------------------------------------------
# harness-error — 실행기를 못 띄운 것은 step 실패가 아니다
# ---------------------------------------------------------------------------

class TestHarnessError:
    """쿼터 소진·CLI 부재 등 실행기 자체의 실패를 step 실패와 분리한다.

    AGENTS.md의 gate-error 원칙과 같은 모양: 실행기를 못 돌린 것을
    '구현이 실패했다'로 계산하면 안 된다.
    """

    @staticmethod
    def _stub_agent(executor, exit_code, calls=None):
        """_invoke_agent 대역 — index.json의 status는 건드리지 않는다."""
        def fake(step, preamble):
            if calls is not None:
                calls.append(preamble)
            return {
                "step": step["step"], "name": step["name"],
                "exitCode": exit_code, "stdout": "", "stderr": "quota exhausted",
            }
        return patch.object(executor, "_invoke_agent", side_effect=fake)

    @staticmethod
    def _step_entry(executor, num=2):
        index = json.loads(executor._index_file.read_text())
        return next(s for s in index["steps"] if s["step"] == num)

    def test_exits_3_and_leaves_step_pending(self, executor):
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, 1), patch.object(executor, "_commit_step") as commit:
            with pytest.raises(SystemExit) as exc_info:
                executor._execute_single_step(step, "guardrails")

        assert exc_info.value.code == 3
        entry = self._step_entry(executor)
        assert entry["status"] == "pending"       # 재실행하면 그대로 이어진다
        assert "error_message" not in entry
        commit.assert_not_called()                # 반쪽 작업을 커밋하지 않는다

    def test_does_not_burn_retries(self, executor):
        """쿼터가 소진된 상태에서 3회 헛도는 낭비를 막는다."""
        calls = []
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, 1, calls), patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit):
                executor._execute_single_step(step, "guardrails")

        assert len(calls) == 1

    def test_leaves_top_index_untouched(self, executor, top_index):
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, 1), patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit):
                executor._execute_single_step(step, "guardrails")

        top = json.loads(top_index.read_text())
        assert top["phases"][0]["status"] == "pending"   # phase가 실패한 게 아니다

    def test_clean_exit_without_status_update_still_retries(self, executor):
        """exit 0인데 status 미갱신 = 에이전트는 돌았다 → 기존 재시도 경로 유지."""
        calls = []
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, 0, calls), patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit) as exc_info:
                executor._execute_single_step(step, "guardrails")

        assert exc_info.value.code == 1
        assert len(calls) == ex.StepExecutor.MAX_RETRIES
        assert self._step_entry(executor)["status"] == "error"

    @staticmethod
    def _stub_git_status(executor, porcelain):
        """_run_git 대역 — `status --porcelain`만 응답한다."""
        def fake(*args):
            out = porcelain if args[:2] == ("status", "--porcelain") else ""
            return subprocess.CompletedProcess(list(args), 0, stdout=out, stderr="")
        return patch.object(executor, "_run_git", side_effect=fake)

    def test_warns_about_uncommitted_leftovers(self, executor, capsys):
        """타임아웃은 에이전트가 파일을 고친 **뒤** 터진다 — 남은 편집을 알려야 한다.

        커밋을 막아도 워킹트리 잔재는 그대로 남고, 재실행 후 다음 성공 커밋의
        `git add -A`가 그것을 함께 담는다. 커밋을 막은 취지가 한 step 뒤로
        밀릴 뿐이므로, 최소한 무엇이 남았는지는 보여야 한다.
        """
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, -1), \
             self._stub_git_status(executor, " M src/app.ts\n?? src/new.ts\n"), \
             patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit) as exc_info:
                executor._execute_single_step(step, "guardrails")

        assert exc_info.value.code == 3
        out = capsys.readouterr().out
        assert "커밋되지 않은" in out
        assert "src/app.ts" in out
        assert "src/new.ts" in out

    def test_no_leftover_warning_when_tree_is_clean(self, executor, capsys):
        """쿼터 소진·CLI 부재는 작업 전 실패다 — 잔재가 없으면 경고도 없다."""
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, -1), \
             self._stub_git_status(executor, ""), \
             patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit):
                executor._execute_single_step(step, "guardrails")

        assert "커밋되지 않은" not in capsys.readouterr().out

    def test_phase_bookkeeping_is_not_a_leftover(self, executor, capsys):
        """index.json은 하네스 자신이 쓴다(started_at) — 잔재로 세면 매번 거짓 경보다."""
        step = {"step": 2, "name": "ui"}
        with self._stub_agent(executor, -1), \
             self._stub_git_status(executor, " M phases/0-mvp/index.json\n"), \
             patch.object(executor, "_commit_step"):
            with pytest.raises(SystemExit):
                executor._execute_single_step(step, "guardrails")

        assert "커밋되지 않은" not in capsys.readouterr().out

    def test_nonzero_exit_with_completed_status_is_success(self, executor):
        """status를 completed로 쓴 뒤 비정상 종료한 경우는 성공으로 본다."""
        def fake(step, preamble):
            index = json.loads(executor._index_file.read_text())
            for s in index["steps"]:
                if s["step"] == 2:
                    s["status"] = "completed"
            executor._index_file.write_text(json.dumps(index, ensure_ascii=False))
            return {"step": 2, "name": "ui", "exitCode": 1, "stdout": "", "stderr": ""}

        step = {"step": 2, "name": "ui"}
        with patch.object(executor, "_invoke_agent", side_effect=fake), \
             patch.object(executor, "_commit_step"):
            assert executor._execute_single_step(step, "guardrails") is True


# ---------------------------------------------------------------------------
# progress_indicator (= 이전 Spinner)
# ---------------------------------------------------------------------------

class TestProgressIndicator:
    def test_context_manager(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.15)
        assert pi.elapsed >= 0.1

    def test_elapsed_increases(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.2)
        assert pi.elapsed > 0


# ---------------------------------------------------------------------------
# main() CLI 파싱 (mocked)
# ---------------------------------------------------------------------------

class TestMainCli:
    def test_no_args_exits(self):
        with patch("sys.argv", ["execute.py"]):
            with pytest.raises(SystemExit) as exc_info:
                ex.main()
            assert exc_info.value.code == 2  # argparse exits with 2

    def test_invalid_phase_dir_exits(self):
        """phase 디렉터리가 없는 것은 step 구현 실패가 아니다 = 하네스 오류."""
        with patch("sys.argv", ["execute.py", "nonexistent"]):
            with patch.object(ex, "ROOT", Path("/tmp/fake_nonexistent")):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 3

    def test_missing_index_exits(self, tmp_project):
        (tmp_project / "phases" / "empty").mkdir()
        with patch("sys.argv", ["execute.py", "empty"]):
            with patch.object(ex, "ROOT", tmp_project):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 3

    def test_unexpected_exception_becomes_harness_error(self, tmp_project, phase_dir):
        """예상 못 한 예외가 트레이스백으로 죽으면 파이썬이 exit 1을 낸다 —
        이 저장소 계약에서 1은 'step 실패'이므로 하네스 오류가 오분류된다.
        트레이스백은 그대로 보이되 종료코드만 3으로 옮긴다(삼키지 않는다).
        """
        with patch("sys.argv", ["execute.py", "0-mvp"]):
            with patch.object(ex, "ROOT", tmp_project):
                with patch.object(ex.StepExecutor, "run", side_effect=PermissionError("denied")):
                    with pytest.raises(SystemExit) as exc_info:
                        ex.main()
                    assert exc_info.value.code == 3


# ---------------------------------------------------------------------------
# _finalize (mocked git)
# ---------------------------------------------------------------------------

class TestFinalize:
    """마감 단계의 실패는 step 구현 실패가 아니다 — step은 이미 전부 통과했다."""

    @staticmethod
    def _mock_git(executor, failing_verb):
        def fake(*args):
            rc = 1 if args[0] == failing_verb else 0
            return subprocess.CompletedProcess(list(args), rc, stdout="", stderr="denied")
        return patch.object(executor, "_run_git", side_effect=fake)

    def test_push_failure_exits_3(self, executor, top_index):
        executor._auto_push = True
        with self._mock_git(executor, "push"):
            with pytest.raises(SystemExit) as exc_info:
                executor._finalize()
        assert exc_info.value.code == 3

    def test_branch_resolve_failure_exits_3(self, executor, top_index):
        executor._auto_push = True
        executor._use_current_branch = True
        with self._mock_git(executor, "rev-parse"):
            with pytest.raises(SystemExit) as exc_info:
                executor._finalize()
        assert exc_info.value.code == 3


# ---------------------------------------------------------------------------
# _check_blockers (= 이전 main() error/blocked 체크)
# ---------------------------------------------------------------------------

class TestCheckBlockers:
    def _make_executor_with_steps(self, tmp_project, steps):
        d = tmp_project / "phases" / "test-phase"
        d.mkdir(exist_ok=True)
        index = {"project": "T", "phase": "test", "steps": steps}
        (d / "index.json").write_text(json.dumps(index))

        with patch.object(ex, "ROOT", tmp_project):
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
        inst._root = str(tmp_project)
        inst._phases_dir = tmp_project / "phases"
        inst._phase_dir = d
        inst._phase_dir_name = "test-phase"
        inst._index_file = d / "index.json"
        inst._top_index_file = tmp_project / "phases" / "index.json"
        inst._phase_name = "test"
        inst._total = len(steps)
        return inst

    def test_error_step_exits_1(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "bad", "status": "error", "error_message": "fail"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 1

    def test_blocked_step_exits_2(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "stuck", "status": "blocked", "blocked_reason": "API key"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 2


# ---------------------------------------------------------------------------
# _final_verify — phase 경계의 E2E 회귀 게이트
# ---------------------------------------------------------------------------

def _git_ok(*args):
    return subprocess.CompletedProcess(list(args), 0, stdout="", stderr="")


class TestFinalVerify:
    """step마다 도는 lint/build/test(stop-verify)와 분리된 게이트.

    red면 phase를 완료로 기록하지 않는다 — 그것이 이 게이트의 전부다.
    """

    @staticmethod
    def _script(returncode, stdout="", stderr=""):
        done = subprocess.CompletedProcess(["bash"], returncode, stdout=stdout, stderr=stderr)
        return patch("subprocess.run", return_value=done)

    def test_green_records_passed(self, executor):
        with self._script(0, stdout="4 passed"):
            executor._final_verify()

        index = json.loads(executor._index_file.read_text())
        assert index["final_verify"]["status"] == "passed"
        assert index["final_verify"]["exit_code"] == 0
        assert "completed_at" not in index   # 완료 기록은 _finalize의 몫이다

    def test_red_exits_1(self, executor, top_index):
        executor._run_git = MagicMock(side_effect=_git_ok)
        with self._script(1, stdout="1 failed"):
            with pytest.raises(SystemExit) as exc_info:
                executor._final_verify()

        assert exc_info.value.code == 1

    def test_red_marks_phase_error_not_completed(self, executor, top_index):
        executor._run_git = MagicMock(side_effect=_git_ok)
        with self._script(1):
            with pytest.raises(SystemExit):
                executor._final_verify()

        index = json.loads(executor._index_file.read_text())
        assert index["final_verify"]["status"] == "failed"
        assert "completed_at" not in index
        top = json.loads(top_index.read_text())
        assert top["phases"][0]["status"] == "error"

    def test_red_commits_the_evidence(self, executor, top_index):
        """성공만 커밋되면 red는 로컬에만 남아 사라진다(ADR-008)."""
        calls = []

        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return subprocess.CompletedProcess(list(args), 1)   # 스테이징에 변경 있음
            return _git_ok(*args)

        executor._run_git = fake_git
        with self._script(1):
            with pytest.raises(SystemExit):
                executor._final_verify()

        commit_msgs = [c[2] for c in calls if c[0] == "commit"]
        assert commit_msgs == ["chore(mvp): final verify failed"]
        # 게이트가 만든 빌드 산출물·수정 중인 파일을 함께 담지 않는다
        add_calls = [c for c in calls if c[0] == "add"]
        assert all("-A" not in c for c in add_calls)

    def test_writes_raw_output_evidence(self, executor, top_index):
        executor._run_git = MagicMock(side_effect=_git_ok)
        with self._script(1, stdout="OUT", stderr="ERR"):
            with pytest.raises(SystemExit):
                executor._final_verify()

        rec = json.loads((executor._phase_dir / "final-verify-output.json").read_text())
        assert rec["exitCode"] == 1
        assert rec["stdout"] == "OUT"
        assert rec["stderr"] == "ERR"
        assert rec["command"] == "bash scripts/final-verify.sh"
        assert rec["startedAt"] and rec["finishedAt"]

    def test_missing_script_is_harness_error(self, executor, top_index):
        """게이트를 **띄우지 못한 것**은 red가 아니다 — ADR-008의 gate-error."""
        with patch("subprocess.run", side_effect=FileNotFoundError("final-verify.sh")):
            with pytest.raises(SystemExit) as exc_info:
                executor._final_verify()

        assert exc_info.value.code == 3
        index = json.loads(executor._index_file.read_text())
        assert index["final_verify"]["status"] == "harness-error"
        top = json.loads(top_index.read_text())
        assert top["phases"][0]["status"] == "pending"   # phase가 red인 게 아니다

    def test_timeout_is_harness_error(self, executor, top_index):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("bash", 3600)):
            with pytest.raises(SystemExit) as exc_info:
                executor._final_verify()

        assert exc_info.value.code == 3
        index = json.loads(executor._index_file.read_text())
        assert index["final_verify"]["status"] == "harness-error"
        assert "3600" in json.loads(
            (executor._phase_dir / "final-verify-output.json").read_text()
        )["stderr"]

    def test_invokes_the_shared_script(self, executor):
        """CI와 같은 명령을 부른다 — 정의가 갈라지지 않게 스크립트 하나만 부른다."""
        with self._script(0) as run_mock:
            executor._final_verify()

        cmd = run_mock.call_args[0][0]
        assert cmd[0] == "bash"
        assert cmd[1].endswith("scripts/final-verify.sh")
        assert run_mock.call_args[1]["timeout"] == ex.StepExecutor.FINAL_VERIFY_TIMEOUT


class TestRunWiring:
    """게이트가 '마지막 step 뒤 한 번'에 걸려 있는지 — 순서가 배선의 전부다."""

    @staticmethod
    def _quiet(executor):
        return [
            patch.object(executor, "_print_header"),
            patch.object(executor, "_check_blockers"),
            patch.object(executor, "_checkout_branch"),
            patch.object(executor, "_load_guardrails", return_value=""),
            patch.object(executor, "_ensure_created_at"),
        ]

    def test_gate_runs_between_steps_and_finalize(self, executor):
        order = []
        with contextlib.ExitStack() as stack:
            for p in self._quiet(executor):
                stack.enter_context(p)
            stack.enter_context(patch.object(
                executor, "_execute_all_steps", side_effect=lambda g: order.append("steps")))
            stack.enter_context(patch.object(
                executor, "_final_verify", side_effect=lambda: order.append("verify")))
            stack.enter_context(patch.object(
                executor, "_finalize", side_effect=lambda: order.append("finalize")))
            executor.run()

        assert order == ["steps", "verify", "finalize"]

    def test_step_failure_skips_the_gate(self, executor):
        """step이 실패하면 게이트를 돌릴 대상 자체가 없다 — E2E 시간을 태우지 않는다."""
        with contextlib.ExitStack() as stack:
            for p in self._quiet(executor):
                stack.enter_context(p)
            stack.enter_context(patch.object(
                executor, "_execute_all_steps", side_effect=SystemExit(1)))
            fv = stack.enter_context(patch.object(executor, "_final_verify"))
            stack.enter_context(patch.object(executor, "_finalize"))
            with pytest.raises(SystemExit):
                executor.run()

        fv.assert_not_called()


class TestFinalVerifyIntegration:
    """subprocess를 mock하지 않고 스크립트를 실제로 돌린다.

    '정확히 한 번'은 배선 실수(루프 안 호출·이중 호출)로 쉽게 깨지고 단위
    테스트로는 드러나지 않으므로, 호출 횟수를 스크립트가 직접 센다.
    """

    @staticmethod
    def _install_script(tmp_project, counter: Path, exit_code: int):
        d = tmp_project / "scripts"
        d.mkdir(parents=True, exist_ok=True)
        p = d / "final-verify.sh"
        p.write_text(f'#!/bin/bash\necho run >> "{counter}"\nexit {exit_code}\n')
        p.chmod(0o755)

    @staticmethod
    def _agent_completes_step(executor):
        """에이전트 대역 — step이 스스로 index.json을 completed로 바꾸는 실제 계약."""
        def fake(step, preamble):
            index = json.loads(executor._index_file.read_text())
            for s in index["steps"]:
                if s["step"] == step["step"]:
                    s["status"] = "completed"
                    s["summary"] = "done"
            executor._index_file.write_text(json.dumps(index, ensure_ascii=False))
            return {"step": step["step"], "name": step["name"],
                    "exitCode": 0, "stdout": "", "stderr": ""}
        return patch.object(executor, "_invoke_agent", side_effect=fake)

    def _run_phase(self, executor, tmp_project):
        executor._use_current_branch = True
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(ex, "ROOT", tmp_project))
        stack.enter_context(self._agent_completes_step(executor))
        stack.enter_context(patch.object(executor, "_run_git", side_effect=_git_ok))
        stack.enter_context(patch.object(executor, "_commit_step"))
        return stack

    def test_runs_exactly_once_after_the_last_step(self, executor, tmp_project, top_index):
        counter = tmp_project / "calls"
        self._install_script(tmp_project, counter, 0)

        with self._run_phase(executor, tmp_project):
            executor.run()

        assert counter.read_text().splitlines() == ["run"]
        top = json.loads(top_index.read_text())
        assert top["phases"][0]["status"] == "completed"
        assert "completed_at" in json.loads(executor._index_file.read_text())

    def test_red_blocks_phase_completion(self, executor, tmp_project, top_index):
        counter = tmp_project / "calls"
        self._install_script(tmp_project, counter, 1)

        with self._run_phase(executor, tmp_project):
            with pytest.raises(SystemExit) as exc_info:
                executor.run()

        assert exc_info.value.code == 1
        assert counter.read_text().splitlines() == ["run"]   # red여도 한 번뿐이다

        index = json.loads(executor._index_file.read_text())
        assert "completed_at" not in index                   # phase 미완료
        assert index["final_verify"]["status"] == "failed"
        assert json.loads(top_index.read_text())["phases"][0]["status"] == "error"
        # step들은 completed로 남는다 — 회귀는 phase의 결과이지 특정 step의 실패가 아니다
        assert all(s["status"] == "completed" for s in index["steps"])

    def test_rerun_after_fix_resumes_at_the_gate(self, executor, tmp_project, top_index):
        """재실행은 에이전트를 다시 부르지 않고 게이트부터 돈다."""
        counter = tmp_project / "calls"
        self._install_script(tmp_project, counter, 1)
        with self._run_phase(executor, tmp_project):
            with pytest.raises(SystemExit):
                executor.run()

        self._install_script(tmp_project, counter, 0)   # 회귀를 고쳤다
        executor._use_current_branch = True
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(ex, "ROOT", tmp_project))
            agent = stack.enter_context(patch.object(executor, "_invoke_agent"))
            stack.enter_context(patch.object(executor, "_run_git", side_effect=_git_ok))
            executor.run()

        agent.assert_not_called()
        assert counter.read_text().splitlines() == ["run", "run"]
        assert json.loads(top_index.read_text())["phases"][0]["status"] == "completed"
        assert json.loads(executor._index_file.read_text())["final_verify"]["status"] == "passed"
