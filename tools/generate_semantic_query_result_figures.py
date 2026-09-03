#!/usr/bin/env python3
"""Generate reproducible SVG result figures from semantic-query experiment JSON."""

from __future__ import annotations

import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "xn"
FIG = DOC / "figures"
LIVE = DOC / "experiments" / "semantic-query-live-runs" / "2026-08-25T01-46-44-989Z" / "summary.json"
PHYSICAL = DOC / "experiments" / "semantic-query-physical-fault-runs" / "2026-08-25T01-52-36-106Z" / "summary.json"
EXTENDED = DOC / "experiments" / "semantic-query-extended-evaluation" / "results.json"
HISTORICAL_AUDIT = DOC / "experiments" / "independent_audit_verification.json"
V2_AUDIT = DOC / "experiments" / "semantic-query-receipt-v2-independent-verification.json"
SATURATION = DOC / "experiments" / "semantic-query-live-concurrency-runs" / "2026-09-01T01-28-00-905Z" / "summary.json"
SATURATION_AUDIT = DOC / "experiments" / "semantic-query-live-concurrency-runs" / "2026-09-01T01-28-00-905Z" / "independent_verification.json"
REGULATORY = DOC / "experiments" / "semantic-query-live-regulatory-runs" / "2026-09-01T01-38-58-803Z" / "summary.json"
REGULATORY_AUDIT = DOC / "experiments" / "semantic-query-live-regulatory-runs" / "2026-09-01T01-38-58-803Z" / "independent_verification.json"
RESILIENCE_AUDIT = DOC / "experiments" / "semantic-query-live-resilience-runs" / "2026-09-01T07-55-45-402Z" / "independent_verification.json"
MATERIAL_OUTAGE_AUDIT = DOC / "experiments" / "semantic-query-live-resilience-runs" / "2026-09-02T00-46-44-501Z" / "independent_verification.json"
MULTIWALLET = DOC / "experiments" / "semantic-query-live-multiwallet-runs" / "2026-09-02-formal-w4" / "summary.json"
MULTIWALLET_AUDIT = DOC / "experiments" / "semantic-query-live-multiwallet-runs" / "2026-09-02-formal-w4" / "independent_verification.json"

WIDTH, HEIGHT = 1600, 900
FONT = "Arial, Helvetica, sans-serif"
INK = "#14213d"
MUTED = "#53657a"
GRID = "#d9e2ec"
BLUE = "#1768ac"
CYAN = "#15a3b8"
ORANGE = "#f28e2b"
RED = "#d1495b"
GREEN = "#2a9d5b"
PURPLE = "#7353ba"


class Svg:
    def __init__(self, title: str):
        self.items = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
            f"<title>{html.escape(title)}</title>",
            '<rect width="100%" height="100%" fill="#ffffff"/>',
        ]

    def text(self, x, y, value, size=24, *, anchor="start", weight="400", fill=INK, rotate=None):
        transform = f' transform="rotate({rotate} {x} {y})"' if rotate is not None else ""
        self.items.append(
            f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{FONT}" '
            f'font-size="{size}" font-weight="{weight}" fill="{fill}"{transform}>{html.escape(str(value))}</text>'
        )

    def line(self, x1, y1, x2, y2, *, stroke=INK, width=2, dash=None):
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        self.items.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{width}"{dash_attr}/>'
        )

    def rect(self, x, y, width, height, *, fill=BLUE, stroke="none", radius=0, opacity=1):
        self.items.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" '
            f'fill="{fill}" stroke="{stroke}" opacity="{opacity}"/>'
        )

    def circle(self, x, y, radius, *, fill=BLUE, stroke="#ffffff", width=2):
        self.items.append(
            f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>'
        )

    def polyline(self, points, *, stroke=BLUE, width=4):
        value = " ".join(f"{x},{y}" for x, y in points)
        self.items.append(f'<polyline points="{value}" fill="none" stroke="{stroke}" stroke-width="{width}"/>')

    def panel(self, x, y, width, height, label, title, subtitle=None):
        self.rect(x, y, width, height, fill="#fbfdff", stroke="#c9d6e2", radius=14)
        self.rect(x + 18, y + 18, 40, 40, fill=INK, radius=8)
        self.text(x + 38, y + 47, label, 24, anchor="middle", weight="700", fill="#ffffff")
        self.text(x + 74, y + 48, title, 27, weight="700")
        if subtitle:
            self.text(x + 74, y + 76, subtitle, 17, fill=MUTED)

    def finish(self):
        return "\n".join(self.items + ["</svg>", ""])


