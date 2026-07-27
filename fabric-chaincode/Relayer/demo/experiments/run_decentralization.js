/**
 * Experiment 5.5 — Decentralization / concentration risk (paper §VIII).
 *
 * Answers the reviewer question: does the mechanism merely move centralization
 * from a single relay to an agent committee? We drive the PRODUCTION
 * `CommitteeSelector` (reputation-weighted VRF + ⌊n/3⌋ organization cap) over many
 * tasks and measure how concentrated the selected committees are, under three
 * regimes:
 *
 *   withOrgCap   — production: per-task VRF reselection + organization cap.
 *   noOrgCap     — same VRF reselection but the organization cap removed.
 *   staticNotary — B5 foil: one fixed committee reused for every task (no rotation).
 *
 * Metrics (instruction §5.5):
 *   meanMaxOrgShare      mean over tasks of the largest single-organization seat share.
 *   meanMaxProviderShare same for LLM model/provider (correlated-failure surface).
 *   pMalOrgMajority      P(the malicious organization holds ≥ ⌈n/2⌉ seats → can force accept).
 *   selectionHHI/Gini    concentration of how often each agent is seated across all tasks
 *                        (lower = more agents share duty = more decentralized).
 *   highRepSeatShare     mean seat share taken by the top-reputation quartile
 *                        (monopolization of duty by a few high-rep agents).
 *
 * No verification is run here — this isolates the SELECTION layer. Reproduce:
 *   node demo/experiments/run_decentralization.js [--tasks=4000] [--n=7]
 */

const { ReputationStore } = require('../negotiation/reputation_store');
const { CommitteeSelector } = require('../negotiation/committee_selector');
const { buildProtocolParams } = require('../negotiation/protocol_config');

const fs = require('fs');
const path = require('path');

const ORGS = ['org-a', 'org-b', 'org-c', 'org-d', 'org-e', 'org-f', 'org-g', 'org-h'];
const PROVIDERS = ['openai', 'anthropic', 'ollama-llama', 'qwen', 'mistral'];

class SeededRng {
    constructor(seed = 20260626) { this.state = (Number(seed) >>> 0) || 1; }
    next() { this.state = (1664525 * this.state + 1013904223) >>> 0; return this.state / 0x100000000; }
}
const round6 = (x) => Number((Number(x) || 0).toFixed(6));

/**
 * Pool: a malicious organization `org-mal` controlling `malAgents` agents, plus
 * org/provider-diverse honest agents. Reputation is heterogeneous (a high-rep
 * minority), seeded into the store so the VRF is reputation-weighted.
 */
function buildPool({ poolSize, malAgents, seed }) {
    const rng = new SeededRng(seed);
    const agents = [];
    const providerOf = {};
    const repOf = {};

    for (let i = 0; i < malAgents; i += 1) {
        const id = `mal-${String(i + 1).padStart(2, '0')}`;
        // Strategic adversary: the malicious org's agents have ACCRUED HIGH
        // reputation (§III-B threat 8) and share one LLM provider (collusion +
        // correlated backend). Without the org cap their weight would seize the
        // committee; the cap is what limits them to a minority.
        agents.push({ agentId: id, organization: 'org-mal' });
        providerOf[id] = 'ollama-llama';
        repOf[id] = round6(0.85 + rng.next() * 0.13);
    }
    for (let i = 0; i < poolSize - malAgents; i += 1) {
        const id = `hon-${String(i + 1).padStart(2, '0')}`;
        agents.push({ agentId: id, organization: ORGS[i % ORGS.length] });
        providerOf[id] = PROVIDERS[i % PROVIDERS.length];
        // Honest agents span a moderate band so VRF genuinely rotates among
        // comparably-reputed peers (a small high-rep quartile aside).
        repOf[id] = round6(i % 4 === 0 ? 0.7 + rng.next() * 0.2 : 0.45 + rng.next() * 0.3);
    }
    return { agents, providerOf, repOf };
}

function seedStore(agents, repOf) {
    const store = new ReputationStore({});
    store.ensure(agents.map((a) => a.agentId));
    const snaps = {};
    for (const a of agents) {
        const r = repOf[a.agentId];
        snaps[a.agentId] = { agentId: a.agentId, weight: r, reputation: r, qualityScore: r, trustScore: r, latencyScore: 0.5 };
    }
    store.importSnapshots(snaps);
    return store;
}

function topRepQuartile(repOf) {
    const sorted = Object.entries(repOf).sort((a, b) => b[1] - a[1]);
    const k = Math.max(1, Math.round(sorted.length * 0.25));
    return new Set(sorted.slice(0, k).map(([id]) => id));
}

/** Largest single-key share among committee members keyed by `keyFn`. */
function maxShare(committee, keyFn) {
    const counts = {};
    for (const m of committee) {
        const k = keyFn(m);
        counts[k] = (counts[k] || 0) + 1;
    }
    return Math.max(...Object.values(counts)) / committee.length;
}

