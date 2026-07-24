#!/usr/bin/env python3
"""Deterministic bookkeeping CLI for the review-remediation loop."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TZ = timezone(timedelta(hours=9))
SEVERITIES = {"blocker", "major", "minor", "nit"}
REVIEW_KINDS = {"full", "closure"}
CONFIDENCES = {"high", "med", "low"}
CATEGORIES = {
    "implementation_bug",
    "contract_violation",
    "test_gap",
    "missing_feature",
    "design_issue",
}
ACTIVE_STATES = {"unresolved", "accepted", "requires-human"}
TRIAGE_DECISIONS = {"rejected", "duplicate"}
ACCEPTED_CATEGORIES = {
    "implementation_bug",
    "contract_violation",
    "test_gap",
}


def stamp() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%dT%H:%M:%S%z")


def fingerprint(evidence_files: list[str], spec: list[str], title: str) -> str:
    path = evidence_files[0].strip() if evidence_files else ""
    path = re.sub(r":\d+(?::\d+)?$", "", path)
    if path.startswith("./"):
        path = path[2:]

    title_slug = re.sub(r"[^0-9a-z가-힣]+", "-", title.lower())
    title_slug = re.sub(r"-+", "-", title_slug).strip("-")
    value = f"{path}|{','.join(sorted(spec))}|{title_slug}"
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def load_manifest(root: Path | str, loop_id: str) -> dict | None:
    path = Path(root) / "remediation" / loop_id / "manifest.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(root: Path | str, loop_id: str, manifest: dict) -> None:
    directory = Path(root) / "remediation" / loop_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "manifest.json"
    encoded = json.dumps(manifest, indent=2, ensure_ascii=False)

    fd, temporary_name = tempfile.mkstemp(dir=directory, prefix=".manifest-", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temporary:
            temporary.write(encoded)
        os.replace(temporary_name, path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def _require(mapping: dict, key: str, context: str):
    if key not in mapping:
        raise ValueError(f"{context}: missing required field '{key}'")
    return mapping[key]


def _require_string(mapping: dict, key: str, context: str) -> str:
    value = _require(mapping, key, context)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{context}.{key}: expected non-empty string")
    return value


def _validate_review(review: object) -> dict:
    if not isinstance(review, dict):
        raise ValueError("review: expected object")

    review_id = _require_string(review, "reviewId", "review")
    if Path(review_id).name != review_id:
        raise ValueError("review.reviewId: expected file-safe identifier")

    round_number = _require(review, "round", "review")
    if not isinstance(round_number, int) or isinstance(round_number, bool) or round_number < 1:
        raise ValueError("review.round: expected integer >= 1")

    kind = _require(review, "kind", "review")
    if kind not in REVIEW_KINDS:
        raise ValueError(f"review.kind: expected one of {sorted(REVIEW_KINDS)}")

    target = _require(review, "target", "review")
    if not isinstance(target, dict):
        raise ValueError("review.target: expected object")
    for field in ("phase", "branch", "baseCommit"):
        _require_string(target, field, "review.target")

    _require_string(review, "reviewer", "review")
    _require_string(review, "createdAt", "review")
    findings = _require(review, "findings", "review")
    if not isinstance(findings, list):
        raise ValueError("review.findings: expected array")

    for index, finding in enumerate(findings):
        context = f"review.findings[{index}]"
        if not isinstance(finding, dict):
            raise ValueError(f"{context}: expected object")
        finding_id = _require(finding, "id", context)
        if finding_id is not None and not re.fullmatch(r"F-\d{3}", str(finding_id)):
            raise ValueError(f"{context}.id: expected null or F-NNN")
        severity = _require(finding, "severity", context)
        if severity not in SEVERITIES:
            raise ValueError(f"{context}.severity: expected one of {sorted(SEVERITIES)}")
        _require_string(finding, "title", context)
        _require_string(finding, "detail", context)

        evidence = _require(finding, "evidence", context)
        if not isinstance(evidence, dict):
            raise ValueError(f"{context}.evidence: expected object")
        for field in ("files", "spec"):
            values = _require(evidence, field, f"{context}.evidence")
            if not isinstance(values, list) or not all(
                isinstance(value, str) for value in values
            ):
                raise ValueError(f"{context}.evidence.{field}: expected string array")

        suggested_category = finding.get("suggestedCategory")
        if suggested_category is not None and suggested_category not in CATEGORIES:
            raise ValueError(f"{context}.suggestedCategory: invalid value")
        confidence = _require(finding, "reviewerConfidence", context)
        if confidence not in CONFIDENCES:
            raise ValueError(
                f"{context}.reviewerConfidence: expected one of {sorted(CONFIDENCES)}"
            )
        closure_verdict = _require(finding, "closureVerdict", context)
        if kind == "full" and closure_verdict is not None:
            raise ValueError(f"{context}.closureVerdict: full review requires null")
        if kind == "closure" and closure_verdict not in {"resolved", "still-open"}:
            raise ValueError(
                f"{context}.closureVerdict: closure review requires a verdict"
            )

    return review


def _next_finding_id(findings: list[dict]) -> str:
    numbers = [
        int(match.group(1))
        for finding in findings
        if (match := re.fullmatch(r"F-(\d{3})", finding.get("id", "")))
    ]
    return f"F-{max(numbers, default=0) + 1:03d}"


def _transition_to_requires_human(
    finding: dict, cycle: int, evidence: str
) -> None:
    previous = finding["state"]
    finding["state"] = "requires-human"
    finding["history"].append(
        {
            "cycle": cycle,
            "from": previous,
            "to": "requires-human",
            "by": "ingest",
            "evidence": evidence,
            "at": stamp(),
        }
    )


def cmd_ingest(root: Path | str, loop_id: str, review_path: Path | str) -> int:
    root = Path(root)
    review_path = Path(review_path)
    review = _validate_review(json.loads(review_path.read_text(encoding="utf-8")))
    manifest = load_manifest(root, loop_id)

    if manifest is None:
        manifest = {
            "loopId": loop_id,
            "target": review["target"],
            "createdAt": stamp(),
            "state": "triaging",
            "currentCycle": 1,
            "maxCycles": 2,
            "findings": [],
            "cycles": [],
        }
    elif manifest["target"] != review["target"]:
        raise ValueError("review.target does not match existing manifest target")

    existing_by_fingerprint = {
        finding["fingerprint"]: finding for finding in manifest["findings"]
    }
    used_ids = {finding["id"] for finding in manifest["findings"]}

    for reviewed_finding in review["findings"]:
        evidence = reviewed_finding["evidence"]
        finding_fingerprint = fingerprint(
            evidence["files"], evidence["spec"], reviewed_finding["title"]
        )
        existing = existing_by_fingerprint.get(finding_fingerprint)
        if existing is not None:
            existing["detail"] = reviewed_finding["detail"]
            if existing["state"] in ACTIVE_STATES:
                continue
            if existing["state"] == "resolved":
                _transition_to_requires_human(
                    existing, manifest["currentCycle"], "재발: 동일 fingerprint 재검출"
                )
            elif existing["state"] == "rejected":
                _transition_to_requires_human(
                    existing,
                    manifest["currentCycle"],
                    "리뷰어 불일치: rejected finding 재검출",
                )
            continue

        requested_id = reviewed_finding["id"]
        finding_id = requested_id or _next_finding_id(manifest["findings"])
        if finding_id in used_ids:
            raise ValueError(f"finding id already exists: {finding_id}")

        finding = {
            "id": finding_id,
            "fingerprint": finding_fingerprint,
            "severity": reviewed_finding["severity"],
            "category": None,
            "title": reviewed_finding["title"],
            "detail": reviewed_finding["detail"],
            "state": "unresolved",
            "raisedInReview": review["reviewId"],
            "firstSeenCycle": manifest["currentCycle"],
            "specRefs": evidence["spec"],
            "evidenceFiles": evidence["files"],
            "suggestedCategory": reviewed_finding.get("suggestedCategory"),
            "canonicalId": None,
            "routedTo": None,
            "remediationStep": None,
            "history": [],
        }
        manifest["findings"].append(finding)
        existing_by_fingerprint[finding_fingerprint] = finding
        used_ids.add(finding_id)

    reviews_directory = root / "remediation" / loop_id / "reviews"
    reviews_directory.mkdir(parents=True, exist_ok=True)
    preserved_review = reviews_directory / f"{review['reviewId']}.json"
    if review_path.resolve() != preserved_review.resolve():
        shutil.copyfile(review_path, preserved_review)
    save_manifest(root, loop_id, manifest)
    return 0


def cmd_apply_triage(root: Path | str, loop_id: str, cycle: int) -> int:
    root = Path(root)
    manifest = load_manifest(root, loop_id)
    if manifest is None:
        raise ValueError(f"manifest not found for loop '{loop_id}'")
    if manifest["currentCycle"] != cycle:
        raise ValueError(
            f"cycle {cycle} does not match current cycle {manifest['currentCycle']}"
        )

    triage_path = (
        root / "remediation" / loop_id / f"cycle-{cycle}" / "triage.json"
    )
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    if not isinstance(triage, dict):
        raise ValueError("triage: expected object")
    if _require(triage, "cycle", "triage") != cycle:
        raise ValueError(f"triage.cycle: expected {cycle}")
    decisions = _require(triage, "decisions", "triage")
    if not isinstance(decisions, dict):
        raise ValueError("triage.decisions: expected object")

    findings_by_id = {
        finding["id"]: finding for finding in manifest["findings"]
    }
    validated = []
    for finding_id, item in decisions.items():
        context = f"triage.decisions[{finding_id!r}]"
        if finding_id not in findings_by_id:
            raise ValueError(f"{context}: finding does not exist")
        if not isinstance(item, dict):
            raise ValueError(f"{context}: expected object")

        evidence = _require_string(item, "evidence", context)
        if not evidence.strip():
            raise ValueError(f"{context}.evidence: expected non-empty string")
        has_category = "category" in item
        has_decision = "decision" in item
        if has_category == has_decision:
            raise ValueError(
                f"{context}: expected exactly one of category or decision"
            )

        finding = findings_by_id[finding_id]
        if finding["state"] != "unresolved":
            raise ValueError(
                f"{context}: finding must be unresolved, got {finding['state']}"
            )

        category = item.get("category")
        decision = item.get("decision")
        canonical_id = None
        routed_to = None
        if has_category:
            if category not in CATEGORIES:
                raise ValueError(f"{context}.category: invalid value")
            if category == "missing_feature" and "routedTo" in item:
                routed_to = _require_string(item, "routedTo", context)
        else:
            if decision not in TRIAGE_DECISIONS:
                raise ValueError(f"{context}.decision: invalid value")
            if decision == "duplicate":
                canonical_id = _require_string(item, "canonicalId", context)
                if canonical_id not in findings_by_id:
                    raise ValueError(
                        f"{context}.canonicalId: finding does not exist"
                    )

        validated.append(
            (finding, category, decision, canonical_id, routed_to, evidence)
        )

    accepted = False
    for finding, category, decision, canonical_id, routed_to, evidence in validated:
        if category in ACCEPTED_CATEGORIES:
            new_state = "accepted"
            accepted = True
        elif category == "missing_feature":
            new_state = "deferred"
        elif category == "design_issue":
            new_state = "requires-human"
        else:
            new_state = decision

        finding["state"] = new_state
        if category is not None:
            finding["category"] = category
        if routed_to is not None:
            finding["routedTo"] = routed_to
        if canonical_id is not None:
            finding["canonicalId"] = canonical_id
        finding["history"].append(
            {
                "cycle": cycle,
                "from": "unresolved",
                "to": new_state,
                "by": "triage",
                "evidence": evidence,
                "at": stamp(),
            }
        )

    if accepted:
        manifest["state"] = "remediating"
    save_manifest(root, loop_id, manifest)
    return 0


def cmd_closure_packet(root: Path | str, loop_id: str, cycle: int) -> int:
    root = Path(root)
    manifest = load_manifest(root, loop_id)
    if manifest is None:
        raise ValueError(f"manifest not found for loop '{loop_id}'")
    if manifest["currentCycle"] != cycle:
        raise ValueError(
            f"cycle {cycle} does not match current cycle {manifest['currentCycle']}"
        )

    accepted = [
        finding
        for finding in manifest["findings"]
        if finding["state"] == "accepted"
    ]
    if not accepted:
        raise ValueError("닫을 accepted finding 없음")

    fix_phase = f"{loop_id}-fix-c{cycle}"
    lines = [
        f"# Closure Review — loop {loop_id}, cycle {cycle}",
        "",
        "아래 finding **만** 재검토한다. 신규 finding을 여기서 제기하지 마라(신규는 별도 full 리뷰).",
        "각 finding마다 인용된 근거·스펙에 비추어 주장된 수정을 검증하고 verdict를 정하라.",
        "",
    ]
    for finding in accepted:
        claimed_fix = finding.get("remediationStep") or f"phases/{fix_phase}/"
        specs = ", ".join(finding["specRefs"]) or "-"
        files = ", ".join(finding["evidenceFiles"]) or "-"
        lines.extend(
            [
                f"## {finding['id']} [{finding['severity']}] {finding['title']}",
                f"- Spec: {specs}",
                f"- 원문: {finding['detail']}",
                f"- 주장된 수정: {claimed_fix}",
                f"- 변경 파일: {files}",
                f"- 검증 항목: {specs} 준수 및 회귀 테스트 통과 여부",
                "- Verdict: [ ] resolved  [ ] still-open (사유: ___)",
                "",
            ]
        )
    lines.extend(
        [
            "## 출력",
            f'review-{cycle + 1}.json (kind="closure")을 생성하라. 위 각 ID마다 finding 항목 1개,',
            'severity 불변, closureVerdict ∈ {"resolved","still-open"}.',
            "",
        ]
    )

    cycle_directory = root / "remediation" / loop_id / f"cycle-{cycle}"
    cycle_directory.mkdir(parents=True, exist_ok=True)
    (cycle_directory / "closure-packet.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )

    if not any(item["cycle"] == cycle for item in manifest["cycles"]):
        manifest["cycles"].append(
            {
                "cycle": cycle,
                "fixPhase": fix_phase,
                "review": None,
                "closureReview": None,
                "verdict": None,
                "reasons": [],
            }
        )
    manifest["state"] = "closing"
    save_manifest(root, loop_id, manifest)
    return 0


def cmd_ingest_closure(
    root: Path | str, loop_id: str, review_path: Path | str, cycle: int
) -> int:
    root = Path(root)
    review_path = Path(review_path)
    review = _validate_review(json.loads(review_path.read_text(encoding="utf-8")))
    if review["kind"] != "closure":
        raise ValueError("review.kind must be closure")

    manifest = load_manifest(root, loop_id)
    if manifest is None:
        raise ValueError(f"manifest not found for loop '{loop_id}'")
    if manifest["currentCycle"] != cycle:
        raise ValueError(
            f"cycle {cycle} does not match current cycle {manifest['currentCycle']}"
        )
    if manifest["target"] != review["target"]:
        raise ValueError("review.target does not match existing manifest target")

    findings_by_id = {
        finding["id"]: finding for finding in manifest["findings"]
    }
    accepted_ids = {
        finding["id"]
        for finding in manifest["findings"]
        if finding["state"] == "accepted"
    }
    reviewed_ids = [finding["id"] for finding in review["findings"]]
    if len(reviewed_ids) != len(set(reviewed_ids)):
        raise ValueError("closure review contains duplicate finding id")
    new_ids = set(reviewed_ids) - set(findings_by_id)
    if new_ids:
        raise ValueError(
            f"closure review contains new finding: {', '.join(sorted(new_ids))}"
        )
    nonaccepted_ids = set(reviewed_ids) - accepted_ids
    if nonaccepted_ids:
        raise ValueError(
            "closure finding must be accepted: "
            + ", ".join(sorted(nonaccepted_ids))
        )
    missing_ids = accepted_ids - set(reviewed_ids)
    if missing_ids:
        raise ValueError(
            "closure review missing verdict for accepted finding: "
            + ", ".join(sorted(missing_ids))
        )

    cycle_entry = next(
        (item for item in manifest["cycles"] if item["cycle"] == cycle), None
    )
    if cycle_entry is None:
        raise ValueError(f"closure packet not found for cycle {cycle}")

    for reviewed_finding in review["findings"]:
        finding = findings_by_id[reviewed_finding["id"]]
        verdict = reviewed_finding["closureVerdict"]
        new_state = "resolved" if verdict == "resolved" else "accepted"
        evidence = reviewed_finding["detail"]
        if verdict == "still-open":
            evidence = f"still-open: {evidence}"
        finding["state"] = new_state
        finding["history"].append(
            {
                "cycle": cycle,
                "from": "accepted",
                "to": new_state,
                "by": "closure",
                "evidence": evidence,
                "at": stamp(),
            }
        )

    reviews_directory = root / "remediation" / loop_id / "reviews"
    reviews_directory.mkdir(parents=True, exist_ok=True)
    preserved_review = reviews_directory / f"{review['reviewId']}.json"
    if review_path.resolve() != preserved_review.resolve():
        shutil.copyfile(review_path, preserved_review)
    cycle_entry["closureReview"] = review["reviewId"]
    save_manifest(root, loop_id, manifest)
    return 0


def cmd_status(root: Path | str, loop_id: str) -> int:
    manifest = load_manifest(root, loop_id)
    if manifest is None:
        raise ValueError(f"manifest not found for loop '{loop_id}'")

    print(
        f"loop {manifest['loopId']} — {manifest['state']} "
        f"(cycle {manifest['currentCycle']}/{manifest['maxCycles']})"
    )
    for finding in manifest["findings"]:
        category = finding["category"] if finding["category"] is not None else "-"
        print(
            f"{finding['id']}  {finding['severity']}  {category}  {finding['state']}"
        )
    print(f"cycles: {len(manifest['cycles'])}")
    for cycle in manifest["cycles"]:
        print(
            f"cycle {cycle['cycle']}: review={cycle.get('review', '-')} "
            f"verdict={cycle.get('verdict', '-')}"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest")
    ingest.add_argument("loop_id")
    ingest.add_argument("review_path", type=Path)
    ingest.add_argument("--root", type=Path, default=ROOT)

    apply_triage = subparsers.add_parser("apply-triage")
    apply_triage.add_argument("loop_id")
    apply_triage.add_argument("--cycle", type=int, required=True)
    apply_triage.add_argument("--root", type=Path, default=ROOT)

    closure_packet = subparsers.add_parser("closure-packet")
    closure_packet.add_argument("loop_id")
    closure_packet.add_argument("--cycle", type=int, required=True)
    closure_packet.add_argument("--root", type=Path, default=ROOT)

    ingest_closure = subparsers.add_parser("ingest-closure")
    ingest_closure.add_argument("loop_id")
    ingest_closure.add_argument("review_path", type=Path)
    ingest_closure.add_argument("--cycle", type=int, required=True)
    ingest_closure.add_argument("--root", type=Path, default=ROOT)

    status = subparsers.add_parser("status")
    status.add_argument("loop_id")
    status.add_argument("--root", type=Path, default=ROOT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "ingest":
            return cmd_ingest(args.root, args.loop_id, args.review_path)
        if args.command == "apply-triage":
            return cmd_apply_triage(args.root, args.loop_id, args.cycle)
        if args.command == "closure-packet":
            return cmd_closure_packet(args.root, args.loop_id, args.cycle)
        if args.command == "ingest-closure":
            return cmd_ingest_closure(
                args.root, args.loop_id, args.review_path, args.cycle
            )
        return cmd_status(args.root, args.loop_id)
    except (OSError, ValueError, json.JSONDecodeError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
