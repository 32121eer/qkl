const {
    runHeterogeneityAblation,
    runVrfRotationAblation,
    runCommitRevealAblation,
    vrfSelect
} = require('../../../demo/experiments/ablation_experiment');
const { organizationLimit } = require('../../../demo/negotiation/protocol_config');
const { SeededRng } = require('../../../demo/experiments/ma3c_wbft_simulator');

describe('P1 mechanism ablations (each pillar ON/OFF in its threat regime)', () => {
    test('heterogeneity is load-bearing under correlated honest errors', () => {
        // Same marginal honest error; only the correlation ρ differs. The harm of
        // correlation is the tail where the WHOLE committee errs together and
        // crosses θ → a correlated false-accept. Independent (ON, low ρ) errors
        // almost never align, so false-accept stays near zero; correlated (OFF,
        // high ρ) spikes it. (The residual OBSERVE in the ON case is what
        // arbitration resolves in the full protocol — out of scope for this
        // isolated ablation.)
        const r = runHeterogeneityAblation({ seeds: 80, tasksPerSeed: 40 });
        expect(r.on.falseAccept.mean).toBeLessThan(r.off.falseAccept.mean);
        expect(r.falseAcceptReduction.ciExcludesZero).toBe(true);
        expect(r.falseAcceptReduction.meanDiff).toBeGreaterThan(0);
        expect(r.on.falseAccept.mean).toBeLessThan(0.02);
        expect(r.off.falseAccept.mean).toBeGreaterThan(0.03);
        expect(r.loadBearing).toBe(true);
    });

    test('VRF rotation + org cap neutralizes a co-located colluding bloc', () => {
        // OFF: 5 colluders permanently seat a 7-agent committee → forge-accept.
        // ON: org cap ⌊n/3⌋ caps the bloc to a minority across rotations.
        const r = runVrfRotationAblation({ seeds: 80, tasksPerSeed: 40 });
        expect(r.on.falseAccept.mean).toBeLessThan(r.off.falseAccept.mean);
        expect(r.falseAcceptReduction.ciExcludesZero).toBe(true);
        expect(r.falseAcceptReduction.meanDiff).toBeGreaterThan(0);
        // Rotation should drive false-accept to near zero; static committee suffers.
        expect(r.on.falseAccept.mean).toBeLessThan(0.05);
        expect(r.off.falseAccept.mean).toBeGreaterThan(0.3);
        expect(r.loadBearing).toBe(true);
    });

    test('commit-reveal prevents a malicious-seeded herding cascade', () => {
        const r = runCommitRevealAblation({ seeds: 80, tasksPerSeed: 40 });
        // Sealed commits (ON) keep honest judgment independent; open reveal (OFF)
        // lets honest agents herd onto the early malicious APPROVE.
        expect(r.on.correctness.mean).toBeGreaterThan(r.off.correctness.mean);
        expect(r.falseAcceptReduction.meanDiff).toBeGreaterThan(0);
        expect(r.loadBearing).toBe(true);
    });

    test('vrfSelect honors the per-org cap ⌊n/3⌋', () => {
        const n = 7;
        const cap = organizationLimit(n); // = 2
        const pool = [];
        for (let i = 0; i < 6; i += 1) pool.push({ agentId: `evil-${i}`, org: 'org-evil' });
        for (let i = 0; i < 15; i += 1) pool.push({ agentId: `h-${i}`, org: `org-${i % 5}` });
        const rng = new SeededRng(42);
        for (let trial = 0; trial < 50; trial += 1) {
            const committee = vrfSelect({ pool, n, rng });
            const counts = {};
            for (const a of committee) counts[a.org] = (counts[a.org] || 0) + 1;
            for (const org of Object.keys(counts)) {
                expect(counts[org]).toBeLessThanOrEqual(cap);
            }
        }
    });
});
