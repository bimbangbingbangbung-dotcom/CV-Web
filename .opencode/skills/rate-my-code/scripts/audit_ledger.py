#!/usr/bin/env python3
"""Validate and render a persistent RateMyCode audit ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


# The chain's whole claim is that prior bytes stand unchanged. A validator that
# only knows today's rules forces old snapshots to be rewritten to stay valid,
# which contradicts that claim — so it keeps the older rule sets and validates
# each document under the version it declares. Bump on any change to a required
# field, not only on a large one: version 3 silently meant four different field
# sets in a single day before this existed.
SCHEMA_VERSION = "5"
SUPPORTED_SCHEMA_VERSIONS = ("3", "4", "5")
MAX_INPUT_BYTES = 2_097_152
SHA256_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
RECORDED_AT_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
CHANGE_REF_PATTERN = re.compile(
    r"(?:git:[0-9a-f]{40}|patch-sha256:[0-9a-f]{64}|sha256:[0-9a-f]{64})"
)
PRINCIPAL_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9:._/@-]{0,127}")
ID_PATTERNS = {
    "finding": re.compile(r"F-[0-9]{3}"),
    "unknown": re.compile(r"U-[0-9]{3}"),
    "root_cause": re.compile(r"RC-[0-9]{3}"),
    "evidence": re.compile(r"E-[0-9]{3}"),
    "blocker": re.compile(r"B-[0-9]{3}"),
    "proposal": re.compile(r"P-[0-9]{3}"),
}

ROLES = {
    "product-lead",
    "hostile-user",
    "staff-engineer",
    "staff-frontend-engineer",
    "skeptical-vc",
    "oral-defense",
}
DEGREES = {
    "quick-check",
    "strict-review",
    "launch-gate",
    "real-stakes",
    "life-or-death",
}
TARGETS = {
    "internal-demo",
    "private-beta",
    "public-launch",
    "real-money",
    "high-stakes",
    "venture-case",
}
AI_BEHAVIORS = {"none", "llm", "agent", "rag", "mixed"}
IDENTITY_METHODS = {"sha256-file", "sha256-tree", "sha256-deployment-manifest"}
SYMLINK_POLICIES = {"reject-all", "hash-link-metadata", "follow-within-root"}
MAXIMUM_SAFE_TARGETS = TARGETS | {"no-supported-release-tier", "not-assessed"}
LOOP_MODES = {"report-only", "fix-prompts", "fix-and-retest"}
DECISIONS = {
    "READY",
    "READY_WITH_CONDITIONS",
    "NOT_READY",
    "BLOCKED",
    "INSUFFICIENT_EVIDENCE",
}
VENTURE_DECISIONS = {
    "INVESTABLE",
    "INTERESTING_BUT_UNPROVEN",
    "NOT_INVESTABLE_YET",
    "INSUFFICIENT_EVIDENCE",
}
VENTURE_SIGNALS = {
    "real_users": {"runtime", "log", "metric"},
    "retention": {"log", "metric"},
    "repeatable_distribution": {"log", "metric", "document"},
}
VENTURE_SIGNAL_STATUSES = {"present", "missing", "unknown"}
VENTURE_STAGE_BY_DEGREE = {
    "quick-check": "screening",
    "strict-review": "structured-diligence",
    "launch-gate": "partner-review",
    "real-stakes": "full-diligence",
    "life-or-death": "investment-committee",
}
VENTURE_MATURITY_BY_SIGNAL_COUNT = {
    0: "claims-only",
    1: "single-signal",
    2: "multi-signal",
    3: "complete",
}
SEVERITIES = {"BLOCKER", "HIGH", "MEDIUM", "LOW"}
SEVERITY_ORDER = {"BLOCKER": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
# Extent of condition: the same defect at other locations. Bounded and mechanical.
CONDITION_SWEEP_STATES = {"unswept", "unsweepable", "swept", "closed"}
CONDITION_SWEEP_METHODS = {
    "none",
    "text-search",
    "static-query",
    "type-check",
    "manual-enumeration",
}
# Converting every instance is one way to close a class, not the only one. A
# chokepoint makes the remaining instances unreachable; a ratchet freezes the
# count under enforcement so it can only decrease.
CONDITION_SWEEP_CLOSURES = {"converted", "chokepoint", "ratchet", "accepted-risk"}
# Extent of cause: what else the same root cause produced. Unbounded, so it is
# required only where the consequence of missing it justifies the cost.
CAUSE_SWEEP_STATES = {"pending", "done"}
SWEEP_STRICT_DEGREES = {"launch-gate", "real-stakes", "life-or-death"}
# Thoroughness cannot be measured, but narrowness can be refuted: plant an
# instance of the class that differs from the original the way real instances
# differ, and see whether the recorded expression finds it. Same vocabulary as
# the mutation check on a fix, because it is the same idea pointed sideways.
SEEDED_CHECK_RESULTS = {"killed", "survived", "not-applicable"}
# A fix nothing misses is not a fix. Same instrument as the mutation check on
# the acceptance test, pointed at the change instead of at the defect: take the
# fix back out and something has to go red.
SEEDED_WRITE_RESULTS = {"unwritable", "written", "not-attempted"}
# Closures that claim an ongoing control rather than a finished conversion.
ENFORCED_CLOSURES = {"chokepoint", "ratchet"}
# What the instance count is counted against. `structural` enumerates a
# population the code itself defines — API call sites, router entries, schema
# tables — so the number means something and cannot be lowered by rewriting the
# search. `pattern` counts occurrences of a shape the reviewer invented, which
# is a symptom count and not a class size.
SWEEP_DENOMINATORS = {"structural", "pattern"}
CLOSED_FINDING_STATUSES = {"verified-fixed", "accepted-risk"}
# A finding asserts that the product broke a promise. That assertion is a claim
# like any other, and it is the one claim the schema used to take on trust: name
# where the promise is, or what is missing is a capability, not a defect.
PROMISE_SOURCES = {
    "ui-copy",
    "documentation",
    "api-contract",
    "implied-by-behavior",
    "user-stated",
    "regulatory",
}
# What the product never promised is the reviewer's idea. Useful, often worth
# building — but it carries no severity, cannot gate a release, and closes by
# being scheduled or declined rather than fixed or risk-accepted.
PROPOSAL_STATUSES = {"proposed", "scheduled", "declined"}
FINDING_STATUSES = {
    "open",
    "fixing",
    "fixed-pending-retest",
    "verified-fixed",
    "partially-fixed",
    "not-fixed",
    "regressed",
    "unverifiable",
    "blocked",
    "accepted-risk",
}
FINDING_STATUS_TRANSITIONS = {
    "open": FINDING_STATUSES,
    "fixing": FINDING_STATUSES - {"open"},
    "fixed-pending-retest": FINDING_STATUSES - {"open", "fixing"},
    "verified-fixed": {"verified-fixed", "regressed", "accepted-risk", "blocked"},
    "partially-fixed": FINDING_STATUSES - {"open"},
    "not-fixed": FINDING_STATUSES - {"open"},
    "regressed": FINDING_STATUSES - {"open"},
    "unverifiable": FINDING_STATUSES - {"open"},
    "blocked": FINDING_STATUSES - {"open"},
    "accepted-risk": FINDING_STATUSES - {"open"},
}
RETEST_STATE_MAP = {
    "verified-fixed": "FIXED",
    "partially-fixed": "PARTIALLY_FIXED",
    "not-fixed": "NOT_FIXED",
    "regressed": "REGRESSED",
    "unverifiable": "UNVERIFIABLE",
}
EVIDENCE_STATES = {"E0", "E1", "E2", "E3"}
EVIDENCE_KINDS = {
    "runtime",
    "test",
    "code",
    "log",
    "metric",
    "eval",
    "interview",
    "document",
    "claim",
}
EVIDENCE_LANES = {
    "deterministic-checks": {"test", "code"},
    "critical-journey-e2e": {"runtime"},
    "probabilistic-eval": {"eval"},
    "continuous-evidence": {"log", "metric"},
    "other": EVIDENCE_KINDS,
}
EVIDENCE_RESULTS = {"pass", "fail", "mixed", "inconclusive"}
PROCEDURES = {
    "reproduction",
    "acceptance",
    "adjacent-regression",
    "mutation",
    "unknown-resolution",
    "release-lane",
    # Running the recorded sweep expression, or demonstrating that a chokepoint
    # or ratchet actually refuses a new instance of the class.
    "class-sweep",
}
LANE_STATUSES = {"PASS", "FAIL", "UNVERIFIED", "N/A"}
GATE_IDS = {
    "authorization-bypass",
    "sensitive-data-exposure",
    "irreversible-data-loss",
    "duplicate-real-charge",
    "critical-flow-false-success",
}
REVIEWER_CONTEXTS = {"fresh-context", "independent-agent", "external-reviewer"}
CHECK_RESULTS = {"pass", "fail", "unverified"}
MUTATION_RESULTS = {"killed", "survived", "not-applicable"}
RELEASE_CHECK_STATUSES = {"pass", "fail", "unverified"}
RELEASE_ORDER = {
    "internal-demo": 0,
    "private-beta": 1,
    "public-launch": 2,
    "real-money": 3,
    "high-stakes": 4,
}
RELEASE_THRESHOLDS = {
    "internal-demo": 50,
    "private-beta": 65,
    "public-launch": 75,
    "real-money": 85,
    "high-stakes": 90,
    "venture-case": 70,
}
AI_MAX_STANDARD_DEVIATION = {
    "internal-demo": 30,
    "private-beta": 25,
    "public-launch": 20,
    "real-money": 15,
    "high-stakes": 10,
    "venture-case": 25,
}
BIDI_CONTROL_CHARACTERS = frozenset(
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
)


def required_evidence_lanes(requested_target: str, ai_behavior: str) -> set[str]:
    """Return the evidence lanes that can determine this review's release verdict."""

    required: set[str] = set()
    if requested_target != "venture-case":
        required.add("critical-journey-e2e")
    if requested_target in {"private-beta", "public-launch", "real-money", "high-stakes"}:
        required.add("deterministic-checks")
    if requested_target in {"public-launch", "real-money", "high-stakes"}:
        required.add("continuous-evidence")
    if ai_behavior != "none" and requested_target != "venture-case":
        required.add("probabilistic-eval")
    return required


