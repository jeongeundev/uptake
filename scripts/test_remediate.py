"""review-remediation manifest ingest acceptance tests."""

import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import remediate


REVIEW_FIXTURE = Path(__file__).parent / "fixtures" / "remediation" / "review-1.json"


def ingest_fixture(tmp_path: Path) -> dict:
    assert remediate.cmd_ingest(tmp_path, "0-mvp", REVIEW_FIXTURE) == 0
    manifest = remediate.load_manifest(tmp_path, "0-mvp")
    assert manifest is not None
    return manifest


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
