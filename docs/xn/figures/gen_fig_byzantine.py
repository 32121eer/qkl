#!/usr/bin/env python3
"""
Publication figures for the MA3C cross-chain verification paper (§VIII).

Fig 1 (fig_real_agent_byzantine): REAL-agent Byzantine robustness — correctness
       and false-accept vs malicious ratio. Data from run_real_agent_experiment.js
       (n=5, always-approve forge-accept attack, 30 trials x 10 tasks).

Fig 2 (fig_sim_semantic): simulation with probabilistic honest error (paper §VIII
       D.2) — correctness & false-accept at 40% malicious. Data from
       run_comparative_experiments.js (n=5, honestErr=0.12, with arbitration).

All numbers are measured; reproduce with the scripts above.
"""
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["Times New Roman", "DejaVu Serif"],
    "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.labelsize": 10, "legend.fontsize": 8.5, "legend.frameon": False,
    "figure.dpi": 300, "savefig.dpi": 300, "savefig.bbox": "tight",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.alpha": 0.15, "grid.linestyle": "-",
    "lines.linewidth": 1.9, "lines.markersize": 6,
})

OUR_COLOR = "#E76F51"      # coral — MA3C (ours)
EQUAL_COLOR = "#2A9D8F"    # teal — equal majority / PBFT
RELAY_COLOR = "#8C8C8C"    # gray — single relay
FIG_FULL = (6.75, 2.8)

# ---------------------------------------------------------------------------
# Figure 1: real-agent Byzantine robustness (two panels)
# ---------------------------------------------------------------------------
malicious = np.array([0, 20, 40, 60])
# equal majority and PBFT are identical in this deterministic regime → one series.
corr = {
    "MA3C (ours)":            [100, 100, 100, 100],
    "Equal majority / PBFT":  [100, 100, 100, 50],
    "Single relay":           [100, 90, 80, 70],
}
fa = {
    "MA3C (ours)":            [0, 0, 0, 0],
    "Equal majority / PBFT":  [0, 0, 0, 50],
    "Single relay":           [0, 10, 20, 30],
}
styles = {
    "MA3C (ours)":           dict(color=OUR_COLOR, marker="o", zorder=5, linewidth=2.4),
    "Equal majority / PBFT": dict(color=EQUAL_COLOR, marker="s", linestyle="--", zorder=4),
    "Single relay":          dict(color=RELAY_COLOR, marker="^", linestyle=":", zorder=3),
}

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=FIG_FULL)
for name in corr:
    ax1.plot(malicious, corr[name], label=name, **styles[name])
ax1.axvline(50, color="#BBBBBB", lw=0.9, ls="-", zorder=1)
ax1.text(50.5, 40, "Byzantine\nmajority", fontsize=7, color="#888", va="center")
ax1.set_xlabel("Byzantine agents (%)")
ax1.set_ylabel("Query correctness (%)")
ax1.set_title("(a) Correctness")
ax1.set_ylim(40, 104)
ax1.set_xticks(malicious)
ax1.legend(loc="lower left")

for name in fa:
    ax2.plot(malicious, fa[name], label=name, **styles[name])
ax2.axvline(50, color="#BBBBBB", lw=0.9, ls="-", zorder=1)
ax2.set_xlabel("Byzantine agents (%)")
ax2.set_ylabel("False-accept rate (%)")
ax2.set_title("(b) Forged-evidence acceptance")
ax2.set_ylim(-2, 54)
ax2.set_xticks(malicious)
ax2.annotate("equal voting &\nPBFT fooled", xy=(60, 50), xytext=(33, 44),
             fontsize=7, color="#555",
             arrowprops=dict(arrowstyle="->", color="#999", lw=0.8))

fig.tight_layout()
fig.savefig("fig_real_agent_byzantine.pdf")
fig.savefig("fig_real_agent_byzantine.png", dpi=300)
print("wrote fig_real_agent_byzantine.{pdf,png}")

# ---------------------------------------------------------------------------
# Figure 2: simulation with probabilistic honest error (40% malicious)
# ---------------------------------------------------------------------------
methods = ["MA3C\n(ours)", "Equal\nmajority", "PBFT", "Single\nrelay"]
correctness = [95.9, 67.8, 67.8, 52.5]
false_accept = [1.8, 16.3, 16.3, 23.8]
bar_colors = [OUR_COLOR, EQUAL_COLOR, EQUAL_COLOR, RELAY_COLOR]

fig2, (bx1, bx2) = plt.subplots(1, 2, figsize=FIG_FULL)
x = np.arange(len(methods))

b1 = bx1.bar(x, correctness, width=0.62, color=bar_colors,
             edgecolor="white", linewidth=0.6)
for bar, v in zip(b1, correctness):
    bx1.text(bar.get_x() + bar.get_width()/2, v + 1.2, f"{v:.1f}",
             ha="center", va="bottom", fontsize=7.5, color="#444")
bx1.set_ylabel("Query correctness (%)")
bx1.set_title("(a) Correctness")
bx1.set_xticks(x); bx1.set_xticklabels(methods)
bx1.set_ylim(0, 108)

b2 = bx2.bar(x, false_accept, width=0.62, color=bar_colors,
             edgecolor="white", linewidth=0.6)
for bar, v in zip(b2, false_accept):
    bx2.text(bar.get_x() + bar.get_width()/2, v + 0.4, f"{v:.1f}",
             ha="center", va="bottom", fontsize=7.5, color="#444")
bx2.set_ylabel("False-accept rate (%)")
bx2.set_title("(b) Forged-evidence acceptance")
bx2.set_xticks(x); bx2.set_xticklabels(methods)
bx2.set_ylim(0, 27)

fig2.suptitle("Simulation: 40% Byzantine, probabilistic semantic layer",
              fontsize=9, y=1.02, color="#555")
fig2.tight_layout()
fig2.savefig("fig_sim_semantic.pdf")
fig2.savefig("fig_sim_semantic.png", dpi=300)
print("wrote fig_sim_semantic.{pdf,png}")
