#!/usr/bin/env python3
"""Independent Python verifier for semantic-query SQLite audit receipts.

This implementation does not import the Node.js receipt builder or verifier. It
reconstructs canonical JSON from normalized SQLite tables and checks receipt,
node, dependency, evidence, service-output and anchor commitments.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASES = [
    ROOT / "docs/xn/experiments/semantic-query-live-runs/2026-08-25T01-46-44-989Z/audit.db",
    ROOT / "docs/xn/experiments/semantic-query-physical-fault-runs/2026-08-25T01-52-36-106Z/audit.db",
]
DEFAULT_OUTPUT = ROOT / "docs/xn/experiments/independent_audit_verification.json"


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def hash_value(value: Any) -> str:
    return "0x" + hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest()


def without(record: dict[str, Any], field: str) -> dict[str, Any]:
    result = dict(record)
    result.pop(field, None)
    return result


def load_receipt(connection: sqlite3.Connection, query_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    connection.row_factory = sqlite3.Row
    query = connection.execute(
        "SELECT * FROM audit_queries WHERE query_id = ?", (query_id,)
    ).fetchone()
    if query is None:
        raise KeyError(query_id)

    def records(sql: str) -> list[dict[str, Any]]:
        return [json.loads(row[0]) for row in connection.execute(sql, (query_id,)).fetchall()]

    receipt = {
        "schemaVersion": query["schema_version"],
        "queryId": query["query_id"],
        "queryDigest": query["query_digest"],
        "dagVersion": query["dag_version"],
        "rootNodeId": query["root_node_id"],
        "terminalState": query["terminal_state"],
        "outcome": query["outcome"],
        "nodes": records("SELECT node_json FROM audit_nodes WHERE query_id = ? ORDER BY node_id"),
        "evidence": records("SELECT evidence_json FROM audit_evidence WHERE query_id = ? ORDER BY evidence_id"),
        "serviceOutputs": records(
            "SELECT output_json FROM audit_service_outputs WHERE query_id = ? ORDER BY output_id"
        ),
        "conflicts": json.loads(query["conflicts_json"]),
        "recoveries": json.loads(query["recoveries_json"]),
        "events": records("SELECT event_json FROM audit_events WHERE query_id = ? ORDER BY seq"),
        "startedAt": query["started_at"],
        "completedAt": query["completed_at"],
        "receiptRoot": query["receipt_root"],
    }
    anchors = [
        {**json.loads(row["anchor_json"]), "storedReceiptRoot": row["receipt_root"]}
        for row in connection.execute(
            "SELECT anchor_json,receipt_root FROM audit_anchors WHERE query_id = ? ORDER BY created_at",
            (query_id,),
        ).fetchall()
    ]
    return receipt, anchors


def verify_receipt(receipt: dict[str, Any], anchored_roots: list[str] | None = None) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    computed_root = hash_value(without(receipt, "receiptRoot"))
    if receipt.get("receiptRoot") != computed_root:
        issues.append({"code": "RECEIPT_ROOT_MISMATCH"})
    for anchored_root in anchored_roots or []:
        if anchored_root != computed_root:
            issues.append({"code": "ANCHOR_ROOT_MISMATCH"})

    nodes = receipt.get("nodes") or []
    by_id = {node.get("nodeId"): node for node in nodes}
    if receipt.get("rootNodeId") not in by_id:
        issues.append({"code": "MISSING_ROOT_NODE", "nodeId": receipt.get("rootNodeId")})
    for node in nodes:
        node_id = node.get("nodeId")
        if node.get("nodeHash") != hash_value(without(node, "nodeHash")):
            issues.append({"code": "NODE_HASH_MISMATCH", "nodeId": node_id})
        dependencies = node.get("deps") or []
        input_hashes = node.get("inputHashes") or []
        if len(dependencies) != len(input_hashes):
            issues.append({"code": "INPUT_HASH_COUNT_MISMATCH", "nodeId": node_id})
        for index, dependency_id in enumerate(dependencies):
            dependency = by_id.get(dependency_id)
            if dependency is None:
                issues.append({"code": "MISSING_DEPENDENCY", "nodeId": node_id, "dependency": dependency_id})
            elif index >= len(input_hashes) or input_hashes[index] != dependency.get("nodeHash"):
                issues.append({
                    "code": "DEPENDENCY_HASH_MISMATCH", "nodeId": node_id, "dependency": dependency_id
                })

    for evidence in receipt.get("evidence") or []:
        if evidence.get("evidenceHash") != hash_value(without(evidence, "evidenceHash")):
            issues.append({"code": "EVIDENCE_HASH_MISMATCH", "evidenceId": evidence.get("evidenceId")})
    for output in receipt.get("serviceOutputs") or []:
        if output.get("serviceOutputHash") != hash_value(without(output, "serviceOutputHash")):
            issues.append({
                "code": "SERVICE_OUTPUT_HASH_MISMATCH",
                "serviceOutputId": output.get("serviceOutputId"),
            })
    return issues


def binding_coverage(receipt: dict[str, Any]) -> dict[str, int]:
    evidence = receipt.get("evidence") or []
    successful_leaf_nodes = [
        node for node in receipt.get("nodes") or []
        if node.get("kind") == "evidence" and node.get("status") == "SUCCEEDED"
    ]
    explicit = {item.get("nodeId") for item in evidence if item.get("nodeId")}
    covered = 0
    inferred = 0
    for node in successful_leaf_nodes:
        if node.get("nodeId") in explicit:
            covered += 1
        elif any(item.get("payloadHash") == node.get("outputHash") for item in evidence):
            covered += 1
            inferred += 1
    semantic_nodes = [
        node for node in receipt.get("nodes") or []
        if node.get("kind") == "semantic" and node.get("status") == "SUCCEEDED"
    ]
    explicit_service_nodes = {
        item.get("nodeId") for item in receipt.get("serviceOutputs") or [] if item.get("nodeId")
    }
    return {
        "successfulEvidenceNodes": len(successful_leaf_nodes),
        "coveredEvidenceNodes": covered,
        "inferredEvidenceBindings": inferred,
        "explicitEvidenceBindings": len(explicit),
        "successfulSemanticNodes": len(semantic_nodes),
        "explicitServiceBindings": sum(node.get("nodeId") in explicit_service_nodes for node in semantic_nodes),
    }


def mutate(receipt: dict[str, Any], mutation: str) -> tuple[dict[str, Any], list[str]]:
    changed = copy.deepcopy(receipt)
    if mutation == "delete_node":
        candidates = [node for node in changed["nodes"] if node.get("nodeId") != changed.get("rootNodeId")]
        target = candidates[0]
        changed["nodes"] = [node for node in changed["nodes"] if node.get("nodeId") != target.get("nodeId")]
        return changed, ["RECEIPT_ROOT_MISMATCH", "MISSING_DEPENDENCY"]
    if mutation == "replace_output":
        target = next(node for node in changed["nodes"] if node.get("status") == "SUCCEEDED")
        target["outputHash"] = hash_value({"tampered": target.get("nodeId")})
        return changed, ["RECEIPT_ROOT_MISMATCH", "NODE_HASH_MISMATCH"]
    if mutation == "wrong_version":
        target = changed["nodes"][0]
        target["version"] = f"{target.get('version')}-tampered"
        return changed, ["RECEIPT_ROOT_MISMATCH", "NODE_HASH_MISMATCH"]
    if mutation == "delete_evidence":
        if not changed.get("evidence"):
            return changed, []
        changed["evidence"] = changed["evidence"][1:]
        return changed, ["RECEIPT_ROOT_MISMATCH"]
    raise ValueError(mutation)


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(len(ordered) - 1, lower + 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def audit_database(database_path: Path) -> dict[str, Any]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        query_ids = [row[0] for row in connection.execute("SELECT query_id FROM audit_queries ORDER BY query_id")]
        clean_ok = 0
        anchor_ok = 0
        elapsed_ms: list[float] = []
        coverage = {
            "successfulEvidenceNodes": 0,
            "coveredEvidenceNodes": 0,
            "inferredEvidenceBindings": 0,
            "explicitEvidenceBindings": 0,
            "successfulSemanticNodes": 0,
            "explicitServiceBindings": 0,
        }
        mutation_counts = {
            name: {"tested": 0, "detected": 0, "localized": 0}
            for name in ["delete_node", "replace_output", "wrong_version", "delete_evidence"]
        }
        for query_id in query_ids:
            receipt, anchors = load_receipt(connection, query_id)
            anchored_roots = [anchor["storedReceiptRoot"] for anchor in anchors]
            started = time.perf_counter()
            issues = verify_receipt(receipt, anchored_roots)
            elapsed_ms.append((time.perf_counter() - started) * 1000)
            clean_ok += int(not issues)
            anchor_ok += int(bool(anchors) and all(root == receipt["receiptRoot"] for root in anchored_roots))
            current = binding_coverage(receipt)
            for key, value in current.items():
                coverage[key] += value
            for mutation_name, counters in mutation_counts.items():
                changed, expected_codes = mutate(receipt, mutation_name)
                if not expected_codes:
                    continue
                mutation_issues = verify_receipt(changed, anchored_roots)
                codes = {issue["code"] for issue in mutation_issues}
                counters["tested"] += 1
                counters["detected"] += int(bool(codes))
                counters["localized"] += int(any(code in codes for code in expected_codes[1:]) if len(expected_codes) > 1 else expected_codes[0] in codes)
        evidence_total = coverage["successfulEvidenceNodes"]
        semantic_total = coverage["successfulSemanticNodes"]
        try:
            database_label = str(database_path.relative_to(ROOT))
        except ValueError:
            database_label = str(database_path)
        return {
            "database": database_label,
            "integrity": integrity,
            "queries": len(query_ids),
            "cleanReconstruction": clean_ok,
            "anchorMatch": anchor_ok,
            "reconstructionMs": {
                "mean": sum(elapsed_ms) / len(elapsed_ms),
                "p50": percentile(elapsed_ms, 0.5),
                "p95": percentile(elapsed_ms, 0.95),
                "p99": percentile(elapsed_ms, 0.99),
            },
            "bindingCoverage": {
                **coverage,
                "evidenceCoverageRate": coverage["coveredEvidenceNodes"] / evidence_total if evidence_total else 1.0,
                "explicitServiceCoverageRate": coverage["explicitServiceBindings"] / semantic_total if semantic_total else 1.0,
            },
            "mutations": mutation_counts,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("databases", nargs="*", type=Path, default=DEFAULT_DATABASES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = {
        "schemaVersion": "independent-audit-verification-v1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "implementation": "independent Python canonical-JSON and SQLite verifier",
        "results": [audit_database(path.resolve()) for path in args.databases],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.out)


if __name__ == "__main__":
    main()