class ValidationError(ValueError):
    """A ledger validation failure with a JSON-style path."""

    def __init__(self, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.path = path
        self.message = message


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if any(
            unicodedata.category(character) == "Cc"
            or character in BIDI_CONTROL_CHARACTERS
            for character in key
        ):
            raise ValidationError(
                "$", "JSON object keys must not contain control or bidirectional override characters"
            )
        if key in result:
            raise ValidationError("$", f"duplicate JSON object key {key!r}")
        result[key] = value
    return result


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
    if any(
        (
            unicodedata.category(character) == "Cc" and character not in "\t\n\r"
        )
        or character in BIDI_CONTROL_CHARACTERS
        for character in value
    ):
        raise ValidationError(
            path, "must not contain terminal, control, or bidirectional override characters"
        )
    if allowed is not None and value not in allowed:
        raise ValidationError(path, f"must be one of {sorted(allowed)}")
    return value


def require_bool(value: Any, path: str) -> bool:
    if type(value) is not bool:
        raise ValidationError(path, "must be a boolean")
    return value


def require_int(value: Any, path: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise ValidationError(path, f"must be an integer between {minimum} and {maximum}")
    return value


def require_nullable_bool(value: Any, path: str) -> bool | None:
    if value is None:
        return None
    return require_bool(value, path)


def require_nullable_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return require_string(value, path)


def require_exact_fields(value: dict[str, Any], fields: set[str], path: str) -> None:
    missing = sorted(fields - set(value))
    extra = sorted(set(value) - fields)
    if missing:
        raise ValidationError(path, f"missing required field(s): {', '.join(missing)}")
    if extra:
        raise ValidationError(path, f"contains unknown field(s): {', '.join(extra)}")


def require_allowed_fields(
    value: dict[str, Any], required: set[str], allowed: set[str], path: str
) -> None:
    missing = sorted(required - set(value))
    extra = sorted(set(value) - allowed)
    if missing:
        raise ValidationError(path, f"missing required field(s): {', '.join(missing)}")
    if extra:
        raise ValidationError(path, f"contains unknown field(s): {', '.join(extra)}")


def require_sha256(value: Any, path: str) -> str:
    result = require_string(value, path)
    if not SHA256_PATTERN.fullmatch(result):
        raise ValidationError(path, "must be sha256:<64 lowercase hex>")
    return result


def require_principal_id(value: Any, path: str) -> str:
    result = require_string(value, path)
    if not PRINCIPAL_ID_PATTERN.fullmatch(result):
        raise ValidationError(
            path, "must be a 1–128 character stable ID using letters, digits, ':._/@-'"
        )
    return result


def require_versioned_reference(value: Any, path: str) -> str:
    result = require_string(value, path)
    lowered = result.strip().lower()
    moving_tokens = {"x", "latest", "current", "head", "main", "master", "prod", "production"}
    if lowered in moving_tokens or any(
        lowered.endswith(f"{separator}{token}")
        for separator in (":", "/", "@", "-")
        for token in moving_tokens
    ):
        raise ValidationError(path, "must identify an immutable or explicitly versioned value")
    if not (
        re.search(r"[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8}", result)
        or re.search(r"(?:^|[-_/:@.])v?[0-9]+(?:\.[0-9]+)*(?:$|[-_/:@.])", result, re.I)
        or re.search(r"[0-9a-f]{7,64}", result, re.I)
    ):
        raise ValidationError(path, "must identify an immutable or explicitly versioned value")
    return result


def require_id(value: Any, path: str, kind: str) -> str:
    result = require_string(value, path)
    if not ID_PATTERNS[kind].fullmatch(result):
        raise ValidationError(path, f"must match {ID_PATTERNS[kind].pattern}")
    return result


def require_string_list(
    value: Any, path: str, *, minimum: int = 0, unique: bool = False
) -> list[str]:
    values = require_list(value, path)
    if len(values) < minimum:
        raise ValidationError(path, f"must contain at least {minimum} item(s)")
    result = [require_string(item, f"{path}[{index}]") for index, item in enumerate(values)]
    if unique and len(result) != len(set(result)):
        raise ValidationError(path, "must not contain duplicates")
    return result


def validate_identity_scope(value: Any) -> dict[str, Any]:
    path = "$.artifact.identity_scope"
    item = require_object(value, path)
    require_exact_fields(
        item, {"root", "included", "excluded", "symlink_policy"}, path
    )
    return {
        "root": require_string(item["root"], f"{path}.root"),
        "included": require_string_list(
            item["included"], f"{path}.included", minimum=1, unique=True
        ),
        "excluded": require_string_list(
            item["excluded"], f"{path}.excluded", unique=True
        ),
        "symlink_policy": require_string(
            item["symlink_policy"], f"{path}.symlink_policy", SYMLINK_POLICIES
        ),
    }


def validate_eval_provenance(value: Any, path: str) -> dict[str, str]:
    item = require_object(value, path)
    required = {"model", "prompt", "eval_set", "judge"}
    require_allowed_fields(item, required, required | {"system"}, path)
    result = {
        key: require_versioned_reference(item[key], f"{path}.{key}")
        for key in sorted(required)
    }
    if "system" in item:
        result["system"] = require_versioned_reference(item["system"], f"{path}.system")
    return result


def validate_eval_metrics(value: Any, path: str) -> dict[str, int]:
    item = require_object(value, path)
    fields = {
        "minimum_pass_rate",
        "observed_pass_rate",
        "maximum_standard_deviation",
        "observed_standard_deviation",
    }
    require_exact_fields(item, fields, path)
    return {
        "minimum_pass_rate": require_int(
            item["minimum_pass_rate"], f"{path}.minimum_pass_rate", 1, 100
        ),
        "observed_pass_rate": require_int(
            item["observed_pass_rate"], f"{path}.observed_pass_rate", 0, 100
        ),
        "maximum_standard_deviation": require_int(
            item["maximum_standard_deviation"],
            f"{path}.maximum_standard_deviation",
            0,
            100,
        ),
        "observed_standard_deviation": require_int(
            item["observed_standard_deviation"],
            f"{path}.observed_standard_deviation",
            0,
            100,
        ),
    }


def validate_evidence(value: Any) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    items = require_list(value, "$.evidence")
    result: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    required = {
        "id",
        "state",
        "kind",
        "lane",
        "result",
        "reproducible",
        "fresh",
        "release_ref",
        "summary",
        "locator",
        "subject_id",
        "procedure",
    }
    allowed = required | {
        "gate_id",
        "workflow_blocker_id",
        "release_check_id",
        "venture_signal_id",
        "deployment_coverage",
        "runs",
        "provenance",
        "eval_metrics",
    }
    for index, raw in enumerate(items):
        path = f"$.evidence[{index}]"
        item = require_object(raw, path)
        require_allowed_fields(item, required, allowed, path)
        evidence_id = require_id(item["id"], f"{path}.id", "evidence")
        if evidence_id in by_id:
            raise ValidationError(f"{path}.id", f"duplicate evidence id {evidence_id!r}")
        kind = require_string(item["kind"], f"{path}.kind", EVIDENCE_KINDS)
        lane = require_string(item["lane"], f"{path}.lane", set(EVIDENCE_LANES))
        if kind not in EVIDENCE_LANES[lane]:
            raise ValidationError(f"{path}.lane", f"{kind!r} evidence cannot support {lane!r}")
        normalized = {
            "id": evidence_id,
            "state": require_string(item["state"], f"{path}.state", EVIDENCE_STATES),
            "kind": kind,
            "lane": lane,
            "result": require_string(item["result"], f"{path}.result", EVIDENCE_RESULTS),
            "reproducible": require_bool(item["reproducible"], f"{path}.reproducible"),
            "fresh": require_bool(item["fresh"], f"{path}.fresh"),
            "release_ref": require_sha256(item["release_ref"], f"{path}.release_ref"),
            "summary": require_string(item["summary"], f"{path}.summary"),
            "locator": require_string(item["locator"], f"{path}.locator"),
            "subject_id": require_nullable_string(item["subject_id"], f"{path}.subject_id"),
            "procedure": require_string(item["procedure"], f"{path}.procedure", PROCEDURES),
        }
        if lane in {
            "critical-journey-e2e",
            "probabilistic-eval",
            "continuous-evidence",
        } and normalized["state"] not in {"E2", "E3"}:
            raise ValidationError(
                f"{path}.state", f"{lane} evidence must be E2 or E3"
            )
        if normalized["kind"] == "claim" and normalized["state"] != "E0":
            raise ValidationError(f"{path}.state", "claim evidence must be E0")
        if normalized["kind"] == "eval" and normalized["state"] not in {"E2", "E3"}:
            raise ValidationError(f"{path}.state", "eval evidence must be E2 or E3")
        subject_id = normalized["subject_id"]
        if subject_id is not None and not (
            ID_PATTERNS["finding"].fullmatch(subject_id)
            or ID_PATTERNS["unknown"].fullmatch(subject_id)
        ):
            raise ValidationError(
                f"{path}.subject_id", "must match F-[0-9]{3}, U-[0-9]{3}, or be null"
            )
        if normalized["procedure"] == "release-lane":
            if subject_id is not None:
                raise ValidationError(
                    f"{path}.subject_id", "release-lane evidence must have a null subject_id"
                )
        elif subject_id is None:
            raise ValidationError(
                f"{path}.subject_id", f"{normalized['procedure']} evidence requires a subject_id"
            )
        if normalized["procedure"] == "unknown-resolution" and not (
            subject_id is not None and ID_PATTERNS["unknown"].fullmatch(subject_id)
        ):
            raise ValidationError(
                f"{path}.subject_id", "unknown-resolution evidence requires a U-### subject"
            )
        if normalized["procedure"] in {
            "reproduction",
            "acceptance",
            "adjacent-regression",
            "mutation",
        } and not (subject_id is not None and ID_PATTERNS["finding"].fullmatch(subject_id)):
            raise ValidationError(
                f"{path}.subject_id", f"{normalized['procedure']} evidence requires an F-### subject"
            )
        if "gate_id" in item:
            normalized["gate_id"] = require_string(
                item["gate_id"], f"{path}.gate_id", GATE_IDS
            )
        if "release_check_id" in item:
            normalized["release_check_id"] = require_principal_id(
                item["release_check_id"], f"{path}.release_check_id"
            )
        if "workflow_blocker_id" in item:
            normalized["workflow_blocker_id"] = require_id(
                item["workflow_blocker_id"], f"{path}.workflow_blocker_id", "blocker"
            )
        if "venture_signal_id" in item:
            normalized["venture_signal_id"] = require_string(
                item["venture_signal_id"],
                f"{path}.venture_signal_id",
                set(VENTURE_SIGNALS),
            )
        bindings = {
            field
            for field in (
                "gate_id",
                "workflow_blocker_id",
                "release_check_id",
                "venture_signal_id",
            )
            if field in normalized
        }
        if len(bindings) > 1:
            raise ValidationError(
                path,
                "one evidence record cannot substitute across gate, workflow-blocker, release-check, and venture-signal bindings",
            )
        if bindings.intersection(
            {"workflow_blocker_id", "release_check_id", "venture_signal_id"}
        ) and (
            normalized["procedure"] != "release-lane" or subject_id is not None
        ):
            raise ValidationError(
                path,
                "workflow-blocker, release-check, and venture-signal evidence must use release-lane with a null subject_id",
            )
        if "deployment_coverage" in item:
            coverage_path = f"{path}.deployment_coverage"
            coverage = require_object(item["deployment_coverage"], coverage_path)
            require_exact_fields(
                coverage, {"scope_complete", "compensating_layer_ruled_out"}, coverage_path
            )
            if kind not in {"code", "document"}:
                raise ValidationError(
                    coverage_path, "is allowed only for code or document evidence"
                )
            normalized["deployment_coverage"] = {
                "scope_complete": require_bool(
                    coverage["scope_complete"], f"{coverage_path}.scope_complete"
                ),
                "compensating_layer_ruled_out": require_bool(
                    coverage["compensating_layer_ruled_out"],
                    f"{coverage_path}.compensating_layer_ruled_out",
                ),
            }
        eval_fields = {"runs", "provenance", "eval_metrics"}
        present_eval_fields = eval_fields.intersection(item)
        if kind != "eval" and present_eval_fields:
            raise ValidationError(
                path, "runs, provenance, and eval_metrics are allowed only for eval evidence"
            )
        if kind == "eval":
            missing_eval_fields = sorted(eval_fields - set(item))
            if missing_eval_fields:
                raise ValidationError(
                    path,
                    f"eval evidence is missing required field(s): {', '.join(missing_eval_fields)}",
                )
            normalized["runs"] = require_int(item["runs"], f"{path}.runs", 1, 100_000)
            normalized["provenance"] = validate_eval_provenance(
                item["provenance"], f"{path}.provenance"
            )
            normalized["eval_metrics"] = validate_eval_metrics(
                item["eval_metrics"], f"{path}.eval_metrics"
            )
        result.append(normalized)
        by_id[evidence_id] = normalized
    return sorted(result, key=lambda item: item["id"]), by_id


def validate_evidence_ids(
    value: Any,
    path: str,
    evidence_by_id: dict[str, dict[str, Any]],
    *,
    minimum: int = 0,
) -> list[str]:
    ids = require_string_list(value, path, minimum=minimum, unique=True)
    for index, evidence_id in enumerate(ids):
        if evidence_id not in evidence_by_id:
            raise ValidationError(f"{path}[{index}]", f"unknown evidence id {evidence_id!r}")
    return sorted(ids)


def validate_evidence_lanes(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
    ai_behavior: str,
    requested_target: str,
) -> dict[str, dict[str, Any]]:
    path = "$.evidence_lanes"
    lanes = require_object(value, path)
    expected = set(EVIDENCE_LANES) - {"other"}
    require_exact_fields(lanes, expected, path)
    normalized: dict[str, dict[str, Any]] = {}
    used_ids: set[str] = set()
    for lane_id in sorted(expected):
        lane_path = f"{path}.{lane_id}"
        lane = require_object(lanes[lane_id], lane_path)
        require_allowed_fields(lane, {"status", "evidence_ids"}, {"status", "evidence_ids", "reason"}, lane_path)
        status = require_string(lane["status"], f"{lane_path}.status", LANE_STATUSES)
        evidence_ids = validate_evidence_ids(
            lane["evidence_ids"], f"{lane_path}.evidence_ids", evidence_by_id
        )
        overlap = used_ids.intersection(evidence_ids)
        if overlap:
            raise ValidationError(
                f"{lane_path}.evidence_ids",
                f"evidence cannot appear in multiple lanes: {', '.join(sorted(overlap))}",
            )
        used_ids.update(evidence_ids)
        if status in {"UNVERIFIED", "N/A"} and evidence_ids:
            raise ValidationError(
                f"{lane_path}.evidence_ids", f"must be empty when status is {status!r}"
            )
        if status == "N/A":
            if "reason" not in lane:
                raise ValidationError(lane_path, "N/A requires a reason")
            reason = require_string(lane["reason"], f"{lane_path}.reason")
        elif "reason" in lane:
            raise ValidationError(f"{lane_path}.reason", "is allowed only when status is N/A")
        else:
            reason = None
        if status in {"PASS", "FAIL"}:
            if not evidence_ids:
                raise ValidationError(
                    f"{lane_path}.evidence_ids", f"{status} requires evidence"
                )
            cited = [evidence_by_id[item_id] for item_id in evidence_ids]
            if any(
                record["lane"] != lane_id
                or record["state"] == "E0"
                or not record["fresh"]
                or not record["reproducible"]
                or record["release_ref"] != current_release_ref
                for record in cited
            ):
                raise ValidationError(
                    f"{lane_path}.evidence_ids",
                    f"{status} requires non-E0, fresh, reproducible {lane_id} evidence bound to the current release",
                )
            if lane_id in {
                "critical-journey-e2e",
                "probabilistic-eval",
                "continuous-evidence",
            } and any(record["state"] not in {"E2", "E3"} for record in cited):
                raise ValidationError(
                    f"{lane_path}.evidence_ids",
                    f"{lane_id} requires E2 or E3 machine/runtime evidence",
                )
            if status == "PASS":
                if any(record["result"] != "pass" for record in cited):
                    raise ValidationError(
                        f"{lane_path}.evidence_ids", "PASS may cite only passing evidence"
                    )
                if any(
                    record["lane"] == lane_id
                    and record["state"] != "E0"
                    and record["fresh"]
                    and record["reproducible"]
                    and record["release_ref"] == current_release_ref
                    and record["result"] != "pass"
                    for record in evidence_by_id.values()
                ):
                    raise ValidationError(
                        f"{lane_path}.status",
                        "PASS cannot hide fresh same-release fail, mixed, or inconclusive evidence",
                    )
            elif not any(record["result"] in {"fail", "mixed"} for record in cited):
                raise ValidationError(
                    f"{lane_path}.evidence_ids", "FAIL requires fail or mixed evidence"
                )
            if lane_id == "probabilistic-eval":
                if sum(record["runs"] for record in cited) < 2:
                    raise ValidationError(
                        f"{lane_path}.evidence_ids",
                        "probabilistic-eval PASS/FAIL requires at least two runs",
                    )
                provenance = cited[0]["provenance"]
                if any(record["provenance"] != provenance for record in cited[1:]):
                    raise ValidationError(
                        f"{lane_path}.evidence_ids",
                        "probabilistic-eval evidence must share one model, prompt, eval-set, judge, and system identity",
                    )
                threshold_policies = {
                    (
                        record["eval_metrics"]["minimum_pass_rate"],
                        record["eval_metrics"]["maximum_standard_deviation"],
                    )
                    for record in cited
                }
                if len(threshold_policies) != 1:
                    raise ValidationError(
                        f"{lane_path}.evidence_ids",
                        "probabilistic-eval evidence must share one predeclared threshold policy",
                    )
                for record in cited:
                    if ai_behavior in {"agent", "rag", "mixed"} and "system" not in record[
                        "provenance"
                    ]:
                        raise ValidationError(
                            f"{lane_path}.evidence_ids",
                            "agent/RAG eval evidence must bind tool or retrieval system provenance",
                        )
                    metrics = record["eval_metrics"]
                    if metrics["minimum_pass_rate"] < RELEASE_THRESHOLDS[requested_target]:
                        raise ValidationError(
                            f"{lane_path}.evidence_ids",
                            "minimum pass rate cannot be below the selected decision threshold",
                        )
                    if (
                        metrics["maximum_standard_deviation"]
                        > AI_MAX_STANDARD_DEVIATION[requested_target]
                    ):
                        raise ValidationError(
                            f"{lane_path}.evidence_ids",
                            "maximum standard deviation is too permissive for the selected target",
                        )
                    metrics_pass = (
                        metrics["observed_pass_rate"] >= metrics["minimum_pass_rate"]
                        and metrics["observed_standard_deviation"]
                        <= metrics["maximum_standard_deviation"]
                    )
                    if status == "PASS" and not metrics_pass:
                        raise ValidationError(
                            f"{lane_path}.evidence_ids",
                            "probabilistic-eval PASS must meet its pass-rate and variance thresholds",
                        )
                if status == "FAIL" and all(
                    record["eval_metrics"]["observed_pass_rate"]
                    >= record["eval_metrics"]["minimum_pass_rate"]
                    and record["eval_metrics"]["observed_standard_deviation"]
                    <= record["eval_metrics"]["maximum_standard_deviation"]
                    for record in cited
                ):
                    raise ValidationError(
                        f"{lane_path}.status",
                        "probabilistic-eval FAIL requires at least one observed threshold failure",
                    )
        current_lane_failures = [
            record
            for record in evidence_by_id.values()
            if record["lane"] == lane_id
            and record["state"] != "E0"
            and record["fresh"]
            and record["reproducible"]
            and record["release_ref"] == current_release_ref
            and record["result"] in {"fail", "mixed"}
        ]
        if current_lane_failures and status != "FAIL":
            raise ValidationError(
                f"{lane_path}.status",
                "fresh same-release fail or mixed evidence requires lane status FAIL",
            )
        item = {"status": status, "evidence_ids": evidence_ids}
        if reason is not None:
            item["reason"] = reason
        normalized[lane_id] = item
    is_venture_review = requested_target == "venture-case"
    if is_venture_review and any(
        lane["status"] != "N/A" for lane in normalized.values()
    ):
        raise ValidationError(
            path,
            "venture-case keeps software release lanes separate; mark every lane N/A with a reason",
        )
    if not is_venture_review and ai_behavior == "none" and normalized["probabilistic-eval"]["status"] != "N/A":
        raise ValidationError(
            f"{path}.probabilistic-eval.status", "must be N/A when ai_behavior is none"
        )
    if not is_venture_review and ai_behavior != "none" and normalized["probabilistic-eval"]["status"] == "N/A":
        raise ValidationError(
            f"{path}.probabilistic-eval.status", "cannot be N/A for LLM, agent, or RAG behavior"
        )
    for lane_id in required_evidence_lanes(requested_target, ai_behavior):
        if normalized[lane_id]["status"] == "N/A":
            raise ValidationError(
                f"{path}.{lane_id}.status", "a required evidence lane cannot be N/A"
            )
    return normalized


def validate_workflow_blockers(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
) -> list[dict[str, Any]]:
    items = require_list(value, "$.workflow_blockers")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    used_evidence: set[str] = set()
    fields = {
        "id",
        "status",
        "reason",
        "missing_requirement",
        "resolving_action",
        "resolution_evidence_ids",
    }
    for index, raw in enumerate(items):
        path = f"$.workflow_blockers[{index}]"
        item = require_object(raw, path)
        require_exact_fields(item, fields, path)
        blocker_id = require_id(item["id"], f"{path}.id", "blocker")
        if blocker_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate workflow blocker id {blocker_id!r}")
        seen.add(blocker_id)
        status = require_string(
            item["status"], f"{path}.status", {"active", "resolved"}
        )
        evidence_ids = validate_evidence_ids(
            item["resolution_evidence_ids"],
            f"{path}.resolution_evidence_ids",
            evidence_by_id,
        )
        overlap = used_evidence.intersection(evidence_ids)
        if overlap:
            raise ValidationError(
                f"{path}.resolution_evidence_ids",
                f"evidence cannot resolve multiple workflow blockers: {', '.join(sorted(overlap))}",
            )
        used_evidence.update(evidence_ids)
        if status == "active" and evidence_ids:
            raise ValidationError(
                f"{path}.resolution_evidence_ids", "must be empty while the blocker is active"
            )
        if status == "resolved":
            if not evidence_ids:
                raise ValidationError(
                    f"{path}.resolution_evidence_ids",
                    "a resolved blocker requires current passing evidence",
                )
            records = [evidence_by_id[evidence_id] for evidence_id in evidence_ids]
            if any(
                record.get("workflow_blocker_id") != blocker_id
                or record["state"] == "E0"
                or record["result"] != "pass"
                or not record["fresh"]
                or not record["reproducible"]
                or record["release_ref"] != current_release_ref
                for record in records
            ):
                raise ValidationError(
                    f"{path}.resolution_evidence_ids",
                    "resolved requires evidence bound to this blocker and non-E0, fresh, reproducible passing evidence on the current release",
                )
        result.append(
            {
                "id": blocker_id,
                "status": status,
                "reason": require_string(item["reason"], f"{path}.reason"),
                "missing_requirement": require_string(
                    item["missing_requirement"], f"{path}.missing_requirement"
                ),
                "resolving_action": require_string(
                    item["resolving_action"], f"{path}.resolving_action"
                ),
                "resolution_evidence_ids": evidence_ids,
            }
        )
    known_blockers = {item["id"]: item for item in result}
    for evidence_id, record in evidence_by_id.items():
        blocker_id = record.get("workflow_blocker_id")
        if blocker_id is None:
            continue
        if blocker_id not in known_blockers:
            raise ValidationError(
                f"$.evidence[{evidence_id}].workflow_blocker_id",
                f"unknown workflow-blocker id {blocker_id!r}",
            )
        if evidence_id not in known_blockers[blocker_id]["resolution_evidence_ids"]:
            raise ValidationError(
                f"$.evidence[{evidence_id}].workflow_blocker_id",
                "blocker-bound evidence must appear in that workflow blocker",
            )
    return sorted(result, key=lambda item: item["id"])


def validate_release_checks(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
) -> list[dict[str, Any]]:
    items = require_list(value, "$.release_checks")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    used_evidence: set[str] = set()
    fields = {"id", "required", "status", "evidence_ids"}
    for index, raw in enumerate(items):
        path = f"$.release_checks[{index}]"
        item = require_object(raw, path)
        require_exact_fields(item, fields, path)
        check_id = require_principal_id(item["id"], f"{path}.id")
        if check_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate release-check id {check_id!r}")
        seen.add(check_id)
        status = require_string(
            item["status"], f"{path}.status", RELEASE_CHECK_STATUSES
        )
        evidence_ids = validate_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id
        )
        overlap = used_evidence.intersection(evidence_ids)
        if overlap:
            raise ValidationError(
                f"{path}.evidence_ids",
                f"evidence cannot substitute across release checks: {', '.join(sorted(overlap))}",
            )
        used_evidence.update(evidence_ids)
        if status == "unverified":
            if evidence_ids:
                raise ValidationError(
                    f"{path}.evidence_ids", "must be empty when status is unverified"
                )
        else:
            if not evidence_ids:
                raise ValidationError(
                    f"{path}.evidence_ids", f"{status} requires current evidence"
                )
            evidence = [evidence_by_id[item_id] for item_id in evidence_ids]
            if any(
                record.get("release_check_id") != check_id
                or
                record["state"] == "E0"
                or not record["fresh"]
                or not record["reproducible"]
                or record["release_ref"] != current_release_ref
                for record in evidence
            ):
                raise ValidationError(
                    f"{path}.evidence_ids",
                    "release checks require evidence bound to this check and non-E0, fresh, reproducible evidence on the current release",
                )
            if status == "pass" and any(record["result"] != "pass" for record in evidence):
                raise ValidationError(
                    f"{path}.evidence_ids", "a passing release check may cite only passes"
                )
            if status == "pass" and any(
                record.get("release_check_id") == check_id
                and record["state"] != "E0"
                and record["fresh"]
                and record["reproducible"]
                and record["release_ref"] == current_release_ref
                and record["result"] != "pass"
                for record in evidence_by_id.values()
            ):
                raise ValidationError(
                    f"{path}.status",
                    "pass cannot hide fresh same-release failure bound to this check",
                )
            if status == "fail" and not any(
                record["result"] in {"fail", "mixed"} for record in evidence
            ):
                raise ValidationError(
                    f"{path}.evidence_ids", "a failing release check needs fail or mixed evidence"
                )
        result.append(
            {
                "id": check_id,
                "required": require_bool(item["required"], f"{path}.required"),
                "status": status,
                "evidence_ids": evidence_ids,
            }
        )
    known_checks = {item["id"]: item for item in result}
    for evidence_id, record in evidence_by_id.items():
        check_id = record.get("release_check_id")
        if check_id is None:
            continue
        if check_id not in known_checks:
            raise ValidationError(
                f"$.evidence[{evidence_id}].release_check_id",
                f"unknown release-check id {check_id!r}",
            )
        if evidence_id not in known_checks[check_id]["evidence_ids"]:
            raise ValidationError(
                f"$.evidence[{evidence_id}].release_check_id",
                "check-bound evidence must appear in that release check",
            )
    return sorted(result, key=lambda item: item["id"])


def validate_scoring(value: Any) -> dict[str, Any]:
    path = "$.scoring"
    item = require_object(value, path)
    require_exact_fields(item, {"requested", "threshold_met", "scorecard_ref"}, path)
    requested = require_bool(item["requested"], f"{path}.requested")
    threshold_met = require_nullable_bool(item["threshold_met"], f"{path}.threshold_met")
    scorecard_ref = (
        None
        if item["scorecard_ref"] is None
        else require_sha256(item["scorecard_ref"], f"{path}.scorecard_ref")
    )
    if requested and (threshold_met is None or scorecard_ref is None):
        raise ValidationError(
            path, "requested scoring requires threshold_met and an immutable scorecard_ref"
        )
    if not requested and (threshold_met is not None or scorecard_ref is not None):
        raise ValidationError(
            path, "threshold_met and scorecard_ref must be null when scoring was not requested"
        )
    return {
        "requested": requested,
        "threshold_met": threshold_met,
        "scorecard_ref": scorecard_ref,
    }


def validate_venture_assessment(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
    is_venture_review: bool,
    degree: str,
) -> dict[str, Any] | None:
    path = "$.venture_assessment"
    if value is None:
        if is_venture_review:
            raise ValidationError(path, "is required for skeptical-vc reviews")
        return None
    if not is_venture_review:
        raise ValidationError(path, "must be null outside skeptical-vc reviews")
    item = require_object(value, path)
    fields = {
        "stage",
        "evidence_maturity",
        "strongest_proven_signal",
        "largest_unsupported_leap",
        "signals",
    }
    require_exact_fields(item, fields, path)
    signals = require_object(item["signals"], f"{path}.signals")
    require_exact_fields(signals, set(VENTURE_SIGNALS), f"{path}.signals")
    normalized_signals: dict[str, dict[str, Any]] = {}
    used_evidence: set[str] = set()
    for signal_id in sorted(VENTURE_SIGNALS):
        signal_path = f"{path}.signals.{signal_id}"
        signal = require_object(signals[signal_id], signal_path)
        require_exact_fields(signal, {"status", "evidence_ids"}, signal_path)
        status = require_string(
            signal["status"], f"{signal_path}.status", VENTURE_SIGNAL_STATUSES
        )
        evidence_ids = validate_evidence_ids(
            signal["evidence_ids"], f"{signal_path}.evidence_ids", evidence_by_id
        )
        overlap = used_evidence.intersection(evidence_ids)
        if overlap:
            raise ValidationError(
                f"{signal_path}.evidence_ids",
                f"evidence cannot substitute across venture signals: {', '.join(sorted(overlap))}",
            )
        used_evidence.update(evidence_ids)
        if status == "present":
            if not evidence_ids:
                raise ValidationError(
                    f"{signal_path}.evidence_ids", "present requires behavioral evidence"
                )
            evidence = [evidence_by_id[item_id] for item_id in evidence_ids]
            if any(
                record["state"] == "E0"
                or record.get("venture_signal_id") != signal_id
                or record["kind"] not in VENTURE_SIGNALS[signal_id]
                or record["result"] != "pass"
                or not record["fresh"]
                or not record["reproducible"]
                or record["release_ref"] != current_release_ref
                for record in evidence
            ):
                raise ValidationError(
                    f"{signal_path}.evidence_ids",
                    "present requires matching non-E0, passing behavioral evidence on the current artifact",
                )
        elif evidence_ids:
            raise ValidationError(
                f"{signal_path}.evidence_ids", f"must be empty when status is {status}"
            )
        normalized_signals[signal_id] = {"status": status, "evidence_ids": evidence_ids}
    for evidence_id, record in evidence_by_id.items():
        signal_id = record.get("venture_signal_id")
        if signal_id is not None and evidence_id not in normalized_signals[signal_id][
            "evidence_ids"
        ]:
            raise ValidationError(
                f"$.evidence[{evidence_id}].venture_signal_id",
                "signal-bound evidence must appear in that venture signal",
            )
    expected_stage = VENTURE_STAGE_BY_DEGREE[degree]
    stage = require_string(item["stage"], f"{path}.stage")
    if stage != expected_stage:
        raise ValidationError(
            f"{path}.stage",
            f"degree {degree!r} requires venture stage {expected_stage!r}",
        )
    present_signals = [
        signal_id
        for signal_id, signal in normalized_signals.items()
        if signal["status"] == "present"
    ]
    expected_maturity = VENTURE_MATURITY_BY_SIGNAL_COUNT[len(present_signals)]
    evidence_maturity = require_string(
        item["evidence_maturity"], f"{path}.evidence_maturity"
    )
    if evidence_maturity != expected_maturity:
        raise ValidationError(
            f"{path}.evidence_maturity",
            f"must be {expected_maturity!r} for {len(present_signals)} present venture signal(s)",
        )
    strongest_proven_signal = require_string(
        item["strongest_proven_signal"], f"{path}.strongest_proven_signal"
    )
    if (
        strongest_proven_signal == "none" and present_signals
    ) or (
        strongest_proven_signal != "none"
        and strongest_proven_signal not in present_signals
    ):
        raise ValidationError(
            f"{path}.strongest_proven_signal",
            "must be 'none' when no signal is present, otherwise name a present venture signal",
        )
    return {
        "stage": stage,
        "evidence_maturity": evidence_maturity,
        "strongest_proven_signal": strongest_proven_signal,
        "largest_unsupported_leap": require_string(
            item["largest_unsupported_leap"], f"{path}.largest_unsupported_leap"
        ),
        "signals": normalized_signals,
    }


def validate_authorization(value: Any, path: str) -> dict[str, str] | None:
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"authorized_by", "statement", "scope"}, path)
    authorized_by = require_string(item["authorized_by"], f"{path}.authorized_by")
    if authorized_by != "user":
        raise ValidationError(
            f"{path}.authorized_by", "must be 'user'; an agent cannot authorize its own fix"
        )
    return {
        "authorized_by": authorized_by,
        "statement": require_string(item["statement"], f"{path}.statement"),
        "scope": require_string(item["scope"], f"{path}.scope"),
    }