def ticks(max_value, count=4):
    return [max_value * index / count for index in range(count + 1)]


def bar_chart(svg, box, labels, values, *, max_value=None, colors=None, unit="", label_size=17):
    x, y, width, height = box
    max_value = max_value or max(values) * 1.12
    left, right, top, bottom = 82, 18, 16, 88
    px, py = x + left, y + top
    pw, ph = width - left - right, height - top - bottom
    for tick in ticks(max_value):
        yy = py + ph - (tick / max_value) * ph
        svg.line(px, yy, px + pw, yy, stroke=GRID, width=1)
        svg.text(px - 12, yy + 6, f"{tick:.0f}", 15, anchor="end", fill=MUTED)
    svg.line(px, py, px, py + ph, stroke=INK, width=2)
    svg.line(px, py + ph, px + pw, py + ph, stroke=INK, width=2)
    slot = pw / len(values)
    bar_width = slot * 0.58
    for index, (label, value) in enumerate(zip(labels, values)):
        bar_height = (value / max_value) * ph
        bx = px + index * slot + (slot - bar_width) / 2
        by = py + ph - bar_height
        color = colors[index] if colors else BLUE
        svg.rect(bx, by, bar_width, bar_height, fill=color, radius=5)
        svg.text(bx + bar_width / 2, by - 8, f"{value:.1f}{unit}", 15, anchor="middle", weight="700", fill=color)
        svg.text(bx + bar_width / 2, py + ph + 27, label, label_size, anchor="middle", fill=MUTED)
    return px, py, pw, ph


def line_chart(svg, box, x_values, series, *, y_max=None, y_unit="", x_label="", y_label="", legend="right"):
    x, y, width, height = box
    left, right, top, bottom = 82, 28, 24, 75
    px, py = x + left, y + top
    pw, ph = width - left - right, height - top - bottom
    y_max = y_max or max(max(values) for _, values, _ in series) * 1.12
    for tick in ticks(y_max):
        yy = py + ph - (tick / y_max) * ph
        svg.line(px, yy, px + pw, yy, stroke=GRID, width=1)
        tick_label = f"{tick:.1f}" if y_max < 10 else f"{tick:.0f}"
        svg.text(px - 12, yy + 6, tick_label, 15, anchor="end", fill=MUTED)
    svg.line(px, py, px, py + ph, stroke=INK, width=2)
    svg.line(px, py + ph, px + pw, py + ph, stroke=INK, width=2)
    x_min, x_max = min(x_values), max(x_values)
    x_pos = lambda value: px + ((value - x_min) / (x_max - x_min or 1)) * pw
    y_pos = lambda value: py + ph - (value / y_max) * ph
    for value in x_values:
        svg.text(x_pos(value), py + ph + 29, value, 16, anchor="middle", fill=MUTED)
    for name, values, color in series:
        points = [(x_pos(xv), y_pos(yv)) for xv, yv in zip(x_values, values)]
        svg.polyline(points, stroke=color)
        for point_x, point_y in points:
            svg.circle(point_x, point_y, 6, fill=color)
        legend_x = px + 24 if legend == "left" else px + pw - 175
        legend_y = py + 18 + 27 * series.index((name, values, color))
        svg.line(legend_x, legend_y - 6, legend_x + 28, legend_y - 6, stroke=color, width=4)
        svg.text(legend_x + 38, legend_y, name, 16, fill=color, weight="700")
    if x_label:
        svg.text(px + pw / 2, y + height - 12, x_label, 17, anchor="middle", fill=MUTED)
    if y_label:
        svg.text(x + 20, py + ph / 2, f"{y_label} {y_unit}".strip(), 17, anchor="middle", fill=MUTED, rotate=-90)


