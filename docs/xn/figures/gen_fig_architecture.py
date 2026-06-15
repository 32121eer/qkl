#!/usr/bin/env python3
"""
System architecture figure for the MA3C cross-chain verification paper (§III).

Three layered bands: Target Chain (FISCO-BCOS) hosting the Coordination Contract,
the Agent Pool (collectors / heterogeneous verifiers A-B-C / arbiters), and the
Source Chain (Hyperledger Fabric). Arrows show the verification data flow.

Pure matplotlib (no API key / network needed). Outputs PDF (vector) + PNG.
"""
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["Times New Roman", "DejaVu Serif"],
    "font.size": 9, "figure.dpi": 300, "savefig.dpi": 300, "savefig.bbox": "tight",
})

# Ocean Dusk palette
C_TARGET, C_TARGET_BG = "#2A9D8F", "#E3EFEF"
C_AGENT, C_AGENT_BG = "#E9C46A", "#F7F1E6"
C_SOURCE, C_SOURCE_BG = "#264653", "#E6EEF2"
C_OURS = "#E76F51"   # coordination contract = core contribution
C_ARB = "#F4A261"    # arbiter committee
INK = "#2C2C2C"

fig, ax = plt.subplots(figsize=(6.9, 4.6))
ax.set_xlim(0, 12)
ax.set_ylim(0, 10)
ax.axis("off")


def band(x, y, w, h, color, label):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.04,rounding_size=0.18",
                                linewidth=1.1, edgecolor=color, facecolor=color, alpha=0.13, zorder=1))
    ax.text(x + 0.18, y + h - 0.28, label, fontsize=8.5, color=color, fontweight="bold",
            va="top", ha="left", zorder=4)


def box(x, y, w, h, text, edge, face="white", fontsize=8, weight="normal", lw=1.3, text_color=INK, z=3):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.03,rounding_size=0.12",
                                linewidth=lw, edgecolor=edge, facecolor=face, zorder=z))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fontsize,
            color=text_color, fontweight=weight, zorder=z + 1)


def arrow(p0, p1, color=INK, style="-|>", lw=1.4, rad=0.0, ls="-", z=2):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle=style, mutation_scale=12, lw=lw,
                                 color=color, connectionstyle=f"arc3,rad={rad}", linestyle=ls, zorder=z))


def elabel(x, y, text, color="#555"):
    ax.text(x, y, text, ha="center", va="center", fontsize=6.8, color=color, style="italic",
            bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85), zorder=5)


# --- Bands ---
band(0.4, 7.7, 11.2, 2.0, C_TARGET, "Target Chain — FISCO-BCOS (PBFT)")
band(0.4, 3.3, 11.2, 3.7, C_AGENT, "Agent Pool (multi-organization)")
band(0.4, 0.3, 11.2, 2.2, C_SOURCE, "Source Chain — Hyperledger Fabric (Raft)")

# --- Target chain contents ---
box(1.0, 8.05, 5.6, 1.15,
    "Coordination Contract\n(task lifecycle · VRF selection ·\nrep×conf weighted consensus · reputation)",
    C_OURS, face="#FCEEE9", fontsize=7.6, weight="bold", lw=1.8)
box(8.0, 8.2, 3.2, 0.85, "Query consumer\n(Light-client verified)", C_TARGET, fontsize=7.6)

# --- Agent pool contents ---
box(0.9, 3.95, 2.5, 2.4, "Collector Agents\n(×2, distinct orgs)\n\nfetch & normalize\nevidence", C_AGENT, fontsize=7.4)
box(3.95, 3.7, 4.0, 2.9,
    "Verifier Committee\n(VRF-selected, heterogeneous)\n\n"
    "Type A — proof validator\nType B — policy checker\nType C — semantic reasoner\n\n"
    "commit–reveal sealed judgments",
    C_OURS, face="#FCEEE9", fontsize=7.4, weight="normal", lw=1.7)
box(8.5, 3.95, 2.7, 2.4, "Arbiter Committee\n(k high-reputation,\nmulti-strategy)\n\nescalation path", C_ARB, fontsize=7.4)

# --- Source chain contents ---
box(1.0, 0.7, 6.2, 1.25,
    "gateway_cc  —  evidence bundle:\nread-write set · endorsement signatures · block header",
    C_SOURCE, fontsize=7.6)
box(8.2, 0.7, 3.0, 1.25, "Deterministic\nfinality", C_SOURCE, fontsize=7.6)

# --- Arrows / data flow ---
# query -> task (top), CONFIRMED result -> consumer (bottom): parallel, separated
arrow((8.0, 8.92), (6.65, 8.92), color=C_TARGET, rad=0.0)
elabel(7.32, 9.33, "query")
# contract -> verifier committee (VRF select)
arrow((4.2, 8.05), (5.6, 6.6), color=C_OURS, rad=0.12)
elabel(3.7, 7.35, "VRF select")
# verifiers -> contract (judgments up)
arrow((6.4, 6.6), (5.2, 8.05), color=C_OURS, rad=0.12, ls=(0, (4, 2)))
elabel(6.9, 7.35, "judgments")
# collectors <-> source
arrow((2.1, 3.95), (2.1, 1.95), color=C_SOURCE, rad=0.0)
elabel(1.35, 2.95, "query")
arrow((2.7, 1.95), (2.7, 3.95), color=C_SOURCE, rad=0.0, ls=(0, (4, 2)))
elabel(3.45, 2.95, "evidence")
# collectors -> contract (evidence compare)
arrow((1.9, 6.35), (1.9, 8.05), color=C_AGENT, rad=0.0)
elabel(1.9, 7.2, "dual-collector\nevidence", color="#8a6d2b")
# contract -> arbiters (escalation)
arrow((6.6, 8.2), (9.6, 6.35), color="#F4A261", rad=-0.12, ls=(0, (4, 2)))
elabel(8.9, 7.45, "on disagreement")
# arbiters -> contract (verdict)
arrow((9.2, 6.35), (6.6, 8.45), color="#F4A261", rad=0.18, ls=(0, (4, 2)))
elabel(9.9, 8.0, "final verdict", color="#b5651d")
# contract -> consumer (result)
arrow((6.65, 8.45), (8.0, 8.45), color=C_TARGET)
elabel(7.32, 8.18, "CONFIRMED result")

fig.tight_layout()
fig.savefig("fig_architecture.pdf")
fig.savefig("fig_architecture.png", dpi=300)
print("wrote fig_architecture.{pdf,png}")
