const { ReputationStore } = require('../negotiation/reputation_store');
const { DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

class SeededRng {
    constructor(seed = 20260417) {
        this.state = (Number(seed) >>> 0) || 1;
    }

    next() {
        this.state = (1664525 * this.state + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    int(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    pick(list = []) {
        if (!list.length) {
            return null;
        }
        return list[this.int(0, list.length - 1)];
    }
}

function buildAgentPopulation({ n, maliciousRatio = 0, includeNewAgent = false, rng }) {
    const maliciousCount = Math.min(n, Math.max(0, Math.round(n * maliciousRatio)));
    const focusCycle = ['structural', 'balanced', 'proof'];
    const agents = [];
    for (let index = 0; index < n; index += 1) {
        agents.push({
            agentId: `agent-${String(index + 1).padStart(3, '0')}`,
            focus: focusCycle[index % focusCycle.length],
            honest: index >= maliciousCount,
            isNewcomer: false,
            baseLatencyMs: rng.int(20, 120),
            qualityBias: round6(0.8 + rng.next() * 0.18),
            maliciousBias: round6(0.55 + rng.next() * 0.35)
        });
    }

    if (includeNewAgent && agents.length) {
        const newcomer = {
            agentId: 'agent-new-001',
            focus: 'balanced',
            honest: true,
            isNewcomer: true,
            baseLatencyMs: rng.int(18, 60),
            qualityBias: round6(0.9 + rng.next() * 0.08),
            maliciousBias: 0
        };
        agents[agents.length - 1] = newcomer;
    }

    return agents;
}

function buildOpinion({ agent, taskValid, round, assignedWeight, rng, evidenceReady }) {
    const latencyNoise = 0.85 + rng.next() * 0.45;
    const maliciousLatencyFactor = agent.honest ? 1 : 1.5 + rng.next() * 0.75;
    const latencyMs = Math.round(agent.baseLatencyMs * latencyNoise * maliciousLatencyFactor);

    let decision = 'QUESTION';
    let confidence = 0.65;

    if (taskValid) {
        if (agent.honest) {
            if (!evidenceReady && agent.focus !== 'proof') {
                decision = 'QUESTION';
                confidence = 0.66;
            } else {
                decision = 'APPROVE';
                confidence = round6(Math.min(0.99, agent.qualityBias));
            }
        } else {
            decision = rng.next() < 0.75 ? 'REJECT' : 'QUESTION';
            confidence = round6(agent.maliciousBias);
        }
    } else {
        if (agent.honest) {
            if (!evidenceReady && agent.focus === 'balanced') {
                decision = 'QUESTION';
                confidence = 0.62;
            } else {
                decision = 'REJECT';
                confidence = round6(Math.min(0.99, agent.qualityBias));
            }
        } else {
            decision = 'APPROVE';
            confidence = round6(agent.maliciousBias);
        }
    }

    return {
        agentId: agent.agentId,
        decision,
        confidence,
        assignedWeight,
        latencyMs
    };
}

function summarizeWeightedDecision(opinions = [], threshold = DEFAULT_NORMAL_THRESHOLD) {
    const approvedWeight = opinions
        .filter((item) => item.decision === 'APPROVE')
        .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);
    const rejectedWeight = opinions
        .filter((item) => item.decision === 'REJECT')
        .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);
    const questionedWeight = opinions
        .filter((item) => item.decision === 'QUESTION')
        .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);
    const decisiveWeight = approvedWeight + rejectedWeight;
    const acceptRatio = decisiveWeight > 0 ? approvedWeight / decisiveWeight : 0;
    const rejectRatio = decisiveWeight > 0 ? rejectedWeight / decisiveWeight : 0;

    let finalDecision = 'OBSERVE';
    if (acceptRatio >= threshold) {
        finalDecision = 'COMMIT';
    } else if (rejectRatio >= threshold) {
        finalDecision = 'REJECT';
    }

    return {
        finalDecision,
        approvedWeight: round6(approvedWeight),
        rejectedWeight: round6(rejectedWeight),
        questionedWeight: round6(questionedWeight),
        acceptRatio: round6(acceptRatio),
        rejectRatio: round6(rejectRatio),
        thresholdWeight: round6(threshold)
    };
}

function simulateNegotiationTask({
    agents,
    reputationStore,
    rng,
    taskValid = true,
    maxRounds = 3,
    roundOverheadMs = 20,
    evidenceRecoveryMs = 40,
    threshold = DEFAULT_NORMAL_THRESHOLD
}) {
    const agentIds = agents.map((item) => item.agentId);
    reputationStore.ensure(agentIds);

    let elapsedMs = 0;
    let round = 1;
    let finalDecision = 'OBSERVE';
    let lastSummary = null;

    while (round <= maxRounds) {
        const weightMap = reputationStore.ensure(agentIds).reduce((acc, item) => {
            acc[item.agentId] = item.weight;
            return acc;
        }, {});
        const evidenceReady = round > 1;
        const opinions = agents.map((agent) => buildOpinion({
            agent,
            taskValid,
            round,
            assignedWeight: weightMap[agent.agentId] || 0,
            rng,
            evidenceReady
        }));

        // Under heavier Byzantine presence, some honest agents may become uncertain
        // because of partial eclipse / conflicting evidence, especially in round 1.
        const maliciousWeight = opinions
            .filter((item) => {
                const agent = agents.find((candidate) => candidate.agentId === item.agentId);
                return agent && !agent.honest;
            })
            .reduce((sum, item) => sum + (Number(item.assignedWeight) || 0), 0);
        if (maliciousWeight >= 0.22 && round === 1) {
            for (const opinion of opinions) {
                const agent = agents.find((candidate) => candidate.agentId === opinion.agentId);
                if (!agent || !agent.honest) {
                    continue;
                }
                if (agent.focus === 'balanced' && rng.next() < maliciousWeight * 0.8) {
                    opinion.decision = 'QUESTION';
                    opinion.confidence = round6(Math.max(0.45, opinion.confidence - 0.2));
                }
            }
        }
        if (maliciousWeight >= 0.28) {
            for (const opinion of opinions) {
                const agent = agents.find((candidate) => candidate.agentId === opinion.agentId);
                if (!agent || !agent.honest || agent.focus !== 'balanced') {
                    continue;
                }
                if (taskValid && round > 1 && rng.next() < maliciousWeight * 0.18) {
                    opinion.decision = 'QUESTION';
                    opinion.confidence = round6(Math.max(0.42, opinion.confidence - 0.22));
                }
                if (!taskValid && rng.next() < maliciousWeight * 0.12) {
                    opinion.decision = 'APPROVE';
                    opinion.confidence = round6(Math.max(0.4, opinion.confidence - 0.18));
                }
            }
        }

        const maxLatency = opinions.reduce((max, item) => Math.max(max, item.latencyMs), 0);
        elapsedMs += maxLatency + roundOverheadMs;
        lastSummary = summarizeWeightedDecision(opinions, threshold);
        finalDecision = lastSummary.finalDecision;

        reputationStore.updateFromRound(opinions, { finalDecision });

        if (finalDecision !== 'OBSERVE') {
            return {
                elapsedMs,
                rounds: round,
                finalDecision,
                correct: (taskValid && finalDecision === 'COMMIT') || (!taskValid && finalDecision === 'REJECT'),
                summary: lastSummary
            };
        }

        elapsedMs += evidenceRecoveryMs;
        round += 1;
    }

    return {
        elapsedMs,
        rounds: maxRounds,
        finalDecision,
        correct: false,
        summary: lastSummary
    };
}

function average(values = []) {
    if (!values.length) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values = [], ratio = 0.95) {
    if (!values.length) {
        return 0;
    }
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

function runConvergenceBenchmark({
    sizes = [7, 15, 31, 61],
    maliciousRatio = 0.2,
    trials = 40,
    seed = 20260417
} = {}) {
    return sizes.map((n, offset) => {
        const rng = new SeededRng(seed + offset * 97);
        const elapsedValues = [];
        const roundValues = [];

        for (let trial = 0; trial < trials; trial += 1) {
            const reputationStore = new ReputationStore();
            const agents = buildAgentPopulation({ n, maliciousRatio, rng });
            const result = simulateNegotiationTask({
                agents,
                reputationStore,
                rng,
                taskValid: true
            });
            elapsedValues.push(result.elapsedMs);
            roundValues.push(result.rounds);
        }

        return {
            agentCount: n,
            maliciousRatio,
            trials,
            avgConvergenceMs: round6(average(elapsedValues)),
            p95ConvergenceMs: round6(percentile(elapsedValues, 0.95)),
            avgRounds: round6(average(roundValues))
        };
    });
}

function runResilienceBenchmark({
    maliciousRatios = [0.1, 0.2, 0.3],
    n = 15,
    trials = 80,
    seed = 20260417
} = {}) {
    return maliciousRatios.map((maliciousRatio, offset) => {
        const rng = new SeededRng(seed + offset * 131);
        let correctCount = 0;
        let falseAccept = 0;
        let falseReject = 0;

        for (let trial = 0; trial < trials; trial += 1) {
            const taskValid = trial % 2 === 0;
            const reputationStore = new ReputationStore();
            const agents = buildAgentPopulation({ n, maliciousRatio, rng });
            const result = simulateNegotiationTask({
                agents,
                reputationStore,
                rng,
                taskValid
            });
            if (result.correct) {
                correctCount += 1;
            } else if (!taskValid && result.finalDecision === 'COMMIT') {
                falseAccept += 1;
            } else {
                falseReject += 1;
            }
        }

        return {
            agentCount: n,
            maliciousRatio,
            trials,
            correctnessRate: round6(correctCount / trials),
            falseAcceptRate: round6(falseAccept / trials),
            falseRejectRate: round6(falseReject / trials)
        };
    });
}

function computeTopQuartileThreshold(weights = []) {
    if (!weights.length) {
        return 0;
    }
    const sorted = weights.slice().sort((left, right) => right - left);
    const index = Math.max(0, Math.ceil(sorted.length * 0.25) - 1);
    return sorted[index];
}

function runNewAgentEvolutionBenchmark({
    n = 15,
    maliciousRatio = 0.2,
    warmupRounds = 24,
    observeRounds = 40,
    seed = 20260417
} = {}) {
    const rng = new SeededRng(seed);
    const reputationStore = new ReputationStore();
    const baselineAgents = buildAgentPopulation({ n, maliciousRatio, rng });

    for (let round = 0; round < warmupRounds; round += 1) {
        simulateNegotiationTask({
            agents: baselineAgents,
            reputationStore,
            rng,
            taskValid: round % 2 === 0
        });
    }

    const agents = buildAgentPopulation({ n, maliciousRatio, includeNewAgent: true, rng });
    const trajectory = [];
    let roundsToTopQuartile = null;

    for (let round = 1; round <= observeRounds; round += 1) {
        simulateNegotiationTask({
            agents,
            reputationStore,
            rng,
            taskValid: true
        });
        const snapshots = reputationStore.getWeightVector(agents.map((item) => item.agentId));
        const newcomer = snapshots.find((item) => item.agentId === 'agent-new-001');
        const threshold = computeTopQuartileThreshold(snapshots.map((item) => item.weight));
        const entry = {
            round,
            newcomerWeight: round6(newcomer?.weight || 0),
            topQuartileThreshold: round6(threshold)
        };
        trajectory.push(entry);
        if (roundsToTopQuartile === null && entry.newcomerWeight >= entry.topQuartileThreshold) {
            roundsToTopQuartile = round;
        }
    }

    return {
        agentCount: n,
        maliciousRatio,
        warmupRounds,
        observeRounds,
        roundsToTopQuartile,
        finalWeight: trajectory.length ? trajectory[trajectory.length - 1].newcomerWeight : 0,
        trajectory
    };
}

function runAllExperiments(options = {}) {
    return {
        convergence: runConvergenceBenchmark(options.convergence || {}),
        resilience: runResilienceBenchmark(options.resilience || {}),
        newAgentEvolution: runNewAgentEvolutionBenchmark(options.newAgentEvolution || {})
    };
}

module.exports = {
    SeededRng,
    buildAgentPopulation,
    simulateNegotiationTask,
    runConvergenceBenchmark,
    runResilienceBenchmark,
    runNewAgentEvolutionBenchmark,
    runAllExperiments
};
