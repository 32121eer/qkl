#!/usr/bin/env python3
"""
Figure 5 (fig_ablation): P1 mechanism ablations (paper §VIII.D.3).

Each of the three design pillars is toggled ON/OFF in the SPECIFIC threat regime
it defends, using the production rep×conf weighted-vote aggregation (arbitration
off to isolate each pillar). Two panels: (a) correctness, (b) false-accept.

Data measured by fabric-chaincode/Relayer/scripts/run_ablation_experiments.js
(n=7, 200 seeds x 40 tasks); see demo/experiments/ablation_results.json.
Reproduce: node scripts/run_ablation_experiments.js --seeds=200
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
})

ON_COLOR = "#E76F51"    # coral — mechanism ON (ours)
OFF_COLOR = "#8C8C8C"   # gray — mechanism removed
FIG_FULL = (6.75, 2.9)

# Pillar / threat it defends. Measured ON vs OFF.
pillars = [
    "Heterogeneity\n(correlated error)",
    "VRF rotation\n(co-located collusion)",
    "Commit-reveal\n(herding cascade)",
]
correctness_on  = [86.5, 78.1, 89.9]
correctness_off = [87.5, 50.0, 68.1]
false_accept_on  = [0.2, 0.2, 0.1]
false_accept_off = [5.6, 50.0, 23.6]

x = np.arange(len(pillars))
w = 0.36

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=FIG_FULL)

def grouped(ax, on, off, ylabel, title, ymax):
    b_on = ax.bar(x - w / 2, on, w, label="ON (enabled)", color=ON_COLOR,
                  edgecolor="white", linewidth=0.6, zorder=3)
    b_off = ax.bar(x + w / 2, off, w, label="OFF (removed)", color=OFF_COLOR,
                   edgecolor="white", linewidth=0.6, zorder=3)
    for bars in (b_on, b_off):
        for bar in bars:
            v = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, v + ymax * 0.012,
                    f"{v:.1f}", ha="center", va="bottom", fontsize=7, color="#444")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_xticks(x)
    ax.set_xticklabels(pillars, fontsize=7.6)
    ax.set_ylim(0, ymax)

grouped(ax1, correctness_on, correctness_off,
        "Query correctness (%)", "(a) Correctness", 108)
ax1.legend(loc="lower right")
grouped(ax2, false_accept_on, false_accept_off,
        "False-accept rate (%)", "(b) Forged-evidence acceptance", 58)
ax2.legend(loc="upper left")

fig.suptitle("P1 mechanism ablations: each pillar ON/OFF in its threat regime",
             fontsize=9, y=1.03, color="#555")
fig.tight_layout()
fig.savefig("fig_ablation.pdf")
fig.savefig("fig_ablation.png", dpi=300)
print("wrote fig_ablation.{pdf,png}")
