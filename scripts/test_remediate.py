"""review-remediation manifest ingest acceptance tests."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import remediate


REVIEW_FIXTURE = Path(__file__).parent / "fixtures" / "remediation" / "review-1.json"
CLOSURE_FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "remediation"
    / "review-2-closure.json"
)


def ingest_fixture(tmp_path: Path) -> dict:
    assert remediate.cmd_ingest(tmp_path, "0-mvp", REVIEW_FIXTURE) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    return manifest


def write_triage(tmp_path: Path, decisions: dict, cycle: int = 1) -> Path:
    path = tmp_path / "remediation" / "0-mvp" / f"cycle-{cycle}" / "triage.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"cycle": cycle, "decisions": decisions}, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def finding_by_id(manifest: dict, finding_id: str) -> dict:
    return next(
        finding for finding in manifest["findings"] if finding["id"] == finding_id
    )


def triage_fixture(tmp_path: Path) -> dict:
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {
            "F-001": {"category": "contract_violation", "evidence": "AC-7b 위반"},
            "F-002": {"category": "implementation_bug", "evidence": "실행 순서 위반"},
            "F-003": {"category": "test_gap", "evidence": "통합 검증 부재"},
            "F-004": {
                "category": "missing_feature",
                "evidence": "UI 미구현",
                "routedTo": "1-user-ui-slice",
            },
            "F-005": {
                "category": "missing_feature",
                "evidence": "preview 미구현",
                "routedTo": "1-argv-preview",
            },
        },
    )
    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    return manifest


def write_closure_review(
    tmp_path: Path,
    verdicts: dict[str, str],
    *,
    review_id: str = "review-inline-closure",
) -> Path:
    review = json.loads(CLOSURE_FIXTURE.read_text(encoding="utf-8"))
    review["reviewId"] = review_id
    review["findings"] = [
        finding
        for finding in review["findings"]
        if finding["id"] in verdicts
    ]
    for finding in review["findings"]:
        finding["closureVerdict"] = verdicts[finding["id"]]
    path = tmp_path / f"{review_id}.json"
    path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
    return path


def seed_fix_phase(
    tmp_path: Path,
    *,
    cycle: int = 1,
    steps: list[dict] | None = None,
    completed_at: str | None = "2026-07-24T18:00:00+0900",
) -> Path:
    path = tmp_path / "phases" / f"0-mvp-fix-c{cycle}" / "index.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    index = {
        "project": "uptake",
        "phase": f"0-mvp-fix-c{cycle}",
        "steps": steps or [{"step": 0, "name": "fix", "status": "completed"}],
    }
    if completed_at is not None:
        index["completed_at"] = completed_at
    path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    return path


def prepare_ready_cycle(tmp_path: Path) -> dict:
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)
    remediate.cmd_ingest_closure(tmp_path, "0-mvp", CLOSURE_FIXTURE, 1)
    seed_fix_phase(tmp_path)
    return remediate.load_manifest(tmp_path, "0-mvp")


def read_ruling(tmp_path: Path, cycle: int = 1) -> dict:
    path = (
        tmp_path
        / "remediation"
        / "0-mvp"
        / f"cycle-{cycle}"
        / "ruling.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_ingest_creates_manifest_with_five_unresolved_findings(tmp_path):
    manifest = ingest_fixture(tmp_path)

    assert manifest["state"] == "triaging"
    assert len(manifest["findings"]) == 5
    assert [finding["id"] for finding in manifest["findings"]] == [
        "F-001",
        "F-002",
        "F-003",
        "F-004",
        "F-005",
    ]
    assert all(finding["state"] == "unresolved" for finding in manifest["findings"])
    assert all(finding["category"] is None for finding in manifest["findings"])
    assert manifest["findings"][0]["suggestedCategory"] == "contract_violation"

    preserved = tmp_path / "remediation" / "0-mvp" / "reviews" / "review-1.json"
    assert json.loads(preserved.read_text(encoding="utf-8")) == json.loads(
        REVIEW_FIXTURE.read_text(encoding="utf-8")
    )


def test_reingest_deduplicates_by_contract_fingerprint(tmp_path):
    first = ingest_fixture(tmp_path)
    assert remediate.cmd_ingest(tmp_path, "0-mvp", REVIEW_FIXTURE) == 0
    second = remediate.load_manifest(tmp_path, "0-mvp")

    assert second is not None
    assert len(second["findings"]) == 5
    source = json.loads(REVIEW_FIXTURE.read_text(encoding="utf-8"))["findings"][0]
    expected = hashlib.sha1(
        (
            "src/lib/engine/verify.ts"
            + "|AC-7b|"
            + "양성-error-taxonomy-오분류"
        ).encode("utf-8")
    ).hexdigest()[:12]
    assert first["findings"][0]["fingerprint"] == expected
    assert remediate.fingerprint(
        [" ./src/lib/engine/verify.ts:42 "],
        ["AC-7b"],
        "양성 error taxonomy 오분류",
    ) == expected


def test_reingest_keeps_ids_and_fingerprints_stable(tmp_path):
    first = ingest_fixture(tmp_path)
    original_identity = [
        (finding["id"], finding["fingerprint"]) for finding in first["findings"]
    ]

    assert remediate.cmd_ingest(tmp_path, "0-mvp", REVIEW_FIXTURE) == 0
    second = remediate.load_manifest(tmp_path, "0-mvp")

    assert second is not None
    assert [
        (finding["id"], finding["fingerprint"]) for finding in second["findings"]
    ] == original_identity


def test_invalid_review_is_rejected_without_manifest_pollution(tmp_path):
    invalid_review = tmp_path / "invalid-review.json"
    review = json.loads(REVIEW_FIXTURE.read_text(encoding="utf-8"))
    del review["findings"][0]["severity"]
    invalid_review.write_text(
        json.dumps(review, ensure_ascii=False), encoding="utf-8"
    )

    with pytest.raises(ValueError, match="severity"):
        remediate.cmd_ingest(tmp_path, "0-mvp", invalid_review)

    assert remediate.load_manifest(tmp_path, "0-mvp") is None
    assert not (tmp_path / "remediation" / "0-mvp" / "reviews").exists()


def test_apply_triage_routes_categories_and_records_history(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {
            "F-001": {"category": "contract_violation", "evidence": "AC-7b 위반"},
            "F-002": {"category": "implementation_bug", "evidence": "실행 순서 위반"},
            "F-003": {"category": "test_gap", "evidence": "통합 검증 부재"},
            "F-004": {
                "category": "missing_feature",
                "evidence": "UI가 아직 미구현",
                "routedTo": "1-user-ui-slice",
            },
            "F-005": {"category": "missing_feature", "evidence": "preview 미구현"},
        },
    )

    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert manifest["state"] == "remediating"
    for finding_id in ("F-001", "F-002", "F-003"):
        assert finding_by_id(manifest, finding_id)["state"] == "accepted"
    for finding_id in ("F-004", "F-005"):
        assert finding_by_id(manifest, finding_id)["state"] == "deferred"
    assert finding_by_id(manifest, "F-004")["routedTo"] == "1-user-ui-slice"
    assert all(
        finding["history"][-1]["by"] == "triage"
        for finding in manifest["findings"]
    )


@pytest.mark.parametrize(
    "decision",
    [
        {"category": "contract_violation", "evidence": ""},
        {"decision": "rejected", "evidence": ""},
    ],
)
def test_apply_triage_requires_evidence_atomically(tmp_path, decision):
    ingest_fixture(tmp_path)
    manifest_path = tmp_path / "remediation" / "0-mvp" / "manifest.json"
    before = manifest_path.read_bytes()
    write_triage(
        tmp_path,
        {
            "F-001": {"category": "contract_violation", "evidence": "유효한 근거"},
            "F-002": decision,
        },
    )

    with pytest.raises(ValueError, match="evidence"):
        remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)

    assert manifest_path.read_bytes() == before


@pytest.mark.parametrize(
    "decision",
    [
        {
            "category": "implementation_bug",
            "decision": "rejected",
            "evidence": "근거",
        },
        {"evidence": "근거"},
    ],
)
def test_apply_triage_requires_category_xor_decision(tmp_path, decision):
    ingest_fixture(tmp_path)
    write_triage(tmp_path, {"F-001": decision})

    with pytest.raises(ValueError, match="exactly one"):
        remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)


def test_apply_triage_routes_design_issue_to_requires_human(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {"F-001": {"category": "design_issue", "evidence": "새 ADR 필요"}},
    )

    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert finding_by_id(manifest, "F-001")["state"] == "requires-human"


def test_apply_triage_supports_rejected_and_duplicate(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {
            "F-001": {"decision": "rejected", "evidence": "오탐 확인"},
            "F-002": {
                "decision": "duplicate",
                "canonicalId": "F-001",
                "evidence": "동일 원인",
            },
        },
    )

    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert finding_by_id(manifest, "F-001")["state"] == "rejected"
    duplicate = finding_by_id(manifest, "F-002")
    assert duplicate["state"] == "duplicate"
    assert duplicate["canonicalId"] == "F-001"


def test_apply_triage_rejects_missing_duplicate_canonical(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {
            "F-001": {
                "decision": "duplicate",
                "canonicalId": "F-999",
                "evidence": "동일 원인",
            }
        },
    )

    with pytest.raises(ValueError, match="canonicalId"):
        remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)


def test_apply_triage_only_accepts_unresolved_findings(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {"F-001": {"category": "implementation_bug", "evidence": "버그 확인"}},
    )
    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    write_triage(
        tmp_path,
        {"F-001": {"category": "implementation_bug", "evidence": "재분류 시도"}},
    )

    with pytest.raises(ValueError, match="unresolved"):
        remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)


def test_closure_packet_contains_only_accepted_findings(tmp_path):
    triage_fixture(tmp_path)

    assert remediate.cmd_closure_packet(tmp_path, "0-mvp", 1) == 0

    packet = (
        tmp_path
        / "remediation"
        / "0-mvp"
        / "cycle-1"
        / "closure-packet.md"
    ).read_text(encoding="utf-8")
    for finding_id in ("F-001", "F-002", "F-003"):
        assert f"## {finding_id} " in packet
    assert "F-004" not in packet
    assert "F-005" not in packet
    assert "Verdict: [ ] resolved  [ ] still-open" in packet
    assert "신규 finding을 여기서 제기하지 마라" in packet

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert manifest["state"] == "closing"
    assert manifest["cycles"] == [
        {
            "cycle": 1,
            "fixPhase": "0-mvp-fix-c1",
            "review": None,
            "closureReview": None,
            "verdict": None,
            "reasons": [],
        }
    ]


def test_ingest_closure_resolves_accepted_findings(tmp_path):
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)

    assert (
        remediate.cmd_ingest_closure(
            tmp_path, "0-mvp", CLOSURE_FIXTURE, 1
        )
        == 0
    )

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    for finding_id in ("F-001", "F-002", "F-003"):
        finding = finding_by_id(manifest, finding_id)
        assert finding["state"] == "resolved"
        assert finding["history"][-1]["by"] == "closure"
    assert manifest["cycles"][0]["closureReview"] == "review-2"


def test_ingest_closure_keeps_still_open_accepted(tmp_path):
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)
    review_path = write_closure_review(
        tmp_path,
        {
            "F-001": "still-open",
            "F-002": "resolved",
            "F-003": "resolved",
        },
    )

    assert remediate.cmd_ingest_closure(
        tmp_path, "0-mvp", review_path, 1
    ) == 0

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    still_open = finding_by_id(manifest, "F-001")
    assert still_open["state"] == "accepted"
    assert still_open["history"][-1]["from"] == "accepted"
    assert still_open["history"][-1]["to"] == "accepted"
    assert still_open["history"][-1]["evidence"].startswith("still-open:")
    assert finding_by_id(manifest, "F-002")["state"] == "resolved"
    assert finding_by_id(manifest, "F-003")["state"] == "resolved"


def test_ingest_closure_rejects_new_finding(tmp_path):
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)
    review = json.loads(CLOSURE_FIXTURE.read_text(encoding="utf-8"))
    review["reviewId"] = "review-new-finding"
    review["findings"][0]["id"] = "F-999"
    review_path = tmp_path / "review-new-finding.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="new finding"):
        remediate.cmd_ingest_closure(tmp_path, "0-mvp", review_path, 1)


def test_full_review_recurrence_requires_human(tmp_path):
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)
    remediate.cmd_ingest_closure(tmp_path, "0-mvp", CLOSURE_FIXTURE, 1)
    review = json.loads(REVIEW_FIXTURE.read_text(encoding="utf-8"))
    review["reviewId"] = "review-recurrence"
    review["round"] = 3
    review["findings"] = [review["findings"][0]]
    review_path = tmp_path / "review-recurrence.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")

    assert remediate.cmd_ingest(tmp_path, "0-mvp", review_path) == 0

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    finding = finding_by_id(manifest, "F-001")
    assert finding["state"] == "requires-human"
    assert finding["history"][-1]["from"] == "resolved"
    assert finding["history"][-1]["by"] == "ingest"


def test_ingest_closure_cannot_resolve_nonaccepted_finding(tmp_path):
    ingest_fixture(tmp_path)
    review_path = write_closure_review(
        tmp_path,
        {"F-001": "resolved"},
        review_id="review-invalid-transition",
    )

    with pytest.raises(ValueError, match="accepted"):
        remediate.cmd_ingest_closure(tmp_path, "0-mvp", review_path, 1)


def test_rule_ready_with_resolved_major_and_deferred_findings(tmp_path, capsys):
    prepare_ready_cycle(tmp_path)

    assert remediate.cmd_rule(tmp_path, "0-mvp", 1) == 0

    assert capsys.readouterr().out.strip() == "Ready"
    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Ready"
    assert all(ruling["gates"].values())
    assert ruling["failedGates"] == []
    assert ruling["readyForHandoff"] is True
    assert ruling["handoff"] is None
    assert [
        item["id"] for item in ruling["deferredToImplementation"]
    ] == ["F-004", "F-005"]
    assert [
        item["routedTo"] for item in ruling["deferredToImplementation"]
    ] == ["1-user-ui-slice", "1-argv-preview"]
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert manifest["state"] == "ready"
    assert manifest["cycles"][0]["verdict"] == "Ready"


def test_rule_ready_without_fix_phase_when_review_has_no_accepted_findings(
    tmp_path, capsys
):
    review = json.loads(REVIEW_FIXTURE.read_text(encoding="utf-8"))
    review["findings"] = []
    review_path = tmp_path / "empty-review.json"
    review_path.write_text(json.dumps(review), encoding="utf-8")
    remediate.cmd_ingest(tmp_path, "0-mvp", review_path)

    assert remediate.cmd_rule(tmp_path, "0-mvp", 1) == 0

    assert capsys.readouterr().out.strip().endswith("Ready")
    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Ready"
    assert ruling["gates"]["G4"] is True
    assert ruling["gates"]["G6"] is True


def test_rule_open_blocker_escalates_and_names_finding(tmp_path):
    manifest = ingest_fixture(tmp_path)
    finding_by_id(manifest, "F-001")["severity"] = "blocker"
    save_path = tmp_path / "remediation" / "0-mvp" / "manifest.json"
    save_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    write_triage(
        tmp_path,
        {"F-001": {"category": "implementation_bug", "evidence": "열린 blocker"}},
    )
    remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)
    seed_fix_phase(tmp_path)

    assert remediate.cmd_rule(tmp_path, "0-mvp", 1) == 0

    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Escalate"
    assert ruling["gates"]["G1"] is False
    assert "F-001" in " ".join(ruling["escalationReasons"])


def test_rule_score_never_overrides_failed_or_passing_gates(tmp_path):
    manifest = ingest_fixture(tmp_path)
    for finding in manifest["findings"]:
        finding["state"] = "rejected"
    finding_by_id(manifest, "F-001")["state"] = "accepted"
    finding_by_id(manifest, "F-001")["severity"] = "major"
    remediate.save_manifest(tmp_path, "0-mvp", manifest)
    seed_fix_phase(tmp_path)

    remediate.cmd_rule(tmp_path, "0-mvp", 1)
    escalated = read_ruling(tmp_path)
    assert escalated["score"] == 92
    assert escalated["verdict"] == "Escalate"

    other_root = tmp_path / "ready-low-score"
    manifest = ingest_fixture(other_root)
    for finding in manifest["findings"]:
        finding["state"] = "rejected"
    for number in range(20):
        template = dict(manifest["findings"][0])
        template.update(
            id=f"F-{100 + number:03d}",
            severity="minor",
            state="unresolved",
            history=[],
        )
        manifest["findings"].append(template)
    manifest["cycles"] = [{"cycle": 1}, {"cycle": 2}]
    manifest["currentCycle"] = 2
    remediate.save_manifest(other_root, "0-mvp", manifest)
    seed_fix_phase(other_root, cycle=2)

    remediate.cmd_rule(other_root, "0-mvp", 2)
    ready = read_ruling(other_root, cycle=2)
    assert ready["score"] == 35
    assert ready["verdict"] == "Ready"


def test_rule_requires_human_escalates(tmp_path):
    ingest_fixture(tmp_path)
    write_triage(
        tmp_path,
        {"F-001": {"category": "design_issue", "evidence": "사람의 결정 필요"}},
    )
    remediate.cmd_apply_triage(tmp_path, "0-mvp", 1)
    seed_fix_phase(tmp_path)

    remediate.cmd_rule(tmp_path, "0-mvp", 1)

    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Escalate"
    assert ruling["gates"]["G2"] is False
    assert "F-001" in " ".join(ruling["escalationReasons"])


def test_rule_rejects_major_resolved_without_closure_history(tmp_path):
    manifest = ingest_fixture(tmp_path)
    for finding in manifest["findings"]:
        finding["state"] = "rejected"
    finding = finding_by_id(manifest, "F-001")
    finding["state"] = "resolved"
    finding["history"] = [
        {
            "cycle": 1,
            "from": "accepted",
            "to": "resolved",
            "by": "implementation",
            "evidence": "self-reported",
            "at": "2026-07-24T18:00:00+0900",
        }
    ]
    remediate.save_manifest(tmp_path, "0-mvp", manifest)
    seed_fix_phase(tmp_path)

    remediate.cmd_rule(tmp_path, "0-mvp", 1)

    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Escalate"
    assert ruling["gates"]["G5"] is False
    assert "F-001" in " ".join(ruling["escalationReasons"])


@pytest.mark.parametrize(
    ("steps", "completed_at"),
    [
        ([{"step": 0, "name": "fix", "status": "error"}], "2026-07-24T18:00:00+0900"),
        ([{"step": 0, "name": "fix", "status": "completed"}], None),
    ],
)
def test_rule_incomplete_fix_phase_escalates(tmp_path, steps, completed_at):
    prepare_ready_cycle(tmp_path)
    seed_fix_phase(tmp_path, steps=steps, completed_at=completed_at)

    remediate.cmd_rule(tmp_path, "0-mvp", 1)

    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Escalate"
    assert ruling["gates"]["G4"] is False
    if steps[0]["status"] == "error":
        assert ruling["gates"]["G6"] is False


def test_rule_cycle_cap_writes_escalation_and_returns_nonzero(tmp_path):
    manifest = ingest_fixture(tmp_path)
    manifest["currentCycle"] = 3
    remediate.save_manifest(tmp_path, "0-mvp", manifest)

    assert remediate.cmd_rule(tmp_path, "0-mvp", 3) != 0

    ruling = read_ruling(tmp_path, cycle=3)
    reason = "cycle cap exceeded: cycle 3 > maxCycles 2"
    assert ruling["verdict"] == "Escalate"
    assert ruling["escalationReasons"] == [reason]
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert manifest["state"] == "escalated"


def test_next_cycle_advances_still_open_findings(tmp_path):
    triage_fixture(tmp_path)
    remediate.cmd_closure_packet(tmp_path, "0-mvp", 1)
    closure = write_closure_review(
        tmp_path,
        {
            "F-001": "still-open",
            "F-002": "resolved",
            "F-003": "resolved",
        },
    )
    remediate.cmd_ingest_closure(tmp_path, "0-mvp", closure, 1)

    assert remediate.cmd_next_cycle(tmp_path, "0-mvp", 1) == 0

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert manifest["currentCycle"] == 2
    assert manifest["state"] == "remediating"


def test_next_cycle_rejects_cycle_cap(tmp_path):
    manifest = ingest_fixture(tmp_path)
    manifest["currentCycle"] = 2
    remediate.save_manifest(tmp_path, "0-mvp", manifest)

    with pytest.raises(ValueError, match="cycle cap"):
        remediate.cmd_next_cycle(tmp_path, "0-mvp", 2)


def test_real_two_review_cycle_reaches_ready_with_deferred_routing(tmp_path):
    manifest = ingest_fixture(tmp_path)
    assert len(manifest["findings"]) == 5
    assert all(
        finding["state"] == "unresolved" for finding in manifest["findings"]
    )

    write_triage(
        tmp_path,
        {
            "F-001": {
                "category": "contract_violation",
                "evidence": "verify.ts의 양성 error 분류가 AC-7b 계약을 위반",
            },
            "F-002": {
                "category": "implementation_bug",
                "evidence": "verify.ts가 argv 공개 전에 게이트를 실행",
            },
            "F-003": {
                "category": "test_gap",
                "evidence": "verify.test.ts가 실제 vitest 파이프라인을 검증하지 않음",
            },
            "F-004": {
                "category": "missing_feature",
                "evidence": "사용자 주도 UI는 기존 엔진 결함이 아닌 미구현 범위",
                "routedTo": "1-user-ui-slice",
            },
            "F-005": {
                "category": "missing_feature",
                "evidence": "argv preview UI는 별도 구현 단계 대상",
                "routedTo": "1-argv-preview-ui",
            },
        },
    )
    assert remediate.cmd_apply_triage(tmp_path, "0-mvp", 1) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    assert [
        finding_by_id(manifest, finding_id)["state"]
        for finding_id in ("F-001", "F-002", "F-003")
    ] == ["accepted", "accepted", "accepted"]
    assert [
        finding_by_id(manifest, finding_id)["state"]
        for finding_id in ("F-004", "F-005")
    ] == ["deferred", "deferred"]

    seed_fix_phase(tmp_path)
    assert remediate.cmd_closure_packet(tmp_path, "0-mvp", 1) == 0
    packet = (
        tmp_path
        / "remediation"
        / "0-mvp"
        / "cycle-1"
        / "closure-packet.md"
    ).read_text(encoding="utf-8")
    assert all(
        f"## {finding_id} " in packet
        for finding_id in ("F-001", "F-002", "F-003")
    )
    assert "F-004" not in packet
    assert "F-005" not in packet

    assert (
        remediate.cmd_ingest_closure(
            tmp_path, "0-mvp", CLOSURE_FIXTURE, 1
        )
        == 0
    )
    assert remediate.cmd_rule(tmp_path, "0-mvp", 1) == 0

    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    ruling = read_ruling(tmp_path)
    assert ruling["verdict"] == "Ready"
    assert all(ruling["gates"].values())
    for finding_id in ("F-001", "F-002", "F-003"):
        finding = finding_by_id(manifest, finding_id)
        assert finding["state"] == "resolved"
        assert any(entry["by"] == "closure" for entry in finding["history"])
    assert ruling["deferredToImplementation"] == [
        {
            "id": "F-004",
            "title": "사용자 주도 UI vertical slice 미구현",
            "routedTo": "1-user-ui-slice",
        },
        {
            "id": "F-005",
            "title": "argv preview UI 미구현",
            "routedTo": "1-argv-preview-ui",
        },
    ]
    assert not {
        finding["id"]
        for finding in manifest["findings"]
        if finding["severity"] in {"blocker", "major"}
        and finding["state"] in {"accepted", "unresolved"}
    }
    assert ruling["openFindings"] == []
    assert manifest["state"] == "ready"


def test_cli_ingest_and_status_smoke(tmp_path):
    script = Path(__file__).parent / "remediate.py"
    ingest = subprocess.run(
        [
            sys.executable,
            str(script),
            "ingest",
            "0-mvp",
            str(REVIEW_FIXTURE),
            "--root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert ingest.returncode == 0, ingest.stderr
    assert (tmp_path / "remediation" / "0-mvp" / "manifest.json").is_file()

    status = subprocess.run(
        [
            sys.executable,
            str(script),
            "status",
            "0-mvp",
            "--root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert status.returncode == 0, status.stderr
    assert "loop 0-mvp — triaging" in status.stdout
    assert "F-001  major  -  unresolved" in status.stdout
