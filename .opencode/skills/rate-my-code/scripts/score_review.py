#!/usr/bin/env python3
"""Validate and score a RateMyCode review using only the standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "2"
POLICY_VERSION = "3"
MAX_INPUT_BYTES = 1_048_576
MAX_DIMENSIONS = 32
MAX_EVIDENCE = 512

MODES = {
    "ship-fast",
    "product-lead",
    "staff-engineer",
    "staff-frontend-engineer",
    "hostile-user",
    "skeptical-vc",
    "oral-defense",
}
RELEASE_THRESHOLDS = {
    "internal-demo": Decimal("50"),
    "private-beta": Decimal("65"),
    "public-launch": Decimal("75"),
    "real-money": Decimal("85"),
    "high-stakes": Decimal("90"),
    "venture-case": Decimal("70"),
}
VERIFICATION_FACTORS = {
    "verified": Decimal("1"),
    "partial": Decimal("0.5"),
    "unverified": Decimal("0"),
}
EVIDENCE_KINDS = {
    "runtime",
    "test",
    "code",
    "log",
    "metric",
    "interview",
    "document",
    "claim",
    "eval",
}
EVIDENCE_RESULTS = {"pass", "fail", "mixed", "inconclusive"}
AI_BEHAVIORS = {"none", "llm", "agent", "rag", "mixed"}
EVIDENCE_LANES = {
    "deterministic-checks": {"test", "code"},
    "critical-journey-e2e": {"runtime"},
    "probabilistic-eval": {"eval"},
    "continuous-evidence": {"log", "metric"},
}
VC_EVIDENCE_ASSERTIONS = {
    "real_users": ("vc-real-users", {"runtime", "log", "metric"}),
    "retention": ("vc-retention", {"log", "metric"}),
    "repeatable_distribution": ("vc-repeatable-distribution", {"log", "metric", "document"}),
}
EVIDENCE_ASSERTION_KINDS = {
    **EVIDENCE_LANES,
    **{assertion: kinds for assertion, kinds in VC_EVIDENCE_ASSERTIONS.values()},
}
EVIDENCE_ASSERTIONS = set(EVIDENCE_ASSERTION_KINDS) | {"other"}
LANE_STATUSES = {"PASS", "FAIL", "UNVERIFIED", "N/A"}
AI_MAX_STANDARD_DEVIATION = {
    "internal-demo": 30,
    "private-beta": 25,
    "public-launch": 20,
    "real-money": 15,
    "high-stakes": 10,
    "venture-case": 25,
}
RUNTIME_LEVELS = {"e2e", "partial", "static", "none"}
RUNTIME_CONFIDENCE_CAP = {"e2e": "A", "partial": "B", "static": "C", "none": "D"}
CONFIDENCE_SCORE_CAP = {
    "A": Decimal("100"),
    "B": Decimal("89"),
    "C": Decimal("69"),
    "D": Decimal("49"),
}
SAFETY_GATES = {
    "authorization-bypass": Decimal("39"),
    "sensitive-data-exposure": Decimal("39"),
    "irreversible-data-loss": Decimal("39"),
    "duplicate-real-charge": Decimal("39"),
    "critical-flow-false-success": Decimal("39"),
}
VC_CAPS = {
    "real_users": Decimal("45"),
    "retention": Decimal("60"),
    "repeatable_distribution": Decimal("75"),
}
CONFIDENCE_ORDER = {"A": 0, "B": 1, "C": 2, "D": 3}


class ValidationError(Exception):
    def __init__(self, path: str, message: str) -> None:
        super().__init__(message)
        self.path = path
        self.message = message


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        emit_error("argument_error", "$", message)
        raise SystemExit(2)


def emit_error(code: str, path: str, message: str) -> None:
    payload = {"error": {"code": code, "message": message, "path": path}, "ok": False}
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True), file=sys.stderr)


def reject_constant(value: str) -> None:
    raise ValueError(f"non-finite number {value} is not allowed")


def load_payload(path: Path) -> Any:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise ValidationError("$", f"cannot read input file: {exc.strerror or exc}") from exc
    if size > MAX_INPUT_BYTES:
        raise ValidationError("$", f"input exceeds {MAX_INPUT_BYTES} bytes")
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)
    except UnicodeDecodeError as exc:
        raise ValidationError("$", f"input must be UTF-8: {exc}") from exc
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValidationError("$", f"invalid JSON: {exc}") from exc


def require_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(path, "must be an object")
    return value


def require_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValidationError(path, "must be an array")
    return value


def require_string(value: Any, path: str, allowed: set[str] | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(path, "must be a non-empty string")
    if allowed is not None and value not in allowed:
        raise ValidationError(path, f"must be one of {sorted(allowed)}; received {value!r}")
    return value


def require_sha256(value: Any, path: str) -> str:
    text = require_string(value, path)
    if re.fullmatch(r"sha256:[0-9a-f]{64}", text) is None:
        raise ValidationError(path, "must be an immutable sha256:<64 lowercase hex> release identity")
    return text


def require_versioned_reference(value: Any, path: str) -> str:
    text = require_string(value, path)
    lowered = text.strip().lower()
    if lowered in {"x", "latest", "current", "head", "main", "master", "prod", "production"}:
        raise ValidationError(path, "must identify an immutable or explicitly versioned value")
    has_version_marker = bool(
        ":" in text
        or re.search(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text)
        or re.search(r"(?:^|[-_/])v?[0-9]+(?:\.[0-9]+)+(?:$|[-_/])", text, re.IGNORECASE)
        or re.search(r"[0-9a-f]{7,64}", text, re.IGNORECASE)
    )
    if not has_version_marker:
        raise ValidationError(path, "must identify an immutable or explicitly versioned value")
    return text


def require_bool(value: Any, path: str) -> bool:
    if type(value) is not bool:
        raise ValidationError(path, "must be true or false")
    return value


def require_int(value: Any, path: str, minimum: int, maximum: int) -> int:
    if type(value) is not int:
        raise ValidationError(path, f"must be an integer between {minimum} and {maximum}")
    if value < minimum or value > maximum:
        raise ValidationError(path, f"must be an integer between {minimum} and {maximum}; received {value}")
    return value


def reject_unknown(obj: dict[str, Any], allowed: set[str], path: str) -> None:
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise ValidationError(path, f"unexpected field(s): {', '.join(unknown)}")


def require_fields(obj: dict[str, Any], required: set[str], path: str) -> None:
    missing = sorted(required - set(obj))
    if missing:
        raise ValidationError(path, f"missing required field(s): {', '.join(missing)}")


def validate_provenance(value: Any, path: str) -> dict[str, str]:
    provenance = require_object(value, path)
    required = {"model", "prompt", "eval_set", "judge"}
    allowed = required | {"system"}
    reject_unknown(provenance, allowed, path)
    require_fields(provenance, required, path)
    result = {
        key: require_versioned_reference(provenance[key], f"{path}.{key}")
        for key in sorted(required)
    }
    if "system" in provenance:
        result["system"] = require_versioned_reference(provenance["system"], f"{path}.system")
    return result


def validate_eval_metrics(value: Any, path: str) -> dict[str, int]:
    metrics = require_object(value, path)
    required = {
        "minimum_pass_rate",
        "observed_pass_rate",
        "maximum_standard_deviation",
        "observed_standard_deviation",
    }
    reject_unknown(metrics, required, path)
    require_fields(metrics, required, path)
    result = {
        "minimum_pass_rate": require_int(
            metrics["minimum_pass_rate"], f"{path}.minimum_pass_rate", 1, 100
        ),
        "observed_pass_rate": require_int(
            metrics["observed_pass_rate"], f"{path}.observed_pass_rate", 0, 100
        ),
        "maximum_standard_deviation": require_int(
            metrics["maximum_standard_deviation"],
            f"{path}.maximum_standard_deviation",
            0,
            100,
        ),
        "observed_standard_deviation": require_int(
            metrics["observed_standard_deviation"],
            f"{path}.observed_standard_deviation",
            0,
            100,
        ),
    }
    return result


def validate_evidence(items: Any) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    values = require_list(items, "$.evidence")
    if len(values) > MAX_EVIDENCE:
        raise ValidationError("$.evidence", f"must contain at most {MAX_EVIDENCE} items")
    result: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    required = {"id", "kind", "lane", "result", "reproducible", "fresh", "release_ref"}
    allowed = required | {"runs", "provenance", "eval_metrics", "gate_id"}
    for index, raw in enumerate(values):
        path = f"$.evidence[{index}]"
        item = require_object(raw, path)
        reject_unknown(item, allowed, path)
        require_fields(item, required, path)
        evidence_id = require_string(item["id"], f"{path}.id")
        if evidence_id in by_id:
            raise ValidationError(f"{path}.id", f"duplicate evidence id {evidence_id!r}")
        normalized = {
            "id": evidence_id,
            "kind": require_string(item["kind"], f"{path}.kind", EVIDENCE_KINDS),
            "lane": require_string(item["lane"], f"{path}.lane", EVIDENCE_ASSERTIONS),
            "result": require_string(item["result"], f"{path}.result", EVIDENCE_RESULTS),
            "reproducible": require_bool(item["reproducible"], f"{path}.reproducible"),
            "fresh": require_bool(item["fresh"], f"{path}.fresh"),
            "release_ref": require_sha256(item["release_ref"], f"{path}.release_ref"),
        }
        if "runs" in item:
            normalized["runs"] = require_int(item["runs"], f"{path}.runs", 1, 100_000)
        if "provenance" in item:
            normalized["provenance"] = validate_provenance(item["provenance"], f"{path}.provenance")
        if "eval_metrics" in item:
            normalized["eval_metrics"] = validate_eval_metrics(
                item["eval_metrics"], f"{path}.eval_metrics"
            )
        if "gate_id" in item:
            normalized["gate_id"] = require_string(
                item["gate_id"], f"{path}.gate_id", set(SAFETY_GATES)
            )
        if (
            normalized["lane"] != "other"
            and normalized["kind"] not in EVIDENCE_ASSERTION_KINDS[normalized["lane"]]
        ):
            raise ValidationError(
                f"{path}.lane",
                f"{normalized['kind']!r} evidence cannot support {normalized['lane']!r}",
            )
        eval_only = {"runs", "provenance", "eval_metrics"}.intersection(normalized)
        if normalized["kind"] != "eval" and eval_only:
            raise ValidationError(path, "runs, provenance, and eval_metrics are allowed only for eval evidence")
        if normalized["kind"] == "eval":
            missing_eval = sorted({"runs", "provenance", "eval_metrics"} - set(normalized))
            if missing_eval:
                raise ValidationError(path, f"eval evidence is missing required field(s): {', '.join(missing_eval)}")
        by_id[evidence_id] = normalized
        result.append(normalized)
    return sorted(result, key=lambda item: item["id"]), by_id


def validate_evidence_ids(
    raw_ids: Any,
    path: str,
    evidence_by_id: dict[str, dict[str, Any]],
) -> list[str]:
    values = require_list(raw_ids, path)
    ids: list[str] = []
    for index, value in enumerate(values):
        evidence_id = require_string(value, f"{path}[{index}]")
        if evidence_id not in evidence_by_id:
            raise ValidationError(f"{path}[{index}]", f"unknown evidence id {evidence_id!r}")
        ids.append(evidence_id)
    if len(ids) != len(set(ids)):
        raise ValidationError(path, "must not contain duplicate evidence ids")
    return sorted(ids)


def has_reproducible_non_claim(ids: list[str], evidence: dict[str, dict[str, Any]]) -> bool:
    return any(evidence[item]["kind"] != "claim" and evidence[item]["reproducible"] for item in ids)


def is_fresh_release_evidence(item: dict[str, Any], release_ref: str) -> bool:
    return (
        item["kind"] != "claim"
        and item["reproducible"]
        and item["fresh"]
        and item["release_ref"] == release_ref
    )


def has_fresh_release_evidence(
    ids: list[str], evidence: dict[str, dict[str, Any]], release_ref: str
) -> bool:
    return any(is_fresh_release_evidence(evidence[item], release_ref) for item in ids)


def validate_evidence_lanes(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    release_ref: str,
    ai_behavior: str,
    release_target: str,
) -> dict[str, dict[str, Any]]:
    lanes = require_object(value, "$.evidence_lanes")
    expected = set(EVIDENCE_LANES)
    reject_unknown(lanes, expected, "$.evidence_lanes")
    require_fields(lanes, expected, "$.evidence_lanes")
    result: dict[str, dict[str, Any]] = {}
    claimed_ids: set[str] = set()
    for lane_id in EVIDENCE_LANES:
        path = f"$.evidence_lanes.{lane_id}"
        lane = require_object(lanes[lane_id], path)
        required = {"status", "evidence_ids"}
        allowed = required | {"reason"}
        reject_unknown(lane, allowed, path)
        require_fields(lane, required, path)
        status = require_string(lane["status"], f"{path}.status", LANE_STATUSES)
        ids = validate_evidence_ids(lane["evidence_ids"], f"{path}.evidence_ids", evidence_by_id)
        overlap = sorted(claimed_ids.intersection(ids))
        if overlap:
            raise ValidationError(f"{path}.evidence_ids", f"evidence cannot substitute across lanes: {overlap}")
        claimed_ids.update(ids)
        reason = None
        if status == "N/A":
            reason = require_string(lane.get("reason"), f"{path}.reason")
        elif "reason" in lane:
            raise ValidationError(f"{path}.reason", "is allowed only when status is 'N/A'")
        if status in {"UNVERIFIED", "N/A"} and ids:
            raise ValidationError(f"{path}.evidence_ids", f"must be empty when status is {status!r}")
        if status in {"PASS", "FAIL"}:
            cited = [evidence_by_id[item_id] for item_id in ids]
            if not cited or not all(
                item["lane"] == lane_id
                and item["kind"] in EVIDENCE_LANES[lane_id]
                and is_fresh_release_evidence(item, release_ref)
                for item in cited
            ):
                raise ValidationError(
                    f"{path}.evidence_ids",
                    f"{status} requires only fresh reproducible {lane_id} evidence bound to release_ref",
                )
            if status == "PASS" and any(item["result"] != "pass" for item in cited):
                raise ValidationError(
                    f"{path}.evidence_ids", "PASS cannot hide fail, mixed, or inconclusive evidence"
                )
            if status == "PASS" and any(
                item["lane"] == lane_id
                and is_fresh_release_evidence(item, release_ref)
                and item["result"] in {"fail", "mixed", "inconclusive"}
                for item in evidence_by_id.values()
            ):
                raise ValidationError(
                    f"{path}.evidence_ids",
                    "PASS cannot omit fresh same-release fail, mixed, or inconclusive lane evidence",
                )
            if status == "FAIL" and not any(item["result"] in {"fail", "mixed"} for item in cited):
                raise ValidationError(
                    f"{path}.evidence_ids", "FAIL requires at least one fail or mixed evidence item"
                )
            if lane_id == "probabilistic-eval":
                if sum(item["runs"] for item in cited) < 2:
                    raise ValidationError(
                        f"{path}.evidence_ids", "probabilistic-eval PASS/FAIL requires repeated runs"
                    )
                identities = [item["provenance"] for item in cited]
                if any(identity != identities[0] for identity in identities[1:]):
                    raise ValidationError(
                        f"{path}.evidence_ids",
                        "probabilistic-eval evidence must share one model, prompt, eval-set, judge, and system identity",
                    )
                threshold_pairs = {
                    (
                        item["eval_metrics"]["minimum_pass_rate"],
                        item["eval_metrics"]["maximum_standard_deviation"],
                    )
                    for item in cited
                }
                if len(threshold_pairs) != 1:
                    raise ValidationError(
                        f"{path}.evidence_ids",
                        "probabilistic-eval evidence must share one predeclared threshold policy",
                    )
                for item in cited:
                    provenance = item["provenance"]
                    if ai_behavior in {"agent", "rag", "mixed"} and "system" not in provenance:
                        raise ValidationError(
                            f"{path}.evidence_ids",
                            "agent/RAG eval evidence must bind tool or retrieval system provenance",
                        )
                    metrics = item["eval_metrics"]
                    if metrics["minimum_pass_rate"] < int(RELEASE_THRESHOLDS[release_target]):
                        raise ValidationError(
                            f"{path}.evidence_ids",
                            "minimum pass rate cannot be below the selected release-readiness threshold",
                        )
                    if (
                        metrics["maximum_standard_deviation"]
                        > AI_MAX_STANDARD_DEVIATION[release_target]
                    ):
                        raise ValidationError(
                            f"{path}.evidence_ids",
                            "maximum standard deviation is too permissive for the selected release target",
                        )
                    metrics_pass = (
                        metrics["observed_pass_rate"] >= metrics["minimum_pass_rate"]
                        and metrics["observed_standard_deviation"]
                        <= metrics["maximum_standard_deviation"]
                    )
                    if status == "PASS" and not metrics_pass:
                        raise ValidationError(
                            f"{path}.evidence_ids",
                            "probabilistic-eval PASS must meet its declared pass-rate and variance thresholds",
                        )
        if lane_id == "probabilistic-eval":
            if ai_behavior == "none" and status != "N/A":
                raise ValidationError(f"{path}.status", "must be 'N/A' when ai_behavior is 'none'")
            if ai_behavior != "none" and status == "N/A":
                raise ValidationError(f"{path}.status", "cannot be 'N/A' for LLM, agent, or RAG behavior")
        normalized = {"status": status, "evidence_ids": ids}
        if reason is not None:
            normalized["reason"] = reason
        result[lane_id] = normalized
    return result


def validate_dimensions(
    items: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    release_ref: str,
) -> list[dict[str, Any]]:
    values = require_list(items, "$.dimensions")
    if not values or len(values) > MAX_DIMENSIONS:
        raise ValidationError("$.dimensions", f"must contain between 1 and {MAX_DIMENSIONS} items")
    allowed = {"id", "weight", "score", "verification", "evidence_ids"}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    total_weight = 0
    for index, raw in enumerate(values):
        path = f"$.dimensions[{index}]"
        item = require_object(raw, path)
        reject_unknown(item, allowed, path)
        require_fields(item, allowed, path)
        dimension_id = require_string(item["id"], f"{path}.id")
        if dimension_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate dimension id {dimension_id!r}")
        seen.add(dimension_id)
        weight = require_int(item["weight"], f"{path}.weight", 1, 100)
        score = require_int(item["score"], f"{path}.score", 0, 100)
        verification = require_string(
            item["verification"], f"{path}.verification", set(VERIFICATION_FACTORS)
        )
        evidence_ids = validate_evidence_ids(item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id)
        if verification == "verified" and not has_fresh_release_evidence(
            evidence_ids, evidence_by_id, release_ref
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "verified requires fresh reproducible non-claim evidence bound to release_ref",
            )
        if verification == "partial" and not evidence_ids:
            raise ValidationError(f"{path}.evidence_ids", "partial requires at least one evidence id")
        total_weight += weight
        result.append(
            {
                "id": dimension_id,
                "weight": weight,
                "score": score,
                "verification": verification,
                "evidence_ids": evidence_ids,
            }
        )
    if total_weight != 100:
        raise ValidationError("$.dimensions", f"weights must total 100; received {total_weight}")
    return sorted(result, key=lambda item: item["id"])


def validate_coverage(value: Any) -> dict[str, Any]:
    coverage = require_object(value, "$.coverage")
    allowed = {"runtime", "critical_paths"}
    reject_unknown(coverage, allowed, "$.coverage")
    require_fields(coverage, allowed, "$.coverage")
    runtime = require_string(coverage["runtime"], "$.coverage.runtime", RUNTIME_LEVELS)
    critical = require_object(coverage["critical_paths"], "$.coverage.critical_paths")
    reject_unknown(critical, {"total", "tested"}, "$.coverage.critical_paths")
    require_fields(critical, {"total", "tested"}, "$.coverage.critical_paths")
    total = require_int(critical["total"], "$.coverage.critical_paths.total", 0, 10_000)
    tested = require_int(critical["tested"], "$.coverage.critical_paths.tested", 0, 10_000)
    if tested > total:
        raise ValidationError("$.coverage.critical_paths.tested", f"must be <= total ({total}); received {tested}")
    if runtime in {"static", "none"} and tested != 0:
        raise ValidationError("$.coverage.critical_paths.tested", f"must be 0 when runtime is {runtime!r}")
    if runtime in {"partial", "e2e"} and total == 0:
        raise ValidationError("$.coverage.critical_paths.total", f"must be greater than 0 when runtime is {runtime!r}")
    if runtime == "partial" and not 0 < tested < total:
        raise ValidationError(
            "$.coverage.critical_paths.tested",
            "must be greater than 0 and less than total when runtime is 'partial'",
        )
    if runtime == "e2e" and tested != total:
        raise ValidationError(
            "$.coverage.critical_paths.tested",
            "must equal total when runtime is 'e2e'",
        )
    return {"runtime": runtime, "critical_paths": {"total": total, "tested": tested}}


def validate_gates(
    items: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    release_ref: str,
) -> list[dict[str, Any]]:
    values = require_list(items, "$.gates")
    required = {"id", "state", "evidence_ids", "retest_evidence_ids"}
    allowed = required | {"affected_targets"}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(values):
        path = f"$.gates[{index}]"
        item = require_object(raw, path)
        reject_unknown(item, allowed, path)
        require_fields(item, required, path)
        gate_id = require_string(item["id"], f"{path}.id", set(SAFETY_GATES))
        if gate_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate gate id {gate_id!r}")
        seen.add(gate_id)
        state = require_string(item["state"], f"{path}.state", {"active", "fixed"})
        evidence_ids = validate_evidence_ids(item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id)
        retest_ids = validate_evidence_ids(
            item["retest_evidence_ids"], f"{path}.retest_evidence_ids", evidence_by_id
        )
        if "affected_targets" in item:
            target_values = require_list(item["affected_targets"], f"{path}.affected_targets")
            if not target_values:
                raise ValidationError(f"{path}.affected_targets", "must contain at least one release target")
            affected_targets = [
                require_string(
                    value,
                    f"{path}.affected_targets[{target_index}]",
                    set(RELEASE_THRESHOLDS),
                )
                for target_index, value in enumerate(target_values)
            ]
            if len(affected_targets) != len(set(affected_targets)):
                raise ValidationError(f"{path}.affected_targets", "must not contain duplicate release targets")
            affected_targets.sort()
        else:
            affected_targets = sorted(RELEASE_THRESHOLDS)
        if state == "active":
            if not any(
                evidence_by_id[item_id]["kind"] in {"runtime", "test", "log", "metric"}
                and evidence_by_id[item_id]["result"] in {"fail", "mixed"}
                and evidence_by_id[item_id].get("gate_id") == gate_id
                and is_fresh_release_evidence(evidence_by_id[item_id], release_ref)
                for item_id in evidence_ids
            ):
                raise ValidationError(
                    f"{path}.evidence_ids",
                    "active gate requires fresh same-release fail/mixed evidence explicitly bound to this gate",
                )
        else:
            valid_retest = any(
                evidence_by_id[item_id]["kind"] in {"runtime", "test"}
                and evidence_by_id[item_id]["result"] == "pass"
                and evidence_by_id[item_id].get("gate_id") == gate_id
                and is_fresh_release_evidence(evidence_by_id[item_id], release_ref)
                for item_id in retest_ids
            )
            if not valid_retest:
                raise ValidationError(
                    f"{path}.retest_evidence_ids",
                    "fixed gate requires fresh passing runtime or test evidence explicitly bound to this gate",
                )
        result.append(
            {
                "id": gate_id,
                "state": state,
                "evidence_ids": evidence_ids,
                "retest_evidence_ids": retest_ids,
                "affected_targets": affected_targets,
            }
        )
    return sorted(result, key=lambda item: item["id"])


def validate_release_checks(
    items: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    release_ref: str,
) -> list[dict[str, Any]]:
    values = require_list(items, "$.release_checks")
    if not values:
        raise ValidationError("$.release_checks", "must contain at least one explicit release check")
    allowed = {"id", "required", "status", "evidence_ids"}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(values):
        path = f"$.release_checks[{index}]"
        item = require_object(raw, path)
        reject_unknown(item, allowed, path)
        require_fields(item, allowed, path)
        check_id = require_string(item["id"], f"{path}.id")
        if check_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate release check id {check_id!r}")
        seen.add(check_id)
        required = require_bool(item["required"], f"{path}.required")
        status = require_string(item["status"], f"{path}.status", {"pass", "fail", "unverified"})
        evidence_ids = validate_evidence_ids(item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id)
        if status == "pass" and not has_fresh_release_evidence(
            evidence_ids, evidence_by_id, release_ref
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "pass requires fresh reproducible evidence bound to release_ref whose kind is not claim",
            )
        if status == "pass" and any(
            evidence_by_id[item_id]["result"] != "pass" for item_id in evidence_ids
        ):
            raise ValidationError(
                f"{path}.evidence_ids", "pass may cite only passing evidence"
            )
        if status == "fail" and not any(
            evidence_by_id[item_id]["result"] in {"fail", "mixed"}
            and is_fresh_release_evidence(evidence_by_id[item_id], release_ref)
            for item_id in evidence_ids
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "fail requires fresh reproducible fail or mixed evidence bound to release_ref",
            )
        result.append(
            {"id": check_id, "required": required, "status": status, "evidence_ids": evidence_ids}
        )
    return sorted(result, key=lambda item: item["id"])


def validate_vc_signals(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    release_ref: str,
) -> dict[str, dict[str, Any]]:
    signals = require_object(value, "$.vc_signals")
    expected = set(VC_CAPS)
    reject_unknown(signals, expected, "$.vc_signals")
    require_fields(signals, expected, "$.vc_signals")
    result: dict[str, dict[str, Any]] = {}
    claimed_ids: set[str] = set()
    for key in sorted(expected):
        path = f"$.vc_signals.{key}"
        signal = require_object(signals[key], path)
        allowed = {"status", "evidence_ids"}
        reject_unknown(signal, allowed, path)
        require_fields(signal, allowed, path)
        status = require_string(signal["status"], f"{path}.status", {"present", "missing", "unknown"})
        ids = validate_evidence_ids(signal["evidence_ids"], f"{path}.evidence_ids", evidence_by_id)
        overlap = sorted(claimed_ids.intersection(ids))
        if overlap:
            raise ValidationError(
                f"{path}.evidence_ids",
                f"venture evidence cannot substitute across signals: {overlap}",
            )
        claimed_ids.update(ids)
        if status == "present":
            assertion, _ = VC_EVIDENCE_ASSERTIONS[key]
            if not ids or not all(
                evidence_by_id[item_id]["lane"] == assertion
                and evidence_by_id[item_id]["result"] == "pass"
                and is_fresh_release_evidence(evidence_by_id[item_id], release_ref)
                for item_id in ids
            ):
                raise ValidationError(
                    f"{path}.evidence_ids",
                    f"present requires fresh passing {assertion} evidence bound to release_ref",
                )
        result[key] = {"status": status, "evidence_ids": ids}
    return result


def validate(payload: Any) -> dict[str, Any]:
    root = require_object(payload, "$")
    required = {
        "schema_version",
        "mode",
        "rubric_id",
        "release_target",
        "release_ref",
        "ai_behavior",
        "dimensions",
        "evidence",
        "evidence_lanes",
        "coverage",
        "gates",
        "release_checks",
    }
    allowed = required | {"vc_signals"}
    reject_unknown(root, allowed, "$")
    require_fields(root, required, "$")
    schema_version = require_string(root["schema_version"], "$.schema_version")
    if schema_version != SCHEMA_VERSION:
        raise ValidationError("$.schema_version", f"must equal {SCHEMA_VERSION!r}; received {schema_version!r}")
    mode = require_string(root["mode"], "$.mode", MODES)
    rubric_id = require_string(root["rubric_id"], "$.rubric_id")
    release_target = require_string(root["release_target"], "$.release_target", set(RELEASE_THRESHOLDS))
    release_ref = require_sha256(root["release_ref"], "$.release_ref")
    ai_behavior = require_string(root["ai_behavior"], "$.ai_behavior", AI_BEHAVIORS)
    if mode == "skeptical-vc" and release_target != "venture-case":
        raise ValidationError("$.release_target", "skeptical-vc mode requires 'venture-case'")
    if mode != "skeptical-vc" and release_target == "venture-case":
        raise ValidationError("$.release_target", "'venture-case' requires skeptical-vc mode")
    evidence, evidence_by_id = validate_evidence(root["evidence"])
    evidence_lanes = validate_evidence_lanes(
        root["evidence_lanes"], evidence_by_id, release_ref, ai_behavior, release_target
    )
    dimensions = validate_dimensions(root["dimensions"], evidence_by_id, release_ref)
    coverage = validate_coverage(root["coverage"])
    if coverage["runtime"] in {"partial", "e2e"} and evidence_lanes["critical-journey-e2e"]["status"] not in {"PASS", "FAIL"}:
        raise ValidationError(
            "$.evidence_lanes.critical-journey-e2e.status",
            f"must be 'PASS' or 'FAIL' when runtime coverage is {coverage['runtime']!r}",
        )
    if coverage["runtime"] in {"static", "none"} and evidence_lanes["critical-journey-e2e"]["status"] == "PASS":
        raise ValidationError(
            "$.evidence_lanes.critical-journey-e2e.status",
            f"cannot be 'PASS' when runtime coverage is {coverage['runtime']!r}",
        )
    gates = validate_gates(root["gates"], evidence_by_id, release_ref)
    release_checks = validate_release_checks(root["release_checks"], evidence_by_id, release_ref)
    if mode == "skeptical-vc":
        if "vc_signals" not in root:
            raise ValidationError("$", "skeptical-vc mode requires vc_signals")
        vc_signals = validate_vc_signals(root["vc_signals"], evidence_by_id, release_ref)
    else:
        if "vc_signals" in root:
            raise ValidationError("$.vc_signals", "is allowed only in skeptical-vc mode")
        vc_signals = None
    return {
        "schema_version": schema_version,
        "mode": mode,
        "rubric_id": rubric_id,
        "release_target": release_target,
        "release_ref": release_ref,
        "ai_behavior": ai_behavior,
        "dimensions": dimensions,
        "evidence": evidence,
        "evidence_lanes": evidence_lanes,
        "coverage": coverage,
        "gates": gates,
        "release_checks": release_checks,
        "vc_signals": vc_signals,
    }


def quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def as_json_number(value: Decimal) -> int | float:
    value = quantize(value)
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def confidence_for(evidence_percent: Decimal, critical_percent: Decimal, runtime: str) -> str:
    if evidence_percent >= 85 and critical_percent >= 80:
        base = "A"
    elif evidence_percent >= 65 and critical_percent >= 50:
        base = "B"
    elif evidence_percent >= 40:
        base = "C"
    else:
        base = "D"
    runtime_cap = RUNTIME_CONFIDENCE_CAP[runtime]
    return base if CONFIDENCE_ORDER[base] >= CONFIDENCE_ORDER[runtime_cap] else runtime_cap


def compute(data: dict[str, Any]) -> dict[str, Any]:
    dimensions_output: list[dict[str, Any]] = []
    raw_score = Decimal("0")
    evidence_percent = Decimal("0")
    for dimension in data["dimensions"]:
        score = Decimal(dimension["score"])
        weight = Decimal(dimension["weight"])
        contribution = score * weight / Decimal("100")
        raw_score += contribution
        evidence_percent += weight * VERIFICATION_FACTORS[dimension["verification"]]
        dimensions_output.append(
            {
                "contribution": as_json_number(contribution),
                "id": dimension["id"],
                "score": dimension["score"],
                "verification": dimension["verification"],
                "weight": dimension["weight"],
            }
        )

    critical = data["coverage"]["critical_paths"]
    critical_percent = (
        Decimal(critical["tested"]) * Decimal("100") / Decimal(critical["total"])
        if critical["total"]
        else Decimal("0")
    )
    confidence = confidence_for(evidence_percent, critical_percent, data["coverage"]["runtime"])
    applied_caps: list[dict[str, Any]] = [
        {"id": f"confidence-{confidence.lower()}", "source": "evidence-confidence", "value": as_json_number(CONFIDENCE_SCORE_CAP[confidence])}
    ]
    active_gates: list[dict[str, Any]] = []
    blocking_gates: list[dict[str, Any]] = []
    for gate in data["gates"]:
        if gate["state"] == "active":
            cap = SAFETY_GATES[gate["id"]]
            gate_output = {
                "affected_targets": gate["affected_targets"],
                "cap": as_json_number(cap),
                "id": gate["id"],
            }
            active_gates.append(gate_output)
            if data["release_target"] in gate["affected_targets"]:
                blocking_gates.append(gate_output)
                applied_caps.append(
                    {"id": gate["id"], "source": "safety-gate", "value": as_json_number(cap)}
                )

    if data["vc_signals"] is not None:
        for signal_id, signal in data["vc_signals"].items():
            if signal["status"] != "present":
                cap = VC_CAPS[signal_id]
                applied_caps.append(
                    {"id": f"vc-{signal_id}", "source": "venture-evidence", "value": as_json_number(cap)}
                )

    readiness_score = min([raw_score] + [Decimal(str(item["value"])) for item in applied_caps])
    threshold = RELEASE_THRESHOLDS[data["release_target"]]
    required_failed = [
        item["id"] for item in data["release_checks"] if item["required"] and item["status"] == "fail"
    ]
    required_unverified = [
        item["id"]
        for item in data["release_checks"]
        if item["required"] and item["status"] == "unverified"
    ]
    optional_gaps = [
        item["id"]
        for item in data["release_checks"]
        if not item["required"] and item["status"] != "pass"
    ]
    required_lanes: set[str] = set()
    if data["mode"] != "skeptical-vc":
        required_lanes.add("critical-journey-e2e")
        if data["release_target"] != "internal-demo":
            required_lanes.add("deterministic-checks")
        if data["release_target"] in {"public-launch", "real-money", "high-stakes"}:
            required_lanes.add("continuous-evidence")
        if data["ai_behavior"] != "none":
            required_lanes.add("probabilistic-eval")
    failed_lanes = sorted(
        lane_id
        for lane_id in required_lanes
        if data["evidence_lanes"][lane_id]["status"] == "FAIL"
    )
    unverified_lanes = sorted(
        lane_id
        for lane_id in required_lanes
        if data["evidence_lanes"][lane_id]["status"] in {"UNVERIFIED", "N/A"}
    )
    runtime_insufficient = data["mode"] != "skeptical-vc" and data["coverage"]["runtime"] in {
        "static",
        "none",
    }

    if blocking_gates:
        decision = "BLOCKED"
    elif required_failed or failed_lanes:
        decision = "NOT_READY"
    elif required_unverified or unverified_lanes or runtime_insufficient:
        decision = "INSUFFICIENT_EVIDENCE"
    elif readiness_score < threshold:
        decision = "NOT_READY"
    elif optional_gaps:
        decision = "READY_WITH_CONDITIONS"
    else:
        decision = "READY"

    fingerprint_payload = {
        "dimensions": [{"id": item["id"], "weight": item["weight"]} for item in data["dimensions"]],
        "mode": data["mode"],
        "release_target": data["release_target"],
        "rubric_id": data["rubric_id"],
    }
    fingerprint_bytes = json.dumps(
        fingerprint_payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    fingerprint = "sha256:" + hashlib.sha256(fingerprint_bytes).hexdigest()

    return {
        "active_gates": active_gates,
        "applied_caps": sorted(applied_caps, key=lambda item: (item["value"], item["id"])),
        "blocking_gates": blocking_gates,
        "coverage": {
            "confidence": confidence,
            "critical_paths_percent": as_json_number(critical_percent),
            "evidence_percent": as_json_number(evidence_percent),
            "runtime": data["coverage"]["runtime"],
        },
        "evidence_lanes": data["evidence_lanes"],
        "ai_behavior": data["ai_behavior"],
        "decision": decision,
        "dimensions": dimensions_output,
        "mode": data["mode"],
        "ok": True,
        "policy_version": POLICY_VERSION,
        "release_checks": {
            "failed_required": required_failed,
            "failed_evidence_lanes": failed_lanes,
            "optional_gaps": optional_gaps,
            "unverified_evidence_lanes": unverified_lanes,
            "unverified_required": required_unverified,
        },
        "release_ref": data["release_ref"],
        "release_target": data["release_target"],
        "release_threshold": as_json_number(threshold),
        "rubric_fingerprint": fingerprint,
        "rubric_id": data["rubric_id"],
        "schema_version": SCHEMA_VERSION,
        "scores": {
            "raw_product": as_json_number(raw_score),
            "readiness": as_json_number(readiness_score),
        },
        "vetoed": bool(blocking_gates),
    }


def render(result: dict[str, Any], pretty: bool) -> str:
    if pretty:
        return json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    return json.dumps(
        result,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument("--pretty", action="store_true", help="pretty-print deterministic JSON")
    parser.add_argument("input", type=Path, help="path to a scorecard JSON file")
    args = parser.parse_args(argv)
    try:
        result = compute(validate(load_payload(args.input)))
    except ValidationError as exc:
        emit_error("validation_error", exc.path, exc.message)
        return 1
    sys.stdout.write(render(result, args.pretty))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