def validate_fix(value: Any, path: str) -> dict[str, str] | None:
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"origin", "actor_id", "change_ref", "summary"}, path)
    change_ref = require_string(item["change_ref"], f"{path}.change_ref")
    if not CHANGE_REF_PATTERN.fullmatch(change_ref):
        raise ValidationError(
            f"{path}.change_ref",
            "must be an immutable git:<40 hex>, patch-sha256:<64 hex>, or sha256:<64 hex> reference",
        )
    return {
        "origin": require_string(
            item["origin"], f"{path}.origin", {"authorized-agent", "external-change"}
        ),
        "actor_id": require_principal_id(item["actor_id"], f"{path}.actor_id"),
        "change_ref": change_ref,
        "summary": require_string(item["summary"], f"{path}.summary"),
    }


def validate_risk_acceptance(value: Any, path: str) -> dict[str, str] | None:
    if value is None:
        return None
    item = require_object(value, path)
    require_allowed_fields(
        item,
        {"accepted_by", "statement", "scope"},
        {"accepted_by", "statement", "scope", "rationale"},
        path,
    )
    accepted_by = require_string(item["accepted_by"], f"{path}.accepted_by")
    if accepted_by != "user":
        raise ValidationError(
            f"{path}.accepted_by", "must be 'user'; an agent cannot accept risk for the user"
        )
    result = {
        "accepted_by": accepted_by,
        "statement": require_string(item["statement"], f"{path}.statement"),
        "scope": require_string(item["scope"], f"{path}.scope"),
    }
    if "rationale" in item:
        result["rationale"] = require_string(item["rationale"], f"{path}.rationale")
    return result


def validate_blocker(value: Any, path: str) -> dict[str, str] | None:
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"reason", "missing_requirement", "resolving_action"}, path)
    return {
        "reason": require_string(item["reason"], f"{path}.reason"),
        "missing_requirement": require_string(
            item["missing_requirement"], f"{path}.missing_requirement"
        ),
        "resolving_action": require_string(item["resolving_action"], f"{path}.resolving_action"),
    }


def _validate_revert_mutation(value: Any, path: str) -> tuple[dict[str, Any], str]:
    """Take the change back out; something has to go red."""
    revert = require_object(value, path)
    require_exact_fields(revert, {"status", "reason"}, path)
    status = require_string(revert["status"], f"{path}.status", MUTATION_RESULTS)
    reason = require_nullable_string(revert["reason"], f"{path}.reason")
    if status == "not-applicable" and not reason:
        raise ValidationError(
            f"{path}.reason",
            "not-applicable requires why removing the change could not be observed",
        )
    if status != "not-applicable" and reason:
        raise ValidationError(f"{path}.reason", "is allowed only for not-applicable")
    return {"status": status, "reason": reason}, status


def validate_retest(
    value: Any,
    path: str,
    evidence_by_id: dict[str, dict[str, Any]],
    schema_version: str,
) -> dict[str, Any] | None:
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(
        item,
        {
            "classification",
            "reviewer_id",
            "reviewer_context",
            "release_ref",
            "evidence_ids",
            "acceptance_test",
            "adjacent_regression_check",
            "mutation_test",
        }
        | ({"revert_mutation"} if schema_version >= "4" else set()),
        path,
    )
    mutation_path = f"{path}.mutation_test"
    mutation = require_object(item["mutation_test"], mutation_path)
    require_allowed_fields(mutation, {"status"}, {"status", "reason"}, mutation_path)
    mutation_status = require_string(
        mutation["status"], f"{mutation_path}.status", MUTATION_RESULTS
    )
    if mutation_status == "not-applicable":
        if "reason" not in mutation:
            raise ValidationError(mutation_path, "not-applicable requires a reason")
        mutation_reason = require_string(mutation["reason"], f"{mutation_path}.reason")
    elif "reason" in mutation:
        raise ValidationError(f"{mutation_path}.reason", "is allowed only for not-applicable")
    else:
        mutation_reason = None
    normalized_mutation = {"status": mutation_status}
    if mutation_reason is not None:
        normalized_mutation["reason"] = mutation_reason
    # The mutation check above proves the acceptance test can see the defect. It
    # does not prove the shipped change is what makes it pass: a guard that
    # computes an identity satisfies every rule and can be deleted with nothing
    # going red. Recorded by the retest, never by the pass that wrote the fix.
    if schema_version < "4":
        # Version 3 had no such field; a document from then cannot be asked for it.
        normalized_revert = None
        revert_status = None
    else:
        normalized_revert, revert_status = _validate_revert_mutation(
            item["revert_mutation"], f"{path}.revert_mutation"
        )
    return {
        "classification": require_string(
            item["classification"], f"{path}.classification", set(RETEST_STATE_MAP.values())
        ),
        "reviewer_id": require_principal_id(item["reviewer_id"], f"{path}.reviewer_id"),
        "reviewer_context": require_string(
            item["reviewer_context"], f"{path}.reviewer_context", REVIEWER_CONTEXTS
        ),
        "release_ref": require_sha256(item["release_ref"], f"{path}.release_ref"),
        "evidence_ids": validate_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id
        ),
        "acceptance_test": require_string(
            item["acceptance_test"], f"{path}.acceptance_test", CHECK_RESULTS
        ),
        "adjacent_regression_check": require_string(
            item["adjacent_regression_check"],
            f"{path}.adjacent_regression_check",
            CHECK_RESULTS,
        ),
        "mutation_test": normalized_mutation,
        **({"revert_mutation": normalized_revert} if normalized_revert is not None else {}),
    }


def validate_retest_outcome(
    retest: dict[str, Any],
    evidence_by_id: dict[str, dict[str, Any]],
    finding_id: str,
    current_release_ref: str,
    path: str,
    degree: str,
) -> None:
    """Validate a retest even when a later snapshot ends blocked or accepted-risk."""

    evidence = [evidence_by_id[item_id] for item_id in retest["evidence_ids"]]
    if any(record["subject_id"] != finding_id for record in evidence):
        raise ValidationError(
            f"{path}.evidence_ids", "all retest evidence must be bound to this finding"
        )
    classification = retest["classification"]
    if classification == "UNVERIFIABLE":
        if evidence:
            raise ValidationError(
                f"{path}.evidence_ids", "must be empty when classification is UNVERIFIABLE"
            )
        if (
            retest["acceptance_test"] != "unverified"
            or retest["adjacent_regression_check"] != "unverified"
            or retest["mutation_test"]["status"] != "not-applicable"
        ):
            raise ValidationError(
                path,
                "UNVERIFIABLE requires both checks to be unverified and mutation to be not-applicable",
            )
        return
    if not evidence:
        raise ValidationError(f"{path}.evidence_ids", f"{classification} requires retest evidence")
    if any(
        record["state"] == "E0"
        or not record["fresh"]
        or not record["reproducible"]
        or record["release_ref"] != current_release_ref
        or record["procedure"] not in {"acceptance", "adjacent-regression", "mutation"}
        for record in evidence
    ):
        raise ValidationError(
            f"{path}.evidence_ids",
            "retest evidence must be non-E0, fresh, reproducible, current-release acceptance, adjacent-regression, or mutation evidence",
        )
    mutation_status = retest["mutation_test"]["status"]
    mutation_evidence = [record for record in evidence if record["procedure"] == "mutation"]
    if mutation_status in {"killed", "survived"} and not mutation_evidence:
        raise ValidationError(
            f"{path}.evidence_ids", f"a {mutation_status} mutation requires bound mutation evidence"
        )
    if mutation_status == "not-applicable" and mutation_evidence:
        raise ValidationError(
            f"{path}.evidence_ids", "not-applicable mutation status cannot cite mutation evidence"
        )
    if classification == "FIXED":
        if any(
            record["result"] != "pass"
            or record["state"] not in {"E2", "E3"}
            or record["kind"] not in {"runtime", "test", "log", "metric", "eval"}
            for record in evidence
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "FIXED requires only passing E2/E3 non-static runtime or machine evidence",
            )
        procedures = {record["procedure"] for record in evidence}
        if not {"acceptance", "adjacent-regression"}.issubset(procedures):
            raise ValidationError(
                f"{path}.evidence_ids",
                "FIXED requires separate acceptance and adjacent-regression evidence",
            )
        conflict_procedures = {"reproduction", "acceptance", "adjacent-regression"}
        if mutation_status == "killed":
            conflict_procedures.add("mutation")
        if any(
            record["subject_id"] == finding_id
            and record["procedure"] in conflict_procedures
            and record["state"] != "E0"
            and record["fresh"]
            and record["reproducible"]
            and record["release_ref"] == current_release_ref
            and record["result"] != "pass"
            for record in evidence_by_id.values()
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "FIXED cannot hide a current same-path failure or inconclusive result",
            )
        if mutation_status == "not-applicable" and any(
            record["subject_id"] == finding_id
            and record["procedure"] == "mutation"
            and record["state"] != "E0"
            and record["fresh"]
            and record["reproducible"]
            and record["release_ref"] == current_release_ref
            for record in evidence_by_id.values()
        ):
            raise ValidationError(
                f"{path}.mutation_test.status",
                "not-applicable contradicts current mutation evidence for this finding",
            )
        if (
            retest["acceptance_test"] != "pass"
            or retest["adjacent_regression_check"] != "pass"
        ):
            raise ValidationError(
                path, "FIXED requires passing acceptance and adjacent checks"
            )
        if retest.get("revert_mutation", {}).get("status") == "survived":
            raise ValidationError(
                f"{path}.revert_mutation.status",
                "the change was removed and nothing failed, so it is not what makes "
                "the acceptance pass; it cannot support FIXED",
            )
        if degree in SWEEP_STRICT_DEGREES and (
            retest.get("revert_mutation", {}).get("status") == "not-applicable"
        ):
            raise ValidationError(
                f"{path}.revert_mutation.status",
                f"degree {degree!r} requires the change to be removed and something to "
                "fail; 'not-applicable' cannot close a finding at this degree",
            )
        if mutation_status == "survived":
            raise ValidationError(
                f"{path}.mutation_test.status", "a survived mutation cannot support FIXED"
            )
    elif classification == "PARTIALLY_FIXED":
        results = {record["result"] for record in evidence}
        if (
            "mixed" not in results
            and not ({"pass", "fail"} <= results)
        ) or (
            retest["acceptance_test"] == "pass"
            and retest["adjacent_regression_check"] == "pass"
        ):
            raise ValidationError(
                path,
                "PARTIALLY_FIXED requires mixed or passing-and-failing evidence and at least one non-passing check",
            )
    elif classification == "NOT_FIXED":
        if retest["acceptance_test"] != "fail" or not any(
            record["result"] in {"fail", "mixed"} for record in evidence
        ):
            raise ValidationError(
                path, "NOT_FIXED requires a failed acceptance test and fail/mixed evidence"
            )
    elif classification == "REGRESSED":
        if retest["adjacent_regression_check"] != "fail" or not any(
            record["result"] in {"fail", "mixed"} for record in evidence
        ):
            raise ValidationError(
                path, "REGRESSED requires a failed adjacent check and fail/mixed evidence"
            )