def performance_figure(live, physical, saturation, multiwallet):
    svg = Svg("Measured live-chain performance and saturation")
    svg.text(70, 62, "Measured Live-Chain Performance and Saturation", 36, weight="700")
    svg.text(70, 96, "Fabric reads, FISCO contract reads, SQLite persistence, and FISCO receipt anchoring are all live.", 20, fill=MUTED)

    svg.panel(55, 125, 930, 335, "A", "Live dual-chain end-to-end latency", "600 measured queries; p95 by scenario (ms)")
    live_keys = ["normal", "fabric_endpoint_retry", "fisco_endpoint_retry", "semantic_service_timeout", "fabric_endpoint_exhausted", "semantic_disagreement"]
    labels = ["Normal", "Fab retry", "FISCO retry", "Svc timeout", "Fab exhausted", "Disagree"]
    values = [live["byScenario"][key]["totalLatencyMs"]["p95"] for key in live_keys]
    bar_chart(svg, (75, 210, 890, 230), labels, values, max_value=700, colors=[BLUE, CYAN, CYAN, ORANGE, RED, PURPLE], label_size=14)

    svg.panel(1015, 125, 530, 335, "B", "Physical node pause", "40 queries; fallback endpoint p95 (ms)")
    values = [physical["byScenario"][key]["p95Ms"] for key in ["fabric_peer_paused", "fisco_node_paused"]]
    bar_chart(svg, (1035, 210, 490, 230), ["Fabric peer", "FISCO node"], values, max_value=7000, colors=[BLUE, ORANGE])

    svg.panel(55, 495, 1490, 345, "C", "Single- versus four-wallet saturation", "600 measured queries; three runs per concurrency and strategy")
    rows = saturation["rows"]
    multi_rows = multiwallet["rows"]
    conc = [row["concurrency"] for row in rows]
    throughput = [row["throughput"] for row in rows]
    multi_throughput = [row["throughput"] for row in multi_rows]
    latency = [row["p95Ms"] for row in rows]
    multi_latency = [row["p95Ms"] for row in multi_rows]
    line_chart(svg, (85, 580, 710, 230), conc, [
        ("Single wallet", throughput, ORANGE),
        ("Four wallets", multi_throughput, BLUE),
    ], y_max=8, x_label="Concurrent live queries", y_label="Throughput (query/s)", legend="left")
    line_chart(svg, (820, 580, 690, 230), conc, [
        ("Single wallet", latency, ORANGE),
        ("Four wallets", multi_latency, BLUE),
    ], y_max=9000, x_label="Concurrent live queries", y_label="p95 latency (ms)", legend="left")
    return svg.finish()


def mechanism_figure(extended):
    svg = Svg("DAG scaling and mechanism ablation")
    svg.text(70, 62, "Controlled DAG Scaling and Mechanism Ablation", 36, weight="700")
    svg.text(70, 96, "All panels use deterministic local fixtures or a seeded exploratory fault model.", 20, fill=MUTED)

    svg.panel(55, 125, 930, 335, "A", "DAG shape and critical path", "p95 latency at 4 KiB evidence payload (2,700 total DAG executions)")
    rows = [row for row in extended["dagShape"] if row["evidenceBytes"] == 4096]
    nodes = [16, 32, 64]
    series = []
    for shape, color in [("wide", BLUE), ("balanced", GREEN), ("deep", ORANGE)]:
        values = [next(row["p95"] for row in rows if row["shape"] == shape and row["nodeCount"] == node) for node in nodes]
        series.append((shape.title(), values, color))
    line_chart(svg, (80, 205, 875, 235), nodes, series, y_max=100, x_label="DAG nodes", y_label="p95 latency", y_unit="(ms)")

    svg.panel(1015, 125, 530, 335, "B", "Cache ablation", "100 queries per condition")
    cache = extended["cacheAblation"]
    bar_chart(svg, (1040, 210, 475, 225), ["Disabled", "Enabled"], [row["p95"] for row in cache], max_value=6, colors=[RED, GREEN], unit=" ms")

    svg.panel(55, 495, 710, 345, "C", "Bounded retry", "Recoverable endpoint fault; 100 queries per condition")
    retry = extended["retryAblation"]
    bar_chart(svg, (80, 585, 655, 225), ["Disabled", "Enabled"], [100 * row["querySuccessRate"] for row in retry], max_value=110, colors=[RED, GREEN], unit="%")

    svg.panel(795, 495, 750, 345, "D", "Exploratory service scheduling", "1,000 seeded tasks per strategy; common fault samples")
    service = extended["serviceSchedulingAblation"]
    labels = ["Fixed", "Reliability", "Load+diversity"]
    availability = [100 * row["availabilityRate"] for row in service]
    bar_chart(svg, (820, 585, 695, 225), labels, availability, max_value=105, colors=[RED, ORANGE, GREEN], unit="%", label_size=15)
    svg.text(1170, 820, "Max provider share: 100%, 100%, 28%", 17, anchor="middle", fill=MUTED)
    return svg.finish()