function hhiGini(freq) {
    const all = Object.values(freq);                 // ALL pool agents (incl. never-selected = 0)
    const total = all.reduce((s, c) => s + c, 0);
    if (!total) return { hhi: 0, gini: 0 };
    // HHI over the agents that actually share selection duty (standard market-share HHI):
    // 1/d for an even split among d agents, → 1 when one agent monopolizes.
    const nonzero = all.filter((c) => c > 0);
    const hhi = nonzero.reduce((s, c) => s + (c / total) * (c / total), 0);
    // Gini over the WHOLE pool (idle agents count as 0 → higher inequality).
    const sorted = all.slice().sort((a, b) => a - b);
    const nPool = sorted.length;
    let cum = 0;
    let lorenz = 0;
    for (let i = 0; i < nPool; i += 1) {
        cum += sorted[i];
        lorenz += cum;
    }
    const gini = (nPool + 1 - (2 * lorenz) / total) / nPool;
    return { hhi: round6(hhi), gini: round6(gini) };
}

function runRegime({ regime, pool, n, tasks, seed }) {
    const { agents, providerOf, repOf } = pool;
    const store = seedStore(agents, repOf);
    const selector = new CommitteeSelector({ reputationStore: store, targetCommitteeSize: n });
    const baseParams = buildProtocolParams('CRITICAL');
    const orgLimit = regime === 'noOrgCap' ? n : (baseParams.organizationLimit || Math.floor(n / 3));
    const highRep = topRepQuartile(repOf);
    const majority = Math.ceil(n / 2);

    // staticNotary: pick ONE committee (top-score VRF for a fixed seed) and reuse it.
    let fixed = null;
    if (regime === 'staticNotary') {
        const res = selector.select({
            agents, committeeSize: n,
            task: { id: 'static-fixed', risk: 'CRITICAL' },
            protocolParams: { ...baseParams, groupSize: n, organizationLimit: orgLimit }
        });
        fixed = res.selected;
    }

    const selFreq = {};
    for (const a of agents) selFreq[a.agentId] = 0;
    let maxOrgAccum = 0;
    let maxProvAccum = 0;
    let malMajority = 0;
    let highRepSeatsAccum = 0;

    for (let t = 0; t < tasks; t += 1) {
        let committee;
        if (regime === 'staticNotary') {
            committee = fixed;
        } else {
            const res = selector.select({
                agents, committeeSize: n,
                task: { taskId: `task-${seed}-${t}`, queryId: `q-${t}`, risk: 'CRITICAL' },
                protocolParams: { ...baseParams, groupSize: n, organizationLimit: orgLimit }
            });
            committee = res.selected;
        }

        maxOrgAccum += maxShare(committee, (m) => m.organization || 'unknown');
        maxProvAccum += maxShare(committee, (m) => providerOf[m.agentId] || 'unknown');
        const malSeats = committee.filter((m) => m.organization === 'org-mal').length;
        if (malSeats >= majority) malMajority += 1;
        highRepSeatsAccum += committee.filter((m) => highRep.has(m.agentId)).length / committee.length;
        for (const m of committee) selFreq[m.agentId] += 1;
    }

    const { hhi, gini } = hhiGini(selFreq);
    return {
        regime,
        organizationLimit: orgLimit,
        meanMaxOrgShare: round6(maxOrgAccum / tasks),
        meanMaxProviderShare: round6(maxProvAccum / tasks),
        pMalOrgMajority: round6(malMajority / tasks),
        selectionHHI: hhi,
        selectionGini: gini,
        highRepSeatShare: round6(highRepSeatsAccum / tasks)
    };
}

function main() {
    const argv = Object.fromEntries(process.argv.slice(2).map((s) => {
        const [k, v] = s.replace(/^--/, '').split('=');
        return [k, v ?? true];
    }));
    const n = Number(argv.n) || 7;
    const tasks = Number(argv.tasks) || 4000;
    const poolSize = Number(argv.pool) || 24;
    const malAgents = Number(argv.mal) || 6; // a sizeable malicious org (25% of pool)
    const seed = Number(argv.seed) || 20260626;

    const pool = buildPool({ poolSize, malAgents, seed });
    const regimes = ['withOrgCap', 'noOrgCap', 'staticNotary'];
    const results = {};
    for (const regime of regimes) {
        results[regime] = runRegime({ regime, pool, n, tasks, seed });
    }

    const out = {
        experiment: '5.5-decentralization-concentration',
        config: { n, tasks, poolSize, malAgents, providers: PROVIDERS.length, seed },
        regimes: results,
        meta: { generatedAt: new Date().toISOString() }
    };
    const outPath = path.join(__dirname, 'decentralization_results.json');
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

    process.stdout.write(`\nExperiment 5.5 — decentralization / concentration ` +
        `(n=${n}, pool=${poolSize}, malOrg=${malAgents}, tasks=${tasks})\n`);
    const cols = ['regime', 'maxOrgShare', 'maxProvShare', 'P(malMaj)', 'HHI', 'Gini', 'highRepShare'];
    process.stdout.write(cols.map((c, i) => c.padEnd(i === 0 ? 14 : 13)).join('') + '\n');
    for (const regime of regimes) {
        const r = results[regime];
        process.stdout.write(
            regime.padEnd(14) +
            String(r.meanMaxOrgShare).padEnd(13) +
            String(r.meanMaxProviderShare).padEnd(13) +
            String(r.pMalOrgMajority).padEnd(13) +
            String(r.selectionHHI).padEnd(13) +
            String(r.selectionGini).padEnd(13) +
            String(r.highRepSeatShare) + '\n'
        );
    }
    process.stdout.write(`\nwrote ${path.relative(process.cwd(), outPath)}\n`);
}

if (require.main === module) main();

module.exports = { buildPool, runRegime };