def validate_findings(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
    loop_mode: str,
    degree: str,
    schema_version: str,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    items = require_list(value, "$.findings")
    result: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    fields = {
        "id",
        "severity",
        "title",
        "promise_or_invariant",
        "preconditions",
        "reproduction_steps",
        "expected",
        "actual",
        "evidence_ids",
        "impact",
        "suspected_cause",
        "minimum_fix_or_agent_prompt",
        "acceptance_test",
        "adjacent_regression_check",
        "root_cause_id",
        "gate_id",
        "status",
        "fix_authorization",
        "fix",
        "retest",
        "risk_acceptance",
        "blocker",
    }
    for index, raw in enumerate(items):
        path = f"$.findings[{index}]"
        item = require_object(raw, path)
        require_exact_fields(
            item,
            fields | ({"promise_source"} if schema_version >= "5" else set()),
            path,
        )
        finding_id = require_id(item["id"], f"{path}.id", "finding")
        if finding_id in by_id:
            raise ValidationError(f"{path}.id", f"duplicate finding id {finding_id!r}")
        evidence_ids = validate_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id, minimum=1
        )
        if not any(
            evidence_by_id[evidence_id]["state"] != "E0"
            and evidence_by_id[evidence_id]["result"] in {"fail", "mixed"}
            for evidence_id in evidence_ids
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "a confirmed finding needs at least one E1/E2/E3 fail or mixed evidence record",
            )
        if any(
            evidence_by_id[evidence_id]["subject_id"] != finding_id
            or evidence_by_id[evidence_id]["procedure"] != "reproduction"
            for evidence_id in evidence_ids
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "finding evidence must be bound to this F-### and its reproduction procedure",
            )
        status = require_string(item["status"], f"{path}.status", FINDING_STATUSES)
        authorization = validate_authorization(item["fix_authorization"], f"{path}.fix_authorization")
        fix = validate_fix(item["fix"], f"{path}.fix")
        retest = validate_retest(
            item["retest"], f"{path}.retest", evidence_by_id, schema_version
        )
        risk_acceptance = validate_risk_acceptance(
            item["risk_acceptance"], f"{path}.risk_acceptance"
        )
        blocker = validate_blocker(item["blocker"], f"{path}.blocker")
        if authorization is not None and loop_mode != "fix-and-retest":
            raise ValidationError(
                f"{path}.fix_authorization", "requires loop_mode 'fix-and-retest'"
            )
        if fix is not None and loop_mode != "fix-and-retest":
            raise ValidationError(f"{path}.fix", "requires loop_mode 'fix-and-retest'")
        if fix is not None:
            if fix["origin"] == "authorized-agent" and authorization is None:
                raise ValidationError(
                    f"{path}.fix", "authorized-agent fixes require explicit user fix_authorization"
                )
            if fix["origin"] == "external-change" and authorization is not None:
                raise ValidationError(
                    f"{path}.fix_authorization",
                    "must be null for an observed external change; do not invent prior authorization",
                )
        if retest is not None and fix is None:
            raise ValidationError(f"{path}.retest", "requires a recorded fix")
        if retest is not None:
            if retest["reviewer_id"] == fix["actor_id"]:
                raise ValidationError(
                    f"{path}.retest.reviewer_id",
                    "must differ from fix.actor_id; a fixer cannot verify its own change",
                )
            if retest["release_ref"] != current_release_ref:
                raise ValidationError(
                    f"{path}.retest.release_ref", "must equal artifact.current_release_ref"
                )
            validate_retest_outcome(
                retest,
                evidence_by_id,
                finding_id,
                current_release_ref,
                f"{path}.retest",
                degree,
            )
        if status == "open" and any(
            part is not None for part in (authorization, fix, retest, risk_acceptance, blocker)
        ):
            raise ValidationError(path, "open findings cannot contain fix, retest, or risk records")
        if status == "fixing":
            if authorization is None or any(
                part is not None for part in (fix, retest, risk_acceptance, blocker)
            ):
                raise ValidationError(
                    path, "fixing requires only fix_authorization; no completed fix or retest"
                )
        if status == "fixed-pending-retest":
            if fix is None or retest is not None or risk_acceptance is not None or blocker is not None:
                raise ValidationError(
                    path,
                    "fixed-pending-retest requires a fix, but no retest, risk acceptance, or blocker",
                )
        if status in RETEST_STATE_MAP:
            if fix is None or retest is None or risk_acceptance is not None or blocker is not None:
                raise ValidationError(
                    path, f"{status} requires a fix and retest, without risk acceptance or blocker"
                )
            expected_classification = RETEST_STATE_MAP[status]
            if retest["classification"] != expected_classification:
                raise ValidationError(
                    f"{path}.retest.classification",
                    f"must be {expected_classification!r} for status {status!r}",
                )
        if status == "accepted-risk" and risk_acceptance is None:
            raise ValidationError(path, "accepted-risk requires explicit user risk_acceptance")
        if status != "accepted-risk" and risk_acceptance is not None:
            raise ValidationError(
                f"{path}.risk_acceptance", "is allowed only when status is accepted-risk"
            )
        if status == "blocked" and blocker is None:
            raise ValidationError(path, "blocked requires a named blocker record")
        if status != "blocked" and blocker is not None:
            raise ValidationError(f"{path}.blocker", "is allowed only when status is blocked")
        if status in {"accepted-risk", "blocked"} and retest is not None and retest[
            "classification"
        ] == "FIXED":
            raise ValidationError(
                f"{path}.retest.classification",
                f"{status} cannot retain a FIXED classification; use verified-fixed",
            )
        normalized = {
            "id": finding_id,
            "severity": require_string(item["severity"], f"{path}.severity", SEVERITIES),
            "title": require_string(item["title"], f"{path}.title"),
            "promise_or_invariant": require_string(
                item["promise_or_invariant"], f"{path}.promise_or_invariant"
            ),
            **(
                {
                    "promise_source": validate_promise_source(
                        item["promise_source"], f"{path}.promise_source"
                    )
                }
                if schema_version >= "5"
                else {}
            ),
            "preconditions": require_string_list(
                item["preconditions"], f"{path}.preconditions", minimum=1
            ),
            "reproduction_steps": require_string_list(
                item["reproduction_steps"], f"{path}.reproduction_steps", minimum=1
            ),
            "expected": require_string(item["expected"], f"{path}.expected"),
            "actual": require_string(item["actual"], f"{path}.actual"),
            "evidence_ids": evidence_ids,
            "impact": require_string(item["impact"], f"{path}.impact"),
            "suspected_cause": require_string(
                item["suspected_cause"], f"{path}.suspected_cause"
            ),
            "minimum_fix_or_agent_prompt": require_string(
                item["minimum_fix_or_agent_prompt"], f"{path}.minimum_fix_or_agent_prompt"
            ),
            "acceptance_test": require_string(
                item["acceptance_test"], f"{path}.acceptance_test"
            ),
            "adjacent_regression_check": require_string(
                item["adjacent_regression_check"], f"{path}.adjacent_regression_check"
            ),
            "root_cause_id": require_nullable_string(
                item["root_cause_id"], f"{path}.root_cause_id"
            ),
            "gate_id": require_nullable_string(item["gate_id"], f"{path}.gate_id"),
            "status": status,
            "fix_authorization": authorization,
            "fix": fix,
            "retest": retest,
            "risk_acceptance": risk_acceptance,
            "blocker": blocker,
        }
        if normalized["root_cause_id"] is not None and not ID_PATTERNS["root_cause"].fullmatch(
            normalized["root_cause_id"]
        ):
            raise ValidationError(f"{path}.root_cause_id", "must match RC-[0-9]{3} or be null")
        if normalized["gate_id"] is not None and normalized["gate_id"] not in GATE_IDS:
            raise ValidationError(f"{path}.gate_id", f"must be one of {sorted(GATE_IDS)} or null")
        result.append(normalized)
        by_id[finding_id] = normalized
    return sorted(result, key=lambda item: (SEVERITY_ORDER[item["severity"]], item["id"])), by_id


def path_matches_glob(candidate: str, pattern: str) -> bool:
    """Match a POSIX path against a glob, treating `**` as any run of segments.

    fnmatch is not usable here: its `*` crosses `/`, so `src/*` would match
    `src/a/b`, and a leading `**/` would fail to match a top-level path. A
    containment check that silently fails open is worse than none.
    """
    out, index = ["^"], 0
    while index < len(pattern):
        char = pattern[index]
        if pattern.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
        elif pattern.startswith("**", index):
            out.append(".*")
            index += 2
        elif char == "*":
            out.append("[^/]*")
            index += 1
        elif char == "?":
            out.append("[^/]")
            index += 1
        else:
            out.append(re.escape(char))
            index += 1
    out.append("$")
    return re.fullmatch("".join(out), candidate) is not None


def validate_seeded_check(value: Any, path: str) -> dict[str, Any] | None:
    """Did a deliberately different-looking instance survive the expression?"""
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"status", "seed_description", "reason"}, path)
    status = require_string(item["status"], f"{path}.status", SEEDED_CHECK_RESULTS)
    description = require_nullable_string(
        item["seed_description"], f"{path}.seed_description"
    )
    reason = require_nullable_string(item["reason"], f"{path}.reason")
    if status == "not-applicable":
        if not reason:
            raise ValidationError(
                f"{path}.reason", "not-applicable requires why no instance could be planted"
            )
    else:
        # Without this the seed can be a copy of the original defect, which an
        # over-fitted expression finds trivially and learns nothing from.
        if not description:
            raise ValidationError(
                f"{path}.seed_description",
                "state how the planted instance differed from the filed one",
            )
    return {"status": status, "seed_description": description, "reason": reason}


def validate_seeded_write(value: Any, path: str) -> dict[str, Any] | None:
    """Could someone still write a new instance past the control?

    Seeding a find tests the expression. Seeding a write tests the control: a
    chokepoint you can write around is not a chokepoint, and a ratchet a new
    instance can be merged past is not enforcing anything. `unwritable` covers
    both — the type system refused it, or the gate refused to land it.
    """
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"status", "attempt_description"}, path)
    status = require_string(item["status"], f"{path}.status", SEEDED_WRITE_RESULTS)
    description = require_nullable_string(
        item["attempt_description"], f"{path}.attempt_description"
    )
    if status != "not-attempted" and not description:
        raise ValidationError(
            f"{path}.attempt_description",
            "state what was written, or tried and refused; the claim is only as "
            "strong as the attempt behind it",
        )
    return {"status": status, "attempt_description": description}


def validate_condition_sweep(
    value: Any,
    path: str,
    identity_scope: dict[str, Any],
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
    schema_version: str,
) -> dict[str, Any]:
    """Extent of condition: the same defect at locations nobody filed yet.

    The point of the schema is that "did not look" and "looked and found
    nothing" cannot render as the same thing. `unswept` is a legal, honest
    state; what is illegal is closing a root cause while still in it.
    """
    item = require_object(value, path)
    require_exact_fields(
        item,
        {
            "state",
            "method",
            "expression",
            "scope",
            "denominator",
            "population",
            "instances_found",
            "instances_unconvertible",
            "instances_converted",
            "closure",
            "closure_ref",
            "closure_evidence_id",
            "note",
            "seeded_check",
        }
        | ({"seeded_write"} if schema_version >= "4" else set()),
        path,
    )
    state = require_string(item["state"], f"{path}.state", CONDITION_SWEEP_STATES)
    method = require_string(item["method"], f"{path}.method", CONDITION_SWEEP_METHODS)
    expression = require_nullable_string(item["expression"], f"{path}.expression")
    scope = require_nullable_string(item["scope"], f"{path}.scope")
    found = require_int(item["instances_found"], f"{path}.instances_found", 0, 1000000)
    converted = require_int(
        item["instances_converted"], f"{path}.instances_converted", 0, 1000000
    )
    unconvertible = require_int(
        item["instances_unconvertible"], f"{path}.instances_unconvertible", 0, 1000000
    )
    denominator = require_nullable_string(item["denominator"], f"{path}.denominator")
    population = require_nullable_string(item["population"], f"{path}.population")
    if denominator is not None and denominator not in SWEEP_DENOMINATORS:
        raise ValidationError(
            f"{path}.denominator",
            f"expected one of {sorted(SWEEP_DENOMINATORS)}, got {denominator!r}",
        )
    closure = require_nullable_string(item["closure"], f"{path}.closure")
    closure_ref = require_nullable_string(item["closure_ref"], f"{path}.closure_ref")
    note = require_nullable_string(item["note"], f"{path}.note")
    closure_evidence_id = require_nullable_string(
        item["closure_evidence_id"], f"{path}.closure_evidence_id"
    )
    seeded_check = validate_seeded_check(item["seeded_check"], f"{path}.seeded_check")
    seeded_write = (
        validate_seeded_write(item["seeded_write"], f"{path}.seeded_write")
        if schema_version >= "4"
        else None
    )

    if closure is not None and closure not in CONDITION_SWEEP_CLOSURES:
        raise ValidationError(
            f"{path}.closure",
            f"expected one of {sorted(CONDITION_SWEEP_CLOSURES)}, got {closure!r}",
        )
    if converted > found:
        raise ValidationError(
            f"{path}.instances_converted",
            f"converted {converted} exceeds the {found} instance(s) the sweep found",
        )
    if converted + unconvertible > found:
        raise ValidationError(
            f"{path}.instances_unconvertible",
            f"{converted} converted plus {unconvertible} unconvertible exceeds the "
            f"{found} instance(s) the sweep found",
        )

    if state == "unswept":
        if (
            method != "none"
            or expression is not None
            or scope is not None
            or found
            or converted
            or closure
            or closure_evidence_id
            or seeded_check
            or seeded_write
            or unconvertible
            or denominator is not None
            or population is not None
        ):
            raise ValidationError(
                f"{path}.state",
                "'unswept' means nothing was searched: method must be 'none' and "
                "expression, scope, counts, and closure must be empty",
            )
    elif state == "unsweepable":
        # A class nobody can enumerate is a real outcome, but it has to say why
        # and what was attempted; otherwise it becomes a place to hide.
        if not note:
            raise ValidationError(
                f"{path}.note", "'unsweepable' requires the reason enumeration failed"
            )
        if not scope:
            raise ValidationError(
                f"{path}.scope", "'unsweepable' requires the scope that was attempted"
            )
        if closure is not None:
            raise ValidationError(
                f"{path}.closure", "'unsweepable' cannot carry a closure route"
            )
    else:
        if method == "none" or not expression:
            raise ValidationError(
                f"{path}.expression",
                f"{state!r} requires a re-runnable search expression and a method",
            )
        if not scope:
            raise ValidationError(
                f"{path}.scope", f"{state!r} requires the scope the expression ran against"
            )
        if denominator is None:
            raise ValidationError(
                f"{path}.denominator",
                f"{state!r} requires whether the count is against a structural "
                "population or a reviewer-invented pattern",
            )
        if denominator == "structural" and not population:
            raise ValidationError(
                f"{path}.population",
                "a structural denominator must name what the code enumerates, such as "
                "the API call sites or router entries being counted",
            )
        if state == "swept" and closure is not None:
            raise ValidationError(
                f"{path}.closure",
                "'swept' means enumerated but unresolved; use 'closed' to record a closure",
            )
        if state == "closed":
            if closure is None:
                raise ValidationError(
                    f"{path}.closure", "'closed' requires how the class was closed"
                )
            if closure == "converted" and denominator != "structural":
                raise ValidationError(
                    f"{path}.denominator",
                    "closure 'converted' claims the class was exhausted, which a "
                    "symptom count cannot establish; enumerate a structural "
                    "population or close under an enforced control instead",
                )
            if closure == "converted" and unconvertible:
                raise ValidationError(
                    f"{path}.closure",
                    f"{unconvertible} instance(s) cannot be converted without "
                    "restructuring, so the class was not exhausted",
                )
            if closure == "converted" and converted != found:
                raise ValidationError(
                    f"{path}.instances_converted",
                    f"closure 'converted' requires all {found} instance(s) converted, "
                    f"got {converted}",
                )
            if closure in ENFORCED_CLOSURES:
                if not closure_ref:
                    raise ValidationError(
                        f"{path}.closure_ref",
                        f"closure {closure!r} requires the location that enforces it",
                    )
                # A control outside the audited tree is not part of what was
                # audited, and one under an excluded path is not even hashed
                # into the release identity the closure is being claimed against.
                if closure_ref.startswith("/") or ".." in pathlib.PurePosixPath(
                    closure_ref
                ).parts:
                    raise ValidationError(
                        f"{path}.closure_ref",
                        "must be a relative path inside the artifact identity scope",
                    )
                for excluded in identity_scope["excluded"]:
                    if path_matches_glob(closure_ref, excluded):
                        raise ValidationError(
                            f"{path}.closure_ref",
                            f"points under excluded scope {excluded!r}, so it is not part "
                            "of the audited artifact",
                        )
                # Evidence that the control ran is not evidence that it holds.
                if schema_version >= "4" and seeded_write is None:
                    raise ValidationError(
                        f"{path}.seeded_write",
                        f"closure {closure!r} claims new instances cannot get in; "
                        "record the attempt to write one",
                    )
                if seeded_write is not None and seeded_write["status"] != "unwritable":
                    raise ValidationError(
                        f"{path}.seeded_write.status",
                        f"a new instance was {seeded_write['status']}, so {closure!r} "
                        "does not close the class",
                    )
                # An enforcing control nobody observed is a claim, not a control.
                if not closure_evidence_id:
                    raise ValidationError(
                        f"{path}.closure_evidence_id",
                        f"closure {closure!r} requires evidence that the control was "
                        "observed working against the current release",
                    )
                enforcement = evidence_by_id.get(closure_evidence_id)
                if enforcement is None:
                    raise ValidationError(
                        f"{path}.closure_evidence_id",
                        f"unknown evidence id {closure_evidence_id!r}",
                    )
                if enforcement["state"] not in {"E2", "E3"} or enforcement["result"] != "pass":
                    raise ValidationError(
                        f"{path}.closure_evidence_id",
                        "enforcement evidence must be an observed passing run (E2 or E3)",
                    )
                if enforcement["release_ref"] != current_release_ref:
                    raise ValidationError(
                        f"{path}.closure_evidence_id",
                        "enforcement evidence must be bound to the current release",
                    )
                # Without this any passing acceptance record satisfies the rule,
                # and the control is evidenced by something that never touched it.
                if enforcement["procedure"] != "class-sweep":
                    raise ValidationError(
                        f"{path}.closure_evidence_id",
                        "enforcement evidence must use procedure 'class-sweep'; a "
                        "record from another procedure did not exercise this control",
                    )
            # Same principle as the sweep itself: degree grades how strong the
            # answer must be, never whether the question is on the record. A
            # closed class with no seeded_check reproduces the original defect —
            # "did not check" and "checked and it held" rendering identically.
            if seeded_check is None:
                raise ValidationError(
                    f"{path}.seeded_check",
                    "closing a class requires the result of planting an instance the "
                    "expression should have found, or a reason none could be planted",
                )
            if seeded_check["status"] == "survived":
                raise ValidationError(
                    f"{path}.seeded_check.status",
                    "a planted instance the expression missed proves it too narrow; "
                    "widen the expression and sweep again before closing",
                )
            if closure == "accepted-risk" and not note:
                raise ValidationError(
                    f"{path}.note",
                    "closure 'accepted-risk' requires the named remaining exposure",
                )
    return {
        "state": state,
        "method": method,
        "expression": expression,
        "scope": scope,
        "denominator": denominator,
        "population": population,
        "instances_found": found,
        "instances_converted": converted,
        "instances_unconvertible": unconvertible,
        "closure": closure,
        "closure_ref": closure_ref,
        "closure_evidence_id": closure_evidence_id,
        "note": note,
        "seeded_check": seeded_check,
        **({"seeded_write": seeded_write} if schema_version >= "4" else {}),
    }