def audit_figure(historical, v2, live_audits):
    svg = Svg("Independent audit verification and receipt binding coverage")
    svg.text(70, 62, "Independent Audit Verification and Binding Coverage", 36, weight="700")
    svg.text(70, 96, "Python verifier independently reconstructs normalized SQLite receipts and injects four mutation classes.", 20, fill=MUTED)

    old_live, old_physical = historical["results"]
    new = v2["results"][0]
    live_results = [row for report in live_audits for row in report["results"]]
    svg.panel(55, 135, 720, 650, "A", "Independent reconstruction", "Historical v1, live v2, and controlled local v2 receipts")
    historical_total = old_live["queries"] + old_physical["queries"]
    live_total = sum(row["queries"] for row in live_results)
    live_rebuilt = sum(row["cleanReconstruction"] for row in live_results)
    live_matched = sum(row["anchorMatch"] for row in live_results)
    groups = [
        ("Historical v1", historical_total,
         old_live["cleanReconstruction"] + old_physical["cleanReconstruction"],
         old_live["anchorMatch"] + old_physical["anchorMatch"]),
        ("Live dual-chain v2", live_total, live_rebuilt, live_matched),
        ("Controlled local v2", new["queries"], new["cleanReconstruction"], new["anchorMatch"]),
    ]
    start_y = 270
    for index, (label, total, rebuilt, matched) in enumerate(groups):
        yy = start_y + index * 105
        svg.text(90, yy, label, 20, weight="700")
        svg.rect(285, yy - 27, 405, 32, fill="#e8eef5", radius=8)
        svg.rect(285, yy - 27, 405 * rebuilt / total, 32, fill=BLUE, radius=8)
        svg.text(487, yy - 4, f"{rebuilt}/{total} reconstructed", 16, anchor="middle", fill="#ffffff", weight="700")
        svg.text(285, yy + 32, f"Anchor/root match: {matched}/{total}", 15, fill=MUTED)
    svg.text(90, 735, "Four mutation classes: 100% detected and localized", 18, weight="700", fill=GREEN)

    svg.panel(805, 135, 740, 650, "B", "Leaf-level binding coverage", "Historical limitation is disclosed; live v2 adds explicit nodeId bindings")
    historical_rate = 100 * (
        old_live["bindingCoverage"]["coveredEvidenceNodes"] + old_physical["bindingCoverage"]["coveredEvidenceNodes"]
    ) / (
        old_live["bindingCoverage"]["successfulEvidenceNodes"] + old_physical["bindingCoverage"]["successfulEvidenceNodes"]
    )
    values = [historical_rate, 0, 100, 100]
    bar_chart(svg, (830, 250, 680, 455), ["v1 evidence", "v1 service", "live v2 evidence", "live v2 service"], values, max_value=110, colors=[ORANGE, RED, GREEN, GREEN], unit="%", label_size=14)
    svg.text(1170, 760, "v1 roots remain verifiable; live v2 restores explicit leaf attribution.", 18, anchor="middle", fill=MUTED)
    return svg.finish()


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    live = json.loads(LIVE.read_text(encoding="utf-8"))
    physical = json.loads(PHYSICAL.read_text(encoding="utf-8"))
    extended = json.loads(EXTENDED.read_text(encoding="utf-8"))
    historical = json.loads(HISTORICAL_AUDIT.read_text(encoding="utf-8"))
    v2 = json.loads(V2_AUDIT.read_text(encoding="utf-8"))
    saturation = json.loads(SATURATION.read_text(encoding="utf-8"))
    saturation_audit = json.loads(SATURATION_AUDIT.read_text(encoding="utf-8"))
    regulatory = json.loads(REGULATORY.read_text(encoding="utf-8"))
    regulatory_audit = json.loads(REGULATORY_AUDIT.read_text(encoding="utf-8"))
    resilience_audit = json.loads(RESILIENCE_AUDIT.read_text(encoding="utf-8"))
    material_outage_audit = json.loads(MATERIAL_OUTAGE_AUDIT.read_text(encoding="utf-8"))
    multiwallet = json.loads(MULTIWALLET.read_text(encoding="utf-8"))
    multiwallet_audit = json.loads(MULTIWALLET_AUDIT.read_text(encoding="utf-8"))
    outputs = {
        "5_figure_performance_scalability.svg": performance_figure(live, physical, saturation, multiwallet),
        "6_figure_dag_mechanism_ablation.svg": mechanism_figure(extended),
        "7_figure_independent_audit_binding.svg": audit_figure(
            historical, v2, [
                saturation_audit,
                regulatory_audit,
                resilience_audit,
                material_outage_audit,
                multiwallet_audit,
            ]
        ),
    }
    for name, content in outputs.items():
        path = FIG / name
        path.write_text(content, encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