def validate_cause_sweep(
    value: Any, path: str, finding_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """Extent of cause: what else this root cause produced.

    Kept separate from the condition sweep because it is the one that expands
    without a natural boundary, and it answers a different question.
    """
    if value is None:
        return None
    item = require_object(value, path)
    require_exact_fields(item, {"state", "summary", "finding_ids"}, path)
    state = require_string(item["state"], f"{path}.state", CAUSE_SWEEP_STATES)
    summary = require_string(item["summary"], f"{path}.summary")
    finding_ids = require_string_list(
        item["finding_ids"], f"{path}.finding_ids", minimum=0, unique=True
    )
    for offset, finding_id in enumerate(finding_ids):
        if finding_id not in finding_by_id:
            raise ValidationError(
                f"{path}.finding_ids[{offset}]", f"unknown finding id {finding_id!r}"
            )
    return {"state": state, "summary": summary, "finding_ids": sorted(finding_ids)}


def validate_promise_source(value: Any, path: str) -> dict[str, str]:
    """Where the broken promise is written down, or what behaviour implies it."""
    item = require_object(value, path)
    require_exact_fields(item, {"kind", "locator"}, path)
    kind = require_string(item["kind"], f"{path}.kind", PROMISE_SOURCES)
    locator = require_nullable_string(item["locator"], f"{path}.locator")
    if not locator:
        raise ValidationError(
            f"{path}.locator",
            "point at the words, the contract, or the behaviour this promise comes from; "
            "an unsourced promise makes the finding a request, not a defect",
        )
    return {"kind": kind, "locator": locator}


def validate_proposals(value: Any) -> list[dict[str, Any]]:
    """Capabilities the product never promised. Not defects; still worth knowing."""
    items = require_list(value, "$.proposals")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(items):
        path = f"$.proposals[{index}]"
        item = require_object(raw, path)
        require_exact_fields(
            item,
            {
                "id",
                "title",
                "absent_capability",
                "who_would_use_it",
                "why_not_a_finding",
                "status",
                "note",
            },
            path,
        )
        proposal_id = require_id(item["id"], f"{path}.id", "proposal")
        if proposal_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate proposal id {proposal_id!r}")
        seen.add(proposal_id)
        why = require_nullable_string(item["why_not_a_finding"], f"{path}.why_not_a_finding")
        if not why:
            raise ValidationError(
                f"{path}.why_not_a_finding",
                "name the promise its absence would have broken, and say why the product "
                "does not make it; without that this belongs in findings",
            )
        status = require_string(item["status"], f"{path}.status", PROPOSAL_STATUSES)
        note = require_nullable_string(item["note"], f"{path}.note")
        if status == "declined" and not note:
            raise ValidationError(f"{path}.note", "a declined proposal records why")
        result.append(
            {
                "id": proposal_id,
                "title": require_string(item["title"], f"{path}.title"),
                "absent_capability": require_string(
                    item["absent_capability"], f"{path}.absent_capability"
                ),
                "who_would_use_it": require_string(
                    item["who_would_use_it"], f"{path}.who_would_use_it"
                ),
                "why_not_a_finding": why,
                "status": status,
                "note": note,
            }
        )
    return sorted(result, key=lambda item: item["id"])


def validate_root_causes(
    value: Any,
    finding_by_id: dict[str, dict[str, Any]],
    degree: str,
    loop_mode: str,
    identity_scope: dict[str, Any],
    evidence_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
    schema_version: str,
) -> list[dict[str, Any]]:
    items = require_list(value, "$.root_causes")
    result: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(items):
        path = f"$.root_causes[{index}]"
        item = require_object(raw, path)
        require_exact_fields(
            item,
            {"id", "title", "summary", "finding_ids", "condition_sweep", "cause_sweep"},
            path,
        )
        root_id = require_id(item["id"], f"{path}.id", "root_cause")
        if root_id in by_id:
            raise ValidationError(f"{path}.id", f"duplicate root-cause id {root_id!r}")
        finding_ids = require_string_list(
            item["finding_ids"], f"{path}.finding_ids", minimum=1, unique=True
        )
        for offset, finding_id in enumerate(finding_ids):
            if finding_id not in finding_by_id:
                raise ValidationError(
                    f"{path}.finding_ids[{offset}]", f"unknown finding id {finding_id!r}"
                )
            if finding_by_id[finding_id]["root_cause_id"] != root_id:
                raise ValidationError(
                    f"{path}.finding_ids[{offset}]",
                    f"finding {finding_id!r} does not point back to {root_id!r}",
                )
        condition_sweep = validate_condition_sweep(
            item["condition_sweep"],
            f"{path}.condition_sweep",
            identity_scope,
            evidence_by_id,
            current_release_ref,
            schema_version,
        )
        cause_sweep = validate_cause_sweep(
            item["cause_sweep"], f"{path}.cause_sweep", finding_by_id
        )
        # A root cause looks finished when its filed findings all close. That is
        # exactly the moment the unfiled instances become invisible, so it is the
        # moment the sweep has to have happened.
        if loop_mode == "fix-and-retest" and all(
            finding_by_id[item_id]["status"] in CLOSED_FINDING_STATUSES
            for item_id in finding_ids
        ):
            if condition_sweep["state"] == "unswept":
                raise ValidationError(
                    f"{path}.condition_sweep.state",
                    f"{root_id} has every filed finding closed while its defect class is "
                    "still 'unswept'; run the extent-of-condition sweep before closing it",
                )
            if degree in SWEEP_STRICT_DEGREES:
                if condition_sweep["state"] != "closed":
                    raise ValidationError(
                        f"{path}.condition_sweep.state",
                        f"degree {degree!r} requires a closed defect class before {root_id} "
                        f"closes, got {condition_sweep['state']!r}",
                    )
                seeded = condition_sweep["seeded_check"]
                if seeded is None or seeded["status"] == "not-applicable":
                    raise ValidationError(
                        f"{path}.condition_sweep.seeded_check",
                        f"degree {degree!r} requires a planted instance the recorded "
                        f"expression actually found before {root_id} closes",
                    )
                if cause_sweep is None or cause_sweep["state"] != "done":
                    raise ValidationError(
                        f"{path}.cause_sweep",
                        f"degree {degree!r} requires a completed extent-of-cause review "
                        f"before {root_id} closes",
                    )
        normalized = {
            "id": root_id,
            "title": require_string(item["title"], f"{path}.title"),
            "summary": require_string(item["summary"], f"{path}.summary"),
            "finding_ids": sorted(finding_ids),
            "condition_sweep": condition_sweep,
            "cause_sweep": cause_sweep,
        }
        result.append(normalized)
        by_id[root_id] = normalized
    for finding_id, finding in finding_by_id.items():
        root_id = finding["root_cause_id"]
        if root_id is not None:
            if root_id not in by_id:
                raise ValidationError(
                    f"$.findings[{finding_id}].root_cause_id", f"unknown root-cause id {root_id!r}"
                )
            if finding_id not in by_id[root_id]["finding_ids"]:
                raise ValidationError(
                    f"$.findings[{finding_id}].root_cause_id",
                    f"root cause {root_id!r} does not point back to this finding",
                )
    return sorted(result, key=lambda item: item["id"])


def validate_unknowns(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    finding_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
) -> list[dict[str, Any]]:
    items = require_list(value, "$.unknowns")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    fields = {
        "id",
        "unresolved_condition",
        "why_it_matters",
        "missing_evidence",
        "resolving_test",
        "status",
        "resolution_evidence_ids",
        "finding_id",
    }
    for index, raw in enumerate(items):
        path = f"$.unknowns[{index}]"
        item = require_object(raw, path)
        require_exact_fields(item, fields, path)
        unknown_id = require_id(item["id"], f"{path}.id", "unknown")
        if unknown_id in seen:
            raise ValidationError(f"{path}.id", f"duplicate unknown id {unknown_id!r}")
        seen.add(unknown_id)
        status = require_string(
            item["status"], f"{path}.status", {"open", "cleared", "promoted-to-finding"}
        )
        evidence_ids = validate_evidence_ids(
            item["resolution_evidence_ids"],
            f"{path}.resolution_evidence_ids",
            evidence_by_id,
        )
        finding_id = require_nullable_string(item["finding_id"], f"{path}.finding_id")
        if finding_id is not None and not ID_PATTERNS["finding"].fullmatch(finding_id):
            raise ValidationError(f"{path}.finding_id", "must match F-[0-9]{3} or be null")
        if status == "open":
            if evidence_ids or finding_id is not None:
                raise ValidationError(path, "open unknowns cannot contain a resolution")
        else:
            if not evidence_ids:
                raise ValidationError(
                    f"{path}.resolution_evidence_ids", f"{status} requires resolution evidence"
                )
            evidence = [evidence_by_id[item_id] for item_id in evidence_ids]
            if any(
                not record["fresh"]
                or not record["reproducible"]
                or record["release_ref"] != current_release_ref
                or record["subject_id"] != unknown_id
                or record["procedure"] != "unknown-resolution"
                for record in evidence
            ):
                raise ValidationError(
                    f"{path}.resolution_evidence_ids",
                    "resolution evidence must be fresh, reproducible, and bound to the current release",
                )
            if status == "cleared":
                if finding_id is not None or any(
                    record["result"] != "pass"
                    or record["state"] not in {"E2", "E3"}
                    or record["kind"] not in {"runtime", "test", "log", "metric", "eval"}
                    for record in evidence
                ):
                    raise ValidationError(
                        path,
                        "cleared requires E2/E3 passing runtime or machine evidence and no finding_id",
                    )
                if any(
                    record["subject_id"] == unknown_id
                    and record["procedure"] == "unknown-resolution"
                    and record["state"] != "E0"
                    and record["fresh"]
                    and record["reproducible"]
                    and record["release_ref"] == current_release_ref
                    and record["result"] != "pass"
                    for record in evidence_by_id.values()
                ):
                    raise ValidationError(
                        f"{path}.resolution_evidence_ids",
                        "cleared cannot hide a current same-unknown failure or inconclusive result",
                    )
            else:
                if finding_id not in finding_by_id:
                    raise ValidationError(
                        f"{path}.finding_id", "promoted-to-finding requires a known finding_id"
                    )
                if not any(
                    record["state"] != "E0" and record["result"] in {"fail", "mixed"}
                    for record in evidence
                ):
                    raise ValidationError(
                        f"{path}.resolution_evidence_ids",
                        "promoted-to-finding requires non-E0 fail or mixed evidence",
                    )
        result.append(
            {
                "id": unknown_id,
                "unresolved_condition": require_string(
                    item["unresolved_condition"], f"{path}.unresolved_condition"
                ),
                "why_it_matters": require_string(
                    item["why_it_matters"], f"{path}.why_it_matters"
                ),
                "missing_evidence": require_string(
                    item["missing_evidence"], f"{path}.missing_evidence"
                ),
                "resolving_test": require_string(item["resolving_test"], f"{path}.resolving_test"),
                "status": status,
                "resolution_evidence_ids": evidence_ids,
                "finding_id": finding_id,
            }
        )
    return sorted(result, key=lambda item: item["id"])


def qualifies_gate_failure(
    record: dict[str, Any], gate_id: str, release_ref: str | None = None
) -> bool:
    if (
        record.get("gate_id") != gate_id
        or record["result"] not in {"fail", "mixed"}
        or not record["fresh"]
        or not record["reproducible"]
        or (release_ref is not None and record["release_ref"] != release_ref)
    ):
        return False
    if record["state"] in {"E2", "E3"} and record["kind"] in {
        "runtime",
        "test",
        "log",
        "metric",
    }:
        return True
    coverage = record.get("deployment_coverage")
    return bool(
        record["state"] != "E0"
        and record["kind"] in {"code", "document"}
        and isinstance(coverage, dict)
        and coverage["scope_complete"]
        and coverage["compensating_layer_ruled_out"]
    )


def validate_gates(
    value: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    finding_by_id: dict[str, dict[str, Any]],
    current_release_ref: str,
) -> list[dict[str, Any]]:
    items = require_list(value, "$.gates")
    result: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    fields = {
        "id",
        "state",
        "evidence_ids",
        "retest_evidence_ids",
        "affected_targets",
        "finding_ids",
    }
    for index, raw in enumerate(items):
        path = f"$.gates[{index}]"
        item = require_object(raw, path)
        require_exact_fields(item, fields, path)
        gate_id = require_string(item["id"], f"{path}.id", GATE_IDS)
        if gate_id in by_id:
            raise ValidationError(f"{path}.id", f"duplicate gate id {gate_id!r}")
        state = require_string(item["state"], f"{path}.state", {"active", "fixed"})
        evidence_ids = validate_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", evidence_by_id
        )
        retest_ids = validate_evidence_ids(
            item["retest_evidence_ids"], f"{path}.retest_evidence_ids", evidence_by_id
        )
        targets = require_string_list(
            item["affected_targets"], f"{path}.affected_targets", minimum=1, unique=True
        )
        for offset, target in enumerate(targets):
            if target not in RELEASE_ORDER:
                raise ValidationError(
                    f"{path}.affected_targets[{offset}]",
                    f"unsupported software-release target {target!r}",
                )
        finding_ids = require_string_list(
            item["finding_ids"], f"{path}.finding_ids", minimum=1, unique=True
        )
        for offset, finding_id in enumerate(finding_ids):
            if finding_id not in finding_by_id:
                raise ValidationError(
                    f"{path}.finding_ids[{offset}]", f"unknown finding id {finding_id!r}"
                )
            if finding_by_id[finding_id]["gate_id"] != gate_id:
                raise ValidationError(
                    f"{path}.finding_ids[{offset}]",
                    f"finding {finding_id!r} does not point back to gate {gate_id!r}",
                )
        active_evidence = [evidence_by_id[item_id] for item_id in evidence_ids]
        retest_evidence = [evidence_by_id[item_id] for item_id in retest_ids]
        if any(
            record.get("gate_id") != gate_id
            or record["subject_id"] not in finding_ids
            or record["procedure"] != "reproduction"
            for record in active_evidence
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "gate failure evidence must point to a linked finding and its reproduction procedure",
            )
        if not active_evidence or not any(
            qualifies_gate_failure(record, gate_id) for record in active_evidence
        ):
            raise ValidationError(
                f"{path}.evidence_ids",
                "every gate needs preserved E2/E3 machine failure or complete deployment evidence bound to the gate",
            )
        if any(
            record.get("gate_id") != gate_id
            or record["subject_id"] not in finding_ids
            or record["procedure"] != "acceptance"
            or record["state"] not in {"E2", "E3"}
            or record["kind"] not in {"runtime", "test"}
            or not record["fresh"]
            or not record["reproducible"]
            for record in retest_evidence
        ):
            raise ValidationError(
                f"{path}.retest_evidence_ids",
                "gate retests must be fresh E2/E3 acceptance runtime or test evidence bound to linked findings",
            )
        if state == "active":
            # A proven gate remains active across releases until a qualifying
            # independent retest closes it. A code change alone is not closure.
            pass
        else:
            if not retest_evidence:
                raise ValidationError(
                    f"{path}.retest_evidence_ids",
                    "a fixed gate needs current E2/E3 passing acceptance evidence",
                )
            if any(
                not any(
                    record["subject_id"] == finding_id
                    and record["result"] == "pass"
                    and record["release_ref"] == current_release_ref
                    and finding_by_id[finding_id]["retest"] is not None
                    and record["id"]
                    in finding_by_id[finding_id]["retest"]["evidence_ids"]
                    for record in retest_evidence
                )
                for finding_id in finding_ids
            ):
                raise ValidationError(
                    f"{path}.retest_evidence_ids",
                    "a fixed gate needs current passing acceptance evidence included in every linked finding's independent retest",
                )
            if any(
                qualifies_gate_failure(record, gate_id, current_release_ref)
                for record in evidence_by_id.values()
            ):
                raise ValidationError(
                    f"{path}.state",
                    "cannot be fixed while current same-gate failure evidence exists",
                )
            if any(finding_by_id[finding_id]["status"] != "verified-fixed" for finding_id in finding_ids):
                raise ValidationError(
                    f"{path}.finding_ids", "every finding linked to a fixed gate must be verified-fixed"
                )
        normalized = {
            "id": gate_id,
            "state": state,
            "evidence_ids": sorted(evidence_ids),
            "retest_evidence_ids": sorted(retest_ids),
            "affected_targets": sorted(targets),
            "finding_ids": sorted(finding_ids),
        }
        result.append(normalized)
        by_id[gate_id] = normalized
    for finding_id, finding in finding_by_id.items():
        gate_id = finding["gate_id"]
        if gate_id is None:
            continue
        if gate_id not in by_id:
            raise ValidationError(
                f"$.findings[{finding_id}].gate_id", f"missing gate record {gate_id!r}"
            )
        if finding_id not in by_id[gate_id]["finding_ids"]:
            raise ValidationError(
                f"$.findings[{finding_id}].gate_id",
                f"gate {gate_id!r} does not point back to this finding",
            )
        if finding["status"] == "accepted-risk" and by_id[gate_id]["state"] != "active":
            raise ValidationError(
                f"$.findings[{finding_id}].status",
                "risk acceptance cannot mark a technical gate fixed",
            )
    for evidence_id, record in evidence_by_id.items():
        gate_id = record.get("gate_id")
        if gate_id is None:
            continue
        if gate_id not in by_id:
            raise ValidationError(
                f"$.evidence[{evidence_id}].gate_id", f"missing gate record {gate_id!r}"
            )
        gate = by_id[gate_id]
        if evidence_id not in set(gate["evidence_ids"] + gate["retest_evidence_ids"]):
            raise ValidationError(
                f"$.evidence[{evidence_id}].gate_id",
                "gate-bound evidence must appear in that gate's evidence or retest list",
            )
        if record["subject_id"] not in gate["finding_ids"]:
            raise ValidationError(
                f"$.evidence[{evidence_id}].subject_id",
                "gate-bound evidence must point to a finding linked by the gate",
            )
    return sorted(result, key=lambda item: item["id"])


def validate(payload: Any) -> dict[str, Any]:
    root = require_object(payload, "$")
    fields = {
        "schema_version",
        "ledger_id",
        "previous_ledger_ref",
        "artifact",
        "review",
        "loop_mode",
        "verdict",
        "workflow_blockers",
        "release_checks",
        "scoring",
        "venture_assessment",
        "root_causes",
        "evidence",
        "evidence_lanes",
        "gates",
        "findings",
        "unknowns",
        "snapshot_index",
        "recorded_at",
    }
    declared = root.get("schema_version") if isinstance(root, dict) else None
    if isinstance(declared, str) and declared >= "5":
        fields = fields | {"proposals"}
    require_exact_fields(root, fields, "$")
    schema_version = require_string(root["schema_version"], "$.schema_version")
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValidationError(
            "$.schema_version",
            f"must be one of {list(SUPPORTED_SCHEMA_VERSIONS)}; write new snapshots at "
            f"{SCHEMA_VERSION!r}",
        )
    snapshot_index = root["snapshot_index"]
    if not isinstance(snapshot_index, int) or isinstance(snapshot_index, bool) or snapshot_index < 1:
        raise ValidationError("$.snapshot_index", "must be an integer >= 1")
    if (root["previous_ledger_ref"] is None) != (snapshot_index == 1):
        raise ValidationError(
            "$.snapshot_index",
            "must be 1 exactly when previous_ledger_ref is null; a root snapshot is the only unlinked one",
        )
    recorded_at = root["recorded_at"]
    if recorded_at is not None:
        if not isinstance(recorded_at, str) or not RECORDED_AT_PATTERN.fullmatch(recorded_at):
            raise ValidationError(
                "$.recorded_at", "must be null or an RFC 3339 UTC timestamp such as 2026-07-31T04:05:06Z"
            )
    artifact = require_object(root["artifact"], "$.artifact")
    require_exact_fields(
        artifact,
        {
            "name",
            "initial_release_ref",
            "current_release_ref",
            "identity_method",
            "identity_scope",
        },
        "$.artifact",
    )
    normalized_artifact = {
        "name": require_string(artifact["name"], "$.artifact.name"),
        "initial_release_ref": require_sha256(
            artifact["initial_release_ref"], "$.artifact.initial_release_ref"
        ),
        "current_release_ref": require_sha256(
            artifact["current_release_ref"], "$.artifact.current_release_ref"
        ),
        "identity_method": require_string(
            artifact["identity_method"], "$.artifact.identity_method", IDENTITY_METHODS
        ),
        "identity_scope": validate_identity_scope(artifact["identity_scope"]),
    }
    review = require_object(root["review"], "$.review")
    require_exact_fields(
        review,
        {"role", "degree", "requested_target", "rubric_id", "ai_behavior"},
        "$.review",
    )
    normalized_review = {
        "role": require_string(review["role"], "$.review.role", ROLES),
        "degree": require_string(review["degree"], "$.review.degree", DEGREES),
        "requested_target": require_string(
            review["requested_target"], "$.review.requested_target", TARGETS
        ),
        "rubric_id": require_principal_id(review["rubric_id"], "$.review.rubric_id"),
        "ai_behavior": require_string(
            review["ai_behavior"], "$.review.ai_behavior", AI_BEHAVIORS
        ),
    }
    if normalized_review["role"] == "skeptical-vc":
        if normalized_review["requested_target"] != "venture-case":
            raise ValidationError(
                "$.review.requested_target", "skeptical-vc requires venture-case"
            )
    elif normalized_review["requested_target"] == "venture-case":
        raise ValidationError(
            "$.review.requested_target", "venture-case is reserved for skeptical-vc"
        )
    if normalized_review["role"] != "skeptical-vc":
        expected_target = {
            "quick-check": "internal-demo",
            "strict-review": "private-beta",
            "launch-gate": "public-launch",
            "real-stakes": "real-money",
            "life-or-death": "high-stakes",
        }[normalized_review["degree"]]
        if normalized_review["requested_target"] != expected_target:
            raise ValidationError(
                "$.review.requested_target",
                f"degree {normalized_review['degree']!r} requires {expected_target!r}",
            )
    loop_mode = require_string(root["loop_mode"], "$.loop_mode", LOOP_MODES)
    is_venture_review = normalized_review["role"] == "skeptical-vc"
    verdict = require_object(root["verdict"], "$.verdict")
    require_exact_fields(
        verdict, {"initial_decision", "current_decision", "maximum_safe_target"}, "$.verdict"
    )
    decision_tokens = VENTURE_DECISIONS if is_venture_review else DECISIONS
    normalized_verdict = {
        "initial_decision": require_string(
            verdict["initial_decision"], "$.verdict.initial_decision", decision_tokens
        ),
        "current_decision": require_string(
            verdict["current_decision"], "$.verdict.current_decision", decision_tokens
        ),
        "maximum_safe_target": require_string(
            verdict["maximum_safe_target"],
            "$.verdict.maximum_safe_target",
            MAXIMUM_SAFE_TARGETS,
        ),
    }
    evidence, evidence_by_id = validate_evidence(root["evidence"])
    evidence_lanes = validate_evidence_lanes(
        root["evidence_lanes"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
        normalized_review["ai_behavior"],
        normalized_review["requested_target"],
    )
    workflow_blockers = validate_workflow_blockers(
        root["workflow_blockers"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
    )
    release_checks = validate_release_checks(
        root["release_checks"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
    )
    scoring = validate_scoring(root["scoring"])
    venture_assessment = validate_venture_assessment(
        root["venture_assessment"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
        is_venture_review,
        normalized_review["degree"],
    )
    if is_venture_review and release_checks:
        raise ValidationError(
            "$.release_checks",
            "skeptical-vc uses venture signals; record any separate software release review in its own ledger",
        )
    findings, finding_by_id = validate_findings(
        root["findings"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
        loop_mode,
        normalized_review["degree"],
        schema_version,
    )
    if any(item["fix"] is not None for item in findings) and (
        normalized_artifact["current_release_ref"] == normalized_artifact["initial_release_ref"]
    ):
        raise ValidationError(
            "$.artifact.current_release_ref",
            "must differ from initial_release_ref after a recorded fix",
        )
    proposals = validate_proposals(root["proposals"]) if schema_version >= "5" else []
    root_causes = validate_root_causes(
        root["root_causes"],
        finding_by_id,
        normalized_review["degree"],
        loop_mode,
        normalized_artifact["identity_scope"],
        evidence_by_id,
        normalized_artifact["current_release_ref"],
        schema_version,
    )
    # The sweep hangs off the root cause, so a finding with no root cause would
    # skip it entirely — and a lone observed instance is the likeliest of all to
    # have unobserved siblings. A one-finding root cause is legal; going without
    # one is not, once the finding claims the defect is gone.
    for finding_id, finding in sorted(finding_by_id.items()):
        if finding["status"] == "verified-fixed" and finding["root_cause_id"] is None:
            raise ValidationError(
                f"$.findings[{finding_id}].root_cause_id",
                "a verified-fixed finding must belong to a root cause so its defect "
                "class carries a sweep; group a lone finding under its own RC-###",
            )
    unknowns = validate_unknowns(
        root["unknowns"],
        evidence_by_id,
        finding_by_id,
        normalized_artifact["current_release_ref"],
    )
    gates = validate_gates(
        root["gates"], evidence_by_id, finding_by_id, normalized_artifact["current_release_ref"]
    )
    known_subjects = set(finding_by_id) | {item["id"] for item in unknowns}
    for evidence_id, record in evidence_by_id.items():
        subject_id = record["subject_id"]
        if subject_id is not None and subject_id not in known_subjects:
            raise ValidationError(
                f"$.evidence[{evidence_id}].subject_id", f"unknown subject id {subject_id!r}"
            )
    has_blocking_gate = any(
        gate["state"] == "active"
        and normalized_review["requested_target"] in gate["affected_targets"]
        for gate in gates
    )
    has_named_blocker = any(item["status"] == "blocked" for item in findings) or any(
        item["status"] == "active" for item in workflow_blockers
    )
    if is_venture_review:
        if gates:
            raise ValidationError(
                "$.gates",
                "venture-case keeps software safety gates in a separate product-release ledger",
            )
        signal_statuses = [
            signal["status"] for signal in venture_assessment["signals"].values()
        ]
        if (
            has_named_blocker
            or any(item["status"] == "open" for item in unknowns)
            or "unknown" in signal_statuses
        ):
            expected_venture_decision = "INSUFFICIENT_EVIDENCE"
        elif scoring["requested"] and scoring["threshold_met"] is False:
            expected_venture_decision = "NOT_INVESTABLE_YET"
        elif all(status == "present" for status in signal_statuses):
            expected_venture_decision = "INVESTABLE"
        elif "present" in signal_statuses:
            expected_venture_decision = "INTERESTING_BUT_UNPROVEN"
        else:
            expected_venture_decision = "NOT_INVESTABLE_YET"
        if normalized_verdict["current_decision"] != expected_venture_decision:
            raise ValidationError(
                "$.verdict.current_decision",
                f"must be {expected_venture_decision} after applying blockers, unknowns, scoring, and venture signals in order",
            )
        if normalized_verdict["maximum_safe_target"] != "not-assessed":
            raise ValidationError(
                "$.verdict.maximum_safe_target",
                "venture review keeps product-release safety separate; use not-assessed",
            )
    else:
        required_lane_ids = required_evidence_lanes(
            normalized_review["requested_target"], normalized_review["ai_behavior"]
        )
        required_lane_statuses = [
            evidence_lanes[lane_id]["status"] for lane_id in required_lane_ids
        ]
        has_required_failure = any(
            status == "FAIL" for status in required_lane_statuses
        ) or any(
            item["required"] and item["status"] == "fail" for item in release_checks
        )
        high_unresolved = any(
            item["severity"] in {"BLOCKER", "HIGH"}
            and item["status"]
            in {
                "open",
                "fixing",
                "fixed-pending-retest",
                "partially-fixed",
                "not-fixed",
                "regressed",
                "accepted-risk",
            }
            for item in findings
        )
        has_required_unknown = any(
            status == "UNVERIFIED" for status in required_lane_statuses
        ) or any(
            item["required"] and item["status"] == "unverified"
            for item in release_checks
        )
        has_unverifiable_work = any(
            item["status"] == "unverifiable" for item in findings
        ) or any(item["status"] == "open" for item in unknowns)
        below_threshold = scoring["requested"] and scoring["threshold_met"] is False
        optional_gaps = (
            any(item["status"] != "verified-fixed" for item in findings)
            or any(not item["required"] and item["status"] != "pass" for item in release_checks)
            or any(
                gate["state"] == "active"
                and normalized_review["requested_target"] not in gate["affected_targets"]
                for gate in gates
            )
        )
        if has_blocking_gate or has_named_blocker:
            expected_decision = "BLOCKED"
        elif has_required_failure or high_unresolved:
            expected_decision = "NOT_READY"
        elif has_required_unknown or has_unverifiable_work:
            expected_decision = "INSUFFICIENT_EVIDENCE"
        elif below_threshold:
            expected_decision = "NOT_READY"
        elif optional_gaps:
            expected_decision = "READY_WITH_CONDITIONS"
        else:
            expected_decision = "READY"
        if normalized_verdict["current_decision"] != expected_decision:
            raise ValidationError(
                "$.verdict.current_decision",
                f"must be {expected_decision} after applying gates, checks, evidence, scoring, and optional gaps in order",
            )
        requested_target = normalized_review["requested_target"]
        maximum_target = normalized_verdict["maximum_safe_target"]
        if maximum_target in {"venture-case", "not-assessed"}:
            raise ValidationError(
                "$.verdict.maximum_safe_target",
                "non-venture reviews require a product release tier or no-supported-release-tier",
            )
        if maximum_target in RELEASE_ORDER and RELEASE_ORDER[maximum_target] > RELEASE_ORDER[
            requested_target
        ]:
            raise ValidationError(
                "$.verdict.maximum_safe_target",
                "cannot exceed the requested target",
            )
        if expected_decision in {"READY", "READY_WITH_CONDITIONS"}:
            if maximum_target != requested_target:
                raise ValidationError(
                    "$.verdict.maximum_safe_target",
                    "a ready decision must support the requested target exactly",
                )
        elif maximum_target == requested_target:
            raise ValidationError(
                "$.verdict.maximum_safe_target",
                "a non-ready decision cannot claim the requested target as safe",
            )
    return {
        "schema_version": schema_version,
        "snapshot_index": snapshot_index,
        "recorded_at": recorded_at,
        "ledger_id": require_string(root["ledger_id"], "$.ledger_id"),
        "previous_ledger_ref": (
            None
            if root["previous_ledger_ref"] is None
            else require_sha256(root["previous_ledger_ref"], "$.previous_ledger_ref")
        ),
        "artifact": normalized_artifact,
        "review": normalized_review,
        "loop_mode": loop_mode,
        "verdict": normalized_verdict,
        "workflow_blockers": workflow_blockers,
        "release_checks": release_checks,
        "scoring": scoring,
        "venture_assessment": venture_assessment,
        "root_causes": root_causes,
        **({"proposals": proposals} if schema_version >= "5" else {}),
        "evidence": evidence,
        "evidence_lanes": evidence_lanes,
        "gates": gates,
        "findings": findings,
        "unknowns": unknowns,
    }


def compact(value: str) -> str:
    return " ".join(value.split())


def markdown_text(value: str) -> str:
    """Render caller-provided prose without allowing Markdown/HTML injection."""

    result = compact(value).replace("\\", "\\\\")
    for character in "`*_{}[]<>#!|":
        result = result.replace(character, f"\\{character}")
    return result


def code_span(value: str) -> str:
    """Render arbitrary compact text in a CommonMark-safe code span."""

    result = compact(value)
    longest = max((len(match.group(0)) for match in re.finditer(r"`+", result)), default=0)
    if longest == 0:
        return f"`{result}`"
    fence = "`" * (longest + 1)
    return f"{fence} {result} {fence}"


def render_root_cause_sweeps(root: dict[str, Any], label: dict[str, str]) -> list[str]:
    """Put the class state on the page.

    A reader who only sees "3 of 3 findings verified" concludes the class is
    gone. These lines are what stop that reading when it is not true.
    """
    sweep = root["condition_sweep"]
    detail = f"{label['condition_sweep']}: `{sweep['state']}`"
    if sweep["state"] in {"swept", "closed"}:
        detail += (
            f" — {sweep['instances_converted']}/{sweep['instances_found']} "
            f"{label['instances_converted']}"
        )
        if sweep["closure"]:
            detail += f", {label['closure']} `{sweep['closure']}`"
            if sweep["closure_ref"]:
                detail += f" ({markdown_text(sweep['closure_ref'])})"
        detail += f" · `{markdown_text(sweep['expression'])}` {label['over_scope']} {markdown_text(sweep['scope'])}"
    elif sweep["state"] == "unsweepable":
        detail += f" — {markdown_text(sweep['note'] or '')}"
    else:
        detail += f" — {label['unswept_warning']}"
    lines = [detail]
    cause = root["cause_sweep"]
    if cause is not None:
        cause_line = f"{label['cause_sweep']}: `{cause['state']}` — {markdown_text(cause['summary'])}"
        if cause["finding_ids"]:
            cause_line += f" ({render_list(cause['finding_ids'])})"
        lines.append(cause_line)
    return lines


def render_list(values: list[str]) -> str:
    return "; ".join(markdown_text(value) for value in values)


LABELS = {
    "en": {
        "title": "RateMyCode audit ledger",
        "ledger": "Ledger",
        "previous_ledger": "Prior ledger",
        "review_identity": "Review identity",
        "artifact": "Artifact",
        "initial_release": "Initial release",
        "current_release": "Current release",
        "identity_method": "Identity method",
        "identity_scope": "Identity scope",
        "scope_root": "root",
        "scope_included": "included",
        "scope_excluded": "excluded",
        "symlink_policy": "symlink policy",
        "review": "Review",
        "mode": "Loop mode",
        "verdict": "Current verdict",
        "maximum": "Maximum safe target",
        "issues": "One-line problem list",
        "pending": "Pending verification",
        "none": "None.",
        "progress": "Progress",
        "status": "Status",
        "count": "Count",
        "root_causes": "Root causes",
        "condition_sweep": "Extent of condition",
        "class_state": "Defect classes",
        "proposals": "Not promised, worth considering",
        "who_for": "Who it is for",
        "not_a_finding": "Why this is not a finding",
        "unconverted_tag": "UNCONVERTED",
        "unconvertible_tag": "NEED RESTRUCTURING",
        "symptom_count": "counted against a reviewer-invented pattern, not a structural population",
        "class_open": "Instances of this defect class remain unconverted.",
        "unconverted": "instance(s) of a filed defect still unconverted",
        "unswept_classes": "class(es) never searched or unenumerable",
        "cause_sweep": "Extent of cause",
        "instances_converted": "instances converted",
        "closure": "closed by",
        "over_scope": "over",
        "unswept_warning": "the defect class was never searched; other instances may remain unfiled",
        "findings": "Detailed findings",
        "unknowns": "Detailed unknowns",
        "gates": "Safety gates",
        "evidence": "Evidence",
        "evidence_lanes": "Evidence lanes",
        "workflow_blockers": "Workflow blockers",
        "release_checks": "Release checks",
        "scoring": "Scoring",
        "venture_assessment": "Venture assessment",
        "stage": "Stage",
        "evidence_maturity": "Evidence maturity",
        "strongest_signal": "Strongest proven signal",
        "unsupported_leap": "Largest unsupported leap",
        "signals": "Signals",
        "required": "required",
        "threshold_met": "Threshold met",
        "scorecard": "Scorecard",
        "not_requested": "not requested",
        "technical": "Technical closure",
        "workflow": "Workflow state",
        "verified_closed": "verified-closed",
        "stopped_risk": "stopped-with-accepted-risk",
        "in_progress": "in-progress",
        "pass": "PASS",
        "not_closed": "NOT CLOSED",
        "severity": "Severity",
        "finding_status": "Status",
        "invariant": "Promise/invariant",
        "preconditions": "Preconditions",
        "reproduction": "Reproduction",
        "expected": "Expected",
        "actual": "Actual",
        "impact": "Impact",
        "suspected_cause": "Suspected cause (inference)",
        "minimum_fix": "Minimum fix / prompt",
        "acceptance_test": "Acceptance test",
        "adjacent_check": "Adjacent regression check",
        "evidence_ids": "Evidence",
        "fix_authorization": "Fix authorization",
        "scope": "scope",
        "change": "Change",
        "by": "by",
        "retest": "Retest",
        "mutation": "Mutation check",
        "mutation_reason": "Mutation reason",
        "risk_acceptance": "Risk acceptance",
        "risk_scope": "Risk scope",
        "targets": "targets",
        "linked_findings": "findings",
        "gate_failures": "failure evidence",
        "gate_retests": "retest evidence",
        "condition": "Condition",
        "why": "Why it matters",
        "missing": "Missing evidence",
        "resolving": "Resolving test",
        "resolution_evidence": "Resolution evidence",
        "fix_origin": "Change origin",
        "blocker": "Blocker",
        "missing_requirement": "Missing requirement",
        "resolving_action": "Resolving action",
        "deployment_coverage": "deployment coverage",
        "eval_runs": "eval runs",
        "eval_provenance": "eval provenance",
        "eval_metrics": "eval metrics",
        "unverifiable_prefix": "The fix status for",
        "unverifiable_suffix": "could not be verified",
    },
    "zh-CN": {
        "title": "RateMyCode 审计台账",
        "ledger": "台账 ID",
        "previous_ledger": "上一版台账",
        "review_identity": "审查标识",
        "artifact": "审计对象",
        "initial_release": "初始版本",
        "current_release": "当前版本",
        "identity_method": "版本标识方法",
        "identity_scope": "版本标识范围",
        "scope_root": "根目录",
        "scope_included": "包含",
        "scope_excluded": "排除",
        "symlink_policy": "符号链接策略",
        "review": "审查设置",
        "mode": "闭环模式",
        "verdict": "当前结论",
        "maximum": "证据支持的最高阶段",
        "issues": "一句话问题清单",
        "pending": "待验证",
        "none": "无。",
        "progress": "进度",
        "status": "状态",
        "count": "数量",
        "root_causes": "共同根因",
        "condition_sweep": "同类实例扫描",
        "class_state": "缺陷类",
        "proposals": "产品没承诺过、但值得考虑的",
        "who_for": "谁会用到",
        "not_a_finding": "为什么不算缺陷",
        "unconverted_tag": "处未转换",
        "unconvertible_tag": "处需重构才能转换",
        "symptom_count": "这个计数的分母是审查者自拟的模式,不是结构性总体",
        "class_open": "这一类缺陷仍有实例没有转换。",
        "unconverted": "处同类实例仍未转换",
        "unswept_classes": "个类从未扫描或无法枚举",
        "cause_sweep": "根因延伸审查",
        "instances_converted": "处已转换",
        "closure": "结案方式",
        "over_scope": "扫描范围",
        "unswept_warning": "从未扫描过这一类缺陷，别处可能仍有未立案的实例",
        "findings": "问题详情",
        "unknowns": "待验证项详情",
        "gates": "安全门禁",
        "evidence": "证据",
        "evidence_lanes": "证据通道",
        "workflow_blockers": "流程阻塞项",
        "release_checks": "发布检查",
        "scoring": "评分",
        "venture_assessment": "投资判断",
        "stage": "项目阶段",
        "evidence_maturity": "证据成熟度",
        "strongest_signal": "最强已证实信号",
        "unsupported_leap": "最大未证实跳跃",
        "signals": "市场信号",
        "required": "必需",
        "threshold_met": "是否达标",
        "scorecard": "评分卡",
        "not_requested": "未请求",
        "technical": "技术闭环",
        "workflow": "流程状态",
        "verified_closed": "已验证闭环",
        "stopped_risk": "带已接受风险停止",
        "in_progress": "进行中",
        "pass": "通过",
        "not_closed": "未闭环",
        "severity": "严重程度",
        "finding_status": "状态",
        "invariant": "产品承诺或不变量",
        "preconditions": "前置条件",
        "reproduction": "复现步骤",
        "expected": "预期结果",
        "actual": "实际结果",
        "impact": "影响",
        "suspected_cause": "疑似根因（推断）",
        "minimum_fix": "最低限度修复或提示词",
        "acceptance_test": "验收测试",
        "adjacent_check": "相邻回归检查",
        "evidence_ids": "证据",
        "fix_authorization": "修复授权",
        "scope": "范围",
        "change": "变更",
        "by": "执行者",
        "retest": "复测",
        "mutation": "变异检查",
        "mutation_reason": "变异检查不适用原因",
        "risk_acceptance": "风险接受",
        "risk_scope": "风险接受范围",
        "targets": "影响目标",
        "linked_findings": "关联问题",
        "gate_failures": "失败证据",
        "gate_retests": "复测证据",
        "condition": "待验证条件",
        "why": "重要性",
        "missing": "缺失证据",
        "resolving": "验证方法",
        "resolution_evidence": "解决证据",
        "fix_origin": "变更来源",
        "blocker": "阻塞原因",
        "missing_requirement": "缺失条件",
        "resolving_action": "解除方式",
        "deployment_coverage": "部署覆盖",
        "eval_runs": "评估运行次数",
        "eval_provenance": "评估来源",
        "eval_metrics": "评估指标",
        "unverifiable_prefix": "无法确认",
        "unverifiable_suffix": "是否已经修复",
    },
}


STATUS_LABELS = {
    "en": {status: status for status in FINDING_STATUSES},
    "zh-CN": {
        "open": "未处理",
        "fixing": "修复中",
        "fixed-pending-retest": "已改待复测",
        "verified-fixed": "已验证修复",
        "partially-fixed": "部分修复",
        "not-fixed": "未修复",
        "regressed": "出现回归",
        "unverifiable": "无法验证",
        "blocked": "受阻",
        "accepted-risk": "用户接受风险",
    },
}

GATE_STATE_LABELS = {
    "en": {"active": "active", "fixed": "fixed"},
    "zh-CN": {"active": "生效中", "fixed": "已验证关闭"},
}

UNKNOWN_STATUS_LABELS = {
    "en": {
        "open": "open",
        "cleared": "cleared",
        "promoted-to-finding": "promoted-to-finding",
    },
    "zh-CN": {
        "open": "待验证",
        "cleared": "已排除",
        "promoted-to-finding": "已转为确认问题",
    },
}


def render_markdown(data: dict[str, Any], language: str) -> str:
    label = LABELS[language]
    status_labels = STATUS_LABELS[language]
    gate_state_labels = GATE_STATE_LABELS[language]
    unknown_status_labels = UNKNOWN_STATUS_LABELS[language]
    findings = data["findings"]
    unknowns = data["unknowns"]
    evidence_by_id = {item["id"]: item for item in data["evidence"]}
    finding_by_id = {item["id"]: item for item in findings}
    unverifiable_findings = [item for item in findings if item["status"] == "unverifiable"]
    unresolved = [
        item
        for item in findings
        if item["status"] not in {"verified-fixed", "accepted-risk", "unverifiable"}
    ]
    accepted = [item for item in findings if item["status"] == "accepted-risk"]
    open_unknowns = [item for item in unknowns if item["status"] == "open"]
    technically_closed = (
        data["verdict"]["current_decision"] in {"READY", "INVESTABLE"}
        and not unresolved
        and not unverifiable_findings
        and not accepted
        and not open_unknowns
        and not any(item["status"] == "active" for item in data["workflow_blockers"])
        and not any(
            item["required"] and item["status"] != "pass"
            for item in data["release_checks"]
        )
        and not (data["scoring"]["requested"] and data["scoring"]["threshold_met"] is False)
        and not any(
            gate["state"] == "active"
            and data["review"]["requested_target"] in gate["affected_targets"]
            for gate in data["gates"]
        )
    )
    if technically_closed:
        workflow_state = label["verified_closed"]
    elif not unresolved and not unverifiable_findings and not open_unknowns and accepted:
        workflow_state = label["stopped_risk"]
    else:
        workflow_state = label["in_progress"]

    lines = [
        f"# {label['title']}",
        "",
        f"## {label['issues']}",
        "",
    ]
    if findings:
        for item in findings:
            lines.append(
                f"- [{item['severity']} · {item['id']} · {status_labels[item['status']]}] "
                f"{markdown_text(item['title'])}: {markdown_text(item['impact'])}."
            )
    else:
        lines.append(label["none"])

    active_workflow_blockers = [
        item for item in data["workflow_blockers"] if item["status"] == "active"
    ]
    # A defect class that is still open is not a finding — nobody filed its
    # remaining instances — but it is exactly what this section is for: things
    # the report has not settled. Leaving it only under Root causes puts it
    # below where readers stop, which is the failure this feature exists to stop.
    open_classes = [
        root
        for root in data["root_causes"]
        if root["condition_sweep"]["state"] != "closed"
        or root["condition_sweep"]["instances_converted"]
        < root["condition_sweep"]["instances_found"]
    ]
    lines.extend(["", f"### {label['pending']}", ""])
    if unverifiable_findings or open_unknowns or active_workflow_blockers or open_classes:
        lines.extend(
            f"- [{item['severity']} · {item['id']} · UNVERIFIED] "
            f"{label['unverifiable_prefix']} {markdown_text(item['title'])} "
            f"{label['unverifiable_suffix']}: "
            f"{markdown_text(item['impact'])}."
            for item in unverifiable_findings
        )
        lines.extend(
            f"- [UNKNOWN · {item['id']} · UNVERIFIED] {markdown_text(item['unresolved_condition'])}: "
            f"{markdown_text(item['why_it_matters'])}."
            for item in open_unknowns
        )
        lines.extend(
            f"- [BLOCKER · {item['id']} · ACTIVE] {markdown_text(item['reason'])}: "
            f"{markdown_text(item['missing_requirement'])}."
            for item in active_workflow_blockers
        )
        for root in open_classes:
            sweep = root["condition_sweep"]
            remaining = sweep["instances_found"] - sweep["instances_converted"]
            if sweep["state"] in {"unswept", "unsweepable"}:
                tag = sweep["state"].upper()
                detail = (
                    markdown_text(sweep["note"])
                    if sweep["note"]
                    else label["unswept_warning"]
                )
            else:
                blocked = sweep["instances_unconvertible"]
                tag = f"{remaining - blocked} {label['unconverted_tag']}"
                if blocked:
                    # Needing a restructure is a different cost from not having
                    # got to it yet; one number for both hides that.
                    tag += f" + {blocked} {label['unconvertible_tag']}"
                detail = (
                    markdown_text(sweep["note"]) if sweep["note"] else label["class_open"]
                )
                if sweep["denominator"] == "pattern":
                    detail += f" ({label['symptom_count']})"
            lines.append(
                f"- [CLASS · {root['id']} · {tag}] "
                f"{markdown_text(root['title'])}: {detail}"
            )
    else:
        lines.append(label["none"])

    lines.extend(["", f"## {label['evidence_lanes']}", ""])
    for lane_id in (
        "deterministic-checks",
        "critical-journey-e2e",
        "probabilistic-eval",
        "continuous-evidence",
    ):
        lane = data["evidence_lanes"][lane_id]
        detail = f" — {markdown_text(lane['reason'])}" if "reason" in lane else ""
        cited = f" ({', '.join(lane['evidence_ids'])})" if lane["evidence_ids"] else ""
        lines.append(f"- `{lane_id}`: **{lane['status']}**{cited}{detail}")

    lines.extend(["", f"## {label['workflow_blockers']}", ""])
    if data["workflow_blockers"]:
        for blocker in data["workflow_blockers"]:
            resolution = ", ".join(blocker["resolution_evidence_ids"]) or label["none"]
            lines.append(
                f"- **{blocker['id']} · {blocker['status']}** — "
                f"{markdown_text(blocker['reason'])}; {label['missing_requirement']}: "
                f"{markdown_text(blocker['missing_requirement'])}; {label['resolving_action']}: "
                f"{markdown_text(blocker['resolving_action'])}; {label['resolution_evidence']}: "
                f"{resolution}"
            )
    else:
        lines.append(label["none"])

    lines.extend(["", f"## {label['release_checks']}", ""])
    if data["release_checks"]:
        for check in data["release_checks"]:
            evidence_ids = ", ".join(check["evidence_ids"]) or label["none"]
            lines.append(
                f"- **{markdown_text(check['id'])} · {check['status']}** — "
                f"{label['required']}={str(check['required']).lower()}; "
                f"{label['evidence_ids']}: {evidence_ids}"
            )
    else:
        lines.append(label["none"])

    scoring = data["scoring"]
    lines.extend(["", f"## {label['scoring']}", ""])
    if scoring["requested"]:
        lines.extend(
            [
                f"- {label['threshold_met']}: `{str(scoring['threshold_met']).lower()}`",
                f"- {label['scorecard']}: `{scoring['scorecard_ref']}`",
            ]
        )
    else:
        lines.append(label["not_requested"] + ".")

    if data["venture_assessment"] is not None:
        venture = data["venture_assessment"]
        lines.extend(
            [
                "",
                f"## {label['venture_assessment']}",
                "",
                f"- {label['stage']}: {markdown_text(venture['stage'])}",
                f"- {label['evidence_maturity']}: {markdown_text(venture['evidence_maturity'])}",
                f"- {label['strongest_signal']}: {markdown_text(venture['strongest_proven_signal'])}",
                f"- {label['unsupported_leap']}: {markdown_text(venture['largest_unsupported_leap'])}",
                f"- {label['signals']}:",
            ]
        )
        for signal_id, signal in venture["signals"].items():
            cited = ", ".join(signal["evidence_ids"]) or label["none"]
            lines.append(f"  - `{signal_id}`: **{signal['status']}** ({cited})")

    previous_ledger_line = (
        f"- {label['previous_ledger']}: `{data['previous_ledger_ref']}`"
        if data["previous_ledger_ref"]
        else f"- {label['previous_ledger']}: {label['none']}"
    )
    lines.extend(
        [
            "",
            f"## {label['review_identity']}",
            "",
            f"- {label['ledger']}: {code_span(data['ledger_id'])}",
            previous_ledger_line,
            f"- {label['artifact']}: {markdown_text(data['artifact']['name'])}",
            f"- {label['initial_release']}: `{data['artifact']['initial_release_ref']}`",
            f"- {label['current_release']}: `{data['artifact']['current_release_ref']}`",
            f"- {label['identity_method']}: `{data['artifact']['identity_method']}`",
            (
                f"- {label['identity_scope']}: {label['scope_root']}="
                f"{code_span(data['artifact']['identity_scope']['root'])}; "
                f"{label['scope_included']}="
                f"{render_list(data['artifact']['identity_scope']['included'])}; "
                f"{label['scope_excluded']}="
                f"{render_list(data['artifact']['identity_scope']['excluded']) or label['none']}; "
                f"{label['symlink_policy']}="
                f"`{data['artifact']['identity_scope']['symlink_policy']}`"
            ),
            (
                f"- {label['review']}: `{data['review']['role']}` / `{data['review']['degree']}` / "
                f"`{data['review']['requested_target']}` / {code_span(data['review']['rubric_id'])} / "
                f"`{data['review']['ai_behavior']}`"
            ),
            f"- {label['mode']}: `{data['loop_mode']}`",
            f"- {label['verdict']}: **{data['verdict']['current_decision']}**",
            f"- {label['maximum']}: `{data['verdict']['maximum_safe_target']}`",
        ]
    )

    counts = Counter(item["status"] for item in findings)
    lines.extend(
        [
            "",
            f"## {label['progress']}",
            "",
            f"- {label['workflow']}: **{workflow_state}**",
            f"- {label['technical']}: **{label['pass'] if technically_closed else label['not_closed']}**",
        ]
    )
    # Findings closing and the defect class closing are different facts, and the
    # status table below only counts the first. Without this line a reader of the
    # top of the report sees "1 verified-fixed" and never learns six instances
    # of the same defect are still out there.
    open_instances = sum(
        root["condition_sweep"]["instances_found"]
        - root["condition_sweep"]["instances_converted"]
        for root in data["root_causes"]
    )
    unswept_classes = sum(
        1
        for root in data["root_causes"]
        if root["condition_sweep"]["state"] in {"unswept", "unsweepable"}
    )
    if data["root_causes"]:
        lines.append(
            f"- {label['class_state']}: **{open_instances}** {label['unconverted']}"
            f", **{unswept_classes}** {label['unswept_classes']}"
        )
    lines.extend(
        [
            "",
            f"| {label['status']} | {label['count']} |",
            "|---|---:|",
        ]
    )
    for status in sorted(FINDING_STATUSES):
        if counts[status]:
            lines.append(f"| {status_labels[status]} | {counts[status]} |")
    lines.extend(["", f"## {label['root_causes']}", ""])
    if data["root_causes"]:
        for root in data["root_causes"]:
            root_findings = [finding_by_id[item_id] for item_id in root["finding_ids"]]
            root_counts = Counter(item["status"] for item in root_findings)
            progress = ", ".join(
                f"{status_labels[status]} {root_counts[status]}"
                for status in sorted(root_counts)
            )
            lines.append(
                f"- **{root['id']} · {markdown_text(root['title'])}** — {markdown_text(root['summary'])} "
                f"({progress})"
            )
            for sweep_line in render_root_cause_sweeps(root, label):
                lines.append(f"  - {sweep_line}")
    else:
        lines.append(label["none"])

    if data.get("proposals"):
        # Not issues. A reader who finds these under findings would conclude the
        # product broke promises it never made.
        lines.extend(["", f"## {label['proposals']}", ""])
        for item in data["proposals"]:
            line = (
                f"- **{item['id']} · {markdown_text(item['title'])}** "
                f"[{item['status']}] — {markdown_text(item['absent_capability'])} "
                f"{label['who_for']}: {markdown_text(item['who_would_use_it'])}. "
                f"{label['not_a_finding']}: {markdown_text(item['why_not_a_finding'])}"
            )
            if item["note"]:
                line += f" ({markdown_text(item['note'])})"
            lines.append(line)

    lines.extend(["", f"## {label['gates']}", ""])
    if data["gates"]:
        for gate in data["gates"]:
            lines.append(
                f"- **{gate['id']} · {gate_state_labels[gate['state']]}** — {label['targets']}: "
                f"{', '.join(gate['affected_targets'])}; {label['linked_findings']}: "
                f"{', '.join(gate['finding_ids'])}; {label['gate_failures']}: "
                f"{', '.join(gate['evidence_ids'])}; {label['gate_retests']}: "
                f"{', '.join(gate['retest_evidence_ids']) or label['none']}"
            )
    else:
        lines.append(label["none"])

    lines.extend(["", f"## {label['findings']}", ""])
    for finding in findings:
        lines.extend(
            [
                f"### {finding['id']} · {markdown_text(finding['title'])}",
                "",
                f"- {label['severity']}: `{finding['severity']}`",
                f"- {label['finding_status']}: `{finding['status']}`",
                f"- {label['invariant']}: {markdown_text(finding['promise_or_invariant'])}",
                f"- {label['preconditions']}: {render_list(finding['preconditions'])}",
                f"- {label['reproduction']}: {render_list(finding['reproduction_steps'])}",
                f"- {label['expected']}: {markdown_text(finding['expected'])}",
                f"- {label['actual']}: {markdown_text(finding['actual'])}",
                f"- {label['impact']}: {markdown_text(finding['impact'])}",
                f"- {label['suspected_cause']}: {markdown_text(finding['suspected_cause'])}",
                f"- {label['minimum_fix']}: {markdown_text(finding['minimum_fix_or_agent_prompt'])}",
                f"- {label['acceptance_test']}: {markdown_text(finding['acceptance_test'])}",
                f"- {label['adjacent_check']}: {markdown_text(finding['adjacent_regression_check'])}",
                f"- {label['evidence_ids']}: {', '.join(finding['evidence_ids'])}",
            ]
        )
        if finding["fix_authorization"] is not None:
            lines.append(
                f"- {label['fix_authorization']}: {markdown_text(finding['fix_authorization']['statement'])} "
                f"({label['scope']}: {markdown_text(finding['fix_authorization']['scope'])})"
            )
        if finding["fix"] is not None:
            lines.append(f"- {label['fix_origin']}: `{finding['fix']['origin']}`")
            lines.append(
                f"- {label['change']}: {code_span(finding['fix']['change_ref'])} · {label['by']} "
                f"{code_span(finding['fix']['actor_id'])} — {markdown_text(finding['fix']['summary'])}"
            )
        if finding["retest"] is not None:
            lines.append(
                f"- {label['retest']}: `{finding['retest']['classification']}` · {label['by']} "
                f"{code_span(finding['retest']['reviewer_id'])} "
                f"({finding['retest']['reviewer_context']}); {label['acceptance_test']} "
                f"`{finding['retest']['acceptance_test']}`, {label['adjacent_check']} "
                f"`{finding['retest']['adjacent_regression_check']}`, {label['mutation']} "
                f"`{finding['retest']['mutation_test']['status']}`; {label['evidence_ids']} "
                f"{', '.join(finding['retest']['evidence_ids']) or 'none'}"
            )
            mutation_reason = finding["retest"]["mutation_test"].get("reason")
            if mutation_reason is not None:
                lines.append(
                    f"- {label['mutation_reason']}: {markdown_text(mutation_reason)}"
                )
        if finding["risk_acceptance"] is not None:
            risk_line = (
                f"- {label['risk_acceptance']}: "
                f"{markdown_text(finding['risk_acceptance']['statement'])}; "
                f"{label['risk_scope']}: {markdown_text(finding['risk_acceptance']['scope'])}"
            )
            if "rationale" in finding["risk_acceptance"]:
                risk_line += f" — {markdown_text(finding['risk_acceptance']['rationale'])}"
            lines.append(risk_line)
        if finding["blocker"] is not None:
            lines.extend(
                [
                    f"- {label['blocker']}: {markdown_text(finding['blocker']['reason'])}",
                    f"- {label['missing_requirement']}: "
                    f"{markdown_text(finding['blocker']['missing_requirement'])}",
                    f"- {label['resolving_action']}: "
                    f"{markdown_text(finding['blocker']['resolving_action'])}",
                ]
            )
        lines.append("")

    lines.extend([f"## {label['unknowns']}", ""])
    if unknowns:
        for unknown in unknowns:
            lines.extend(
                [
                    f"### {unknown['id']} · {unknown_status_labels[unknown['status']]}",
                    "",
                    f"- {label['condition']}: {markdown_text(unknown['unresolved_condition'])}",
                    f"- {label['why']}: {markdown_text(unknown['why_it_matters'])}",
                    f"- {label['missing']}: {markdown_text(unknown['missing_evidence'])}",
                    f"- {label['resolving']}: {markdown_text(unknown['resolving_test'])}",
                    f"- {label['resolution_evidence']}: "
                    f"{', '.join(unknown['resolution_evidence_ids']) or label['none']}",
                    "",
                ]
            )
    else:
        lines.extend([label["none"], ""])

    lines.extend([f"## {label['evidence']}", ""])
    if data["evidence"]:
        for evidence_id in sorted(evidence_by_id):
            item = evidence_by_id[evidence_id]
            detail = (
                f"- **{evidence_id} · {item['state']} · {item['result']}** — "
                f"{markdown_text(item['summary'])} ({code_span(item['locator'])}; "
                f"`{item['release_ref']}`; `{item['kind']}` / `{item['lane']}`; "
                f"`{item['subject_id'] or 'release'}`; `{item['procedure']}`; "
                f"fresh={str(item['fresh']).lower()}; "
                f"reproducible={str(item['reproducible']).lower()}"
            )
            for binding in (
                "gate_id",
                "workflow_blocker_id",
                "release_check_id",
                "venture_signal_id",
            ):
                if binding in item:
                    detail += f"; {binding}={code_span(item[binding])}"
            if "deployment_coverage" in item:
                coverage = item["deployment_coverage"]
                detail += (
                    f"; {label['deployment_coverage']}="
                    f"scope_complete:{str(coverage['scope_complete']).lower()},"
                    f"compensating_layer_ruled_out:"
                    f"{str(coverage['compensating_layer_ruled_out']).lower()}"
                )
            if item["kind"] == "eval":
                provenance = ", ".join(
                    f"{key}={value}" for key, value in item["provenance"].items()
                )
                metrics = ", ".join(
                    f"{key}={value}" for key, value in item["eval_metrics"].items()
                )
                detail += (
                    f"; {label['eval_runs']}={item['runs']}; "
                    f"{label['eval_provenance']}={markdown_text(provenance)}; "
                    f"{label['eval_metrics']}={markdown_text(metrics)}"
                )
            lines.append(detail + ")")
    else:
        lines.append(label["none"])
    return "\n".join(lines).rstrip() + "\n"


def load_ledger(path: Path) -> dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise ValidationError("$", f"cannot read {path}: {exc}") from exc
    if size > MAX_INPUT_BYTES:
        raise ValidationError("$", f"input exceeds {MAX_INPUT_BYTES} bytes")
    try:
        payload = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValidationError("$", f"invalid UTF-8 JSON: {exc}") from exc
    return validate(payload)


def ledger_file_ref(path: Path) -> str:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ValidationError("$", f"cannot read prior ledger {path}: {exc}") from exc
    if len(data) > MAX_INPUT_BYTES:
        raise ValidationError("$", f"prior ledger exceeds {MAX_INPUT_BYTES} bytes")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def validate_continuity(previous: dict[str, Any], current: dict[str, Any], prior_ref: str) -> None:
    if current["previous_ledger_ref"] != prior_ref:
        raise ValidationError(
            "$.previous_ledger_ref", "must equal the SHA-256 of the exact prior ledger file"
        )
    if current["ledger_id"] != previous["ledger_id"]:
        raise ValidationError("$.ledger_id", "must match the prior ledger")
    if current["snapshot_index"] != previous["snapshot_index"] + 1:
        raise ValidationError(
            "$.snapshot_index",
            "must be exactly one greater than the prior ledger; a gap means a snapshot was lost or skipped",
        )
    stable_artifact_fields = {
        "name",
        "initial_release_ref",
        "identity_method",
        "identity_scope",
    }
    for field in stable_artifact_fields:
        if current["artifact"][field] != previous["artifact"][field]:
            raise ValidationError(f"$.artifact.{field}", "must match the prior ledger")
    if current["review"] != previous["review"]:
        raise ValidationError(
            "$.review", "role, degree, target, rubric, and AI behavior must match the prior ledger"
        )
    if current["verdict"]["initial_decision"] != previous["verdict"]["initial_decision"]:
        raise ValidationError(
            "$.verdict.initial_decision", "must match the prior ledger"
        )
    if current["scoring"]["requested"] != previous["scoring"]["requested"]:
        raise ValidationError(
            "$.scoring.requested",
            "must match the prior ledger; changing whether scoring was requested starts a new review chain",
        )
    current_evidence = {item["id"]: item for item in current["evidence"]}
    for item in previous["evidence"]:
        if current_evidence.get(item["id"]) != item:
            raise ValidationError(
                "$.evidence", f"prior evidence {item['id']!r} must be preserved unchanged"
            )
    current_root_causes = {item["id"]: item for item in current["root_causes"]}
    for prior_root_cause in previous["root_causes"]:
        root_cause_id = prior_root_cause["id"]
        current_root_cause = current_root_causes.get(root_cause_id)
        if current_root_cause is None:
            raise ValidationError(
                "$.root_causes",
                f"prior root cause {root_cause_id!r} was deleted",
            )
        if any(
            current_root_cause[field] != prior_root_cause[field]
            for field in ("title", "summary")
        ) or not set(prior_root_cause["finding_ids"]).issubset(
            current_root_cause["finding_ids"]
        ):
            raise ValidationError(
                f"$.root_causes[{root_cause_id}]",
                "title, summary, and prior finding links must be preserved",
            )
        # A class can legitimately reopen — a later delta audit may surface
        # instances the first expression missed. Returning to "never looked"
        # cannot happen, so it is always a bookkeeping error.
        if (
            prior_root_cause["condition_sweep"]["state"] != "unswept"
            and current_root_cause["condition_sweep"]["state"] == "unswept"
        ):
            raise ValidationError(
                f"$.root_causes[{root_cause_id}].condition_sweep.state",
                "a searched defect class cannot revert to 'unswept'",
            )
    if current["schema_version"] < previous["schema_version"]:
        raise ValidationError(
            "$.schema_version",
            f"a chain cannot return to schema {current['schema_version']!r} after "
            f"{previous['schema_version']!r}; older rules cannot judge newer records",
        )
    mutable_finding_fields = {
        "status",
        "fix_authorization",
        "fix",
        "retest",
        "risk_acceptance",
        "blocker",
        # Grouping a finding under a root cause is a sequencing decision the fix
        # loop makes after the initial verdict, so an unassigned finding may
        # later join one. Regrouping an already-grouped finding needs no rule
        # here: the bidirectional link check and the preserved-finding-links
        # subset check below already make it unreachable.
        "root_cause_id",
    }
    current_findings = {item["id"]: item for item in current["findings"]}
    for prior_finding in previous["findings"]:
        finding_id = prior_finding["id"]
        if finding_id not in current_findings:
            raise ValidationError("$.findings", f"prior finding {finding_id!r} was deleted")
        prior_definition = {
            key: value for key, value in prior_finding.items() if key not in mutable_finding_fields
        }
        current_definition = {
            key: value
            for key, value in current_findings[finding_id].items()
            if key not in mutable_finding_fields
        }
        if current_definition != prior_definition:
            raise ValidationError(
                f"$.findings[{finding_id}]",
                "severity, reproduction, acceptance, impact, and other finding identity fields must match the prior ledger",
            )
        current_finding = current_findings[finding_id]
        if current_finding["status"] not in FINDING_STATUS_TRANSITIONS[
            prior_finding["status"]
        ]:
            raise ValidationError(
                f"$.findings[{finding_id}].status",
                f"cannot transition from {prior_finding['status']!r} to {current_finding['status']!r}",
            )
        if (
            prior_finding["status"] == "verified-fixed"
            and current_finding["status"] != "verified-fixed"
            and (
                current_finding["retest"] is None
                or current_finding["retest"]["classification"] == "FIXED"
            )
        ):
            raise ValidationError(
                f"$.findings[{finding_id}].retest",
                "leaving verified-fixed requires a fresh non-FIXED independent retest",
            )
    current_unknowns = {item["id"]: item for item in current["unknowns"]}
    mutable_unknown_fields = {"status", "resolution_evidence_ids", "finding_id"}
    for prior_unknown in previous["unknowns"]:
        unknown_id = prior_unknown["id"]
        if unknown_id not in current_unknowns:
            raise ValidationError("$.unknowns", f"prior unknown {unknown_id!r} was deleted")
        prior_definition = {
            key: value for key, value in prior_unknown.items() if key not in mutable_unknown_fields
        }
        current_definition = {
            key: value
            for key, value in current_unknowns[unknown_id].items()
            if key not in mutable_unknown_fields
        }
        if current_definition != prior_definition:
            raise ValidationError(
                f"$.unknowns[{unknown_id}]", "unknown identity fields must match the prior ledger"
            )
        prior_status = prior_unknown["status"]
        current_unknown = current_unknowns[unknown_id]
        current_status = current_unknown["status"]
        if prior_status == "promoted-to-finding" and (
            current_status != "promoted-to-finding"
            or current_unknown["finding_id"] != prior_unknown["finding_id"]
        ):
            raise ValidationError(
                f"$.unknowns[{unknown_id}].status",
                "a promoted unknown must remain linked to the same confirmed finding",
            )
        if prior_status == "cleared" and current_status == "open":
            if not any(
                record["subject_id"] == unknown_id
                and record["procedure"] == "unknown-resolution"
                and record["state"] != "E0"
                and record["fresh"]
                and record["reproducible"]
                and record["release_ref"] == current["artifact"]["current_release_ref"]
                and record["result"] in {"fail", "mixed"}
                for record in current_evidence.values()
            ):
                raise ValidationError(
                    f"$.unknowns[{unknown_id}].status",
                    "reopening a cleared unknown requires fresh current fail or mixed resolution evidence",
                )
    current_gates = {item["id"]: item for item in current["gates"]}
    for prior_gate in previous["gates"]:
        gate_id = prior_gate["id"]
        if gate_id not in current_gates:
            raise ValidationError("$.gates", f"prior gate {gate_id!r} was deleted")
        for field in ("affected_targets", "finding_ids"):
            if current_gates[gate_id][field] != prior_gate[field]:
                raise ValidationError(
                    f"$.gates[{gate_id}].{field}", "must match the prior ledger"
                )
        for field in ("evidence_ids", "retest_evidence_ids"):
            if not set(prior_gate[field]).issubset(current_gates[gate_id][field]):
                raise ValidationError(
                    f"$.gates[{gate_id}].{field}",
                    "must preserve every prior evidence reference; new attempts may only append",
                )
        if prior_gate["state"] == "fixed" and current_gates[gate_id]["state"] == "active":
            if not any(
                qualifies_gate_failure(
                    record,
                    gate_id,
                    current["artifact"]["current_release_ref"],
                )
                for record in current_evidence.values()
            ):
                raise ValidationError(
                    f"$.gates[{gate_id}].state",
                    "reopening a fixed gate requires fresh current qualifying failure evidence",
                )

    current_blockers = {item["id"]: item for item in current["workflow_blockers"]}
    for prior_blocker in previous["workflow_blockers"]:
        blocker_id = prior_blocker["id"]
        current_blocker = current_blockers.get(blocker_id)
        if current_blocker is None:
            raise ValidationError(
                "$.workflow_blockers",
                f"prior workflow blocker {blocker_id!r} was deleted",
            )
        for field in ("reason", "missing_requirement", "resolving_action"):
            if current_blocker[field] != prior_blocker[field]:
                raise ValidationError(
                    f"$.workflow_blockers[{blocker_id}].{field}",
                    "must match the prior ledger",
                )
        if prior_blocker["status"] == "resolved" and current_blocker["status"] != "resolved":
            raise ValidationError(
                f"$.workflow_blockers[{blocker_id}].status",
                "a resolved workflow blocker cannot reopen; record a new blocker ID",
            )

    current_checks = {item["id"]: item for item in current["release_checks"]}
    for prior_check in previous["release_checks"]:
        check_id = prior_check["id"]
        if check_id not in current_checks:
            raise ValidationError(
                "$.release_checks", f"prior release check {check_id!r} was deleted"
            )
        if current_checks[check_id]["required"] != prior_check["required"]:
            raise ValidationError(
                f"$.release_checks[{check_id}].required",
                "must match the prior ledger; add a new check ID for a new policy",
            )


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def summary(data: dict[str, Any]) -> dict[str, Any]:
    counts = Counter(item["status"] for item in data["findings"])
    return {
        "valid": True,
        "schema_version": data["schema_version"],
        "ledger_id": data["ledger_id"],
        "current_release_ref": data["artifact"]["current_release_ref"],
        "findings": len(data["findings"]),
        "verified_fixed": counts["verified-fixed"],
        "accepted_risk": counts["accepted-risk"],
        "unresolved": sum(
            count
            for status, count in counts.items()
            if status not in {"verified-fixed", "accepted-risk"}
        ),
        "open_unknowns": sum(item["status"] == "open" for item in data["unknowns"]),
        # Findings closing and classes closing are different facts. This summary
        # is the surface a CI gate reads, so leaving the class state out of it
        # reproduces the whole defect one layer down: green counts, open class.
        "proposals": len(data.get("proposals", [])),
        "proposals_open": sum(
            1 for item in data.get("proposals", []) if item["status"] == "proposed"
        ),
        "defect_classes": len(data["root_causes"]),
        "classes_open": sum(
            1
            for root in data["root_causes"]
            if root["condition_sweep"]["state"] != "closed"
        ),
        "classes_unswept": sum(
            1
            for root in data["root_causes"]
            if root["condition_sweep"]["state"] in {"unswept", "unsweepable"}
        ),
        "instances_unconverted": sum(
            root["condition_sweep"]["instances_found"]
            - root["condition_sweep"]["instances_converted"]
            - root["condition_sweep"]["instances_unconvertible"]
            for root in data["root_causes"]
        ),
        "instances_unconvertible": sum(
            root["condition_sweep"]["instances_unconvertible"]
            for root in data["root_causes"]
        ),
        "current_decision": data["verdict"]["current_decision"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate", help="validate a ledger and print a summary")
    validate_parser.add_argument("ledger", type=Path)
    validate_parser.add_argument("--prior", type=Path, help="verify continuity from a prior ledger")
    render_parser = subparsers.add_parser("render", help="validate and render a Markdown report")
    render_parser.add_argument("ledger", type=Path)
    render_parser.add_argument("--language", choices=sorted(LABELS), default="en")
    render_parser.add_argument("--output", type=Path)
    render_parser.add_argument("--prior", type=Path, help="verify continuity from a prior ledger")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        data = load_ledger(args.ledger)
        if data["previous_ledger_ref"] is not None and args.prior is None:
            raise ValidationError(
                "$.previous_ledger_ref",
                "a chained ledger must be validated or rendered with --prior",
            )
        if args.prior is not None:
            prior_data = load_ledger(args.prior)
            validate_continuity(prior_data, data, ledger_file_ref(args.prior))
        if args.command == "validate":
            print(json.dumps(summary(data), ensure_ascii=False, sort_keys=True))
            return 0
        markdown = render_markdown(data, args.language)
        if args.output is None:
            sys.stdout.write(markdown)
        else:
            if args.ledger.resolve() == args.output.resolve():
                raise ValidationError("--output", "must not overwrite the JSON ledger")
            atomic_write(args.output, markdown)
            print(f"wrote {args.output}")
        return 0
    except ValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
