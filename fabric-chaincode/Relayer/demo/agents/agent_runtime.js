const fs = require('fs');
const path = require('path');
const { AgentRegistry } = require('./agent_registry');
const { VerifierAgent } = require('./verifier_agent');
const { CoordinatorAgent } = require('./coordinator_agent');
const { SubmitterAgent } = require('./submitter_agent');
const { EvidenceAgent } = require('./evidence_agent');
const { ArbitrationAgent } = require('./arbitration_agent');
const { ReputationStore } = require('../negotiation/reputation_store');
const { WeightAllocator } = require('../negotiation/weight_allocator');
const { BehaviorAnalyzer } = require('../negotiation/behavior_analyzer');
const { CommitteeSelector } = require('../negotiation/committee_selector');
const { ArbitrationCommittee } = require('../negotiation/arbitration_committee');
const { sealOpinion } = require('../negotiation/commit_reveal');
const { CommitRevealSession } = require('../negotiation/commit_reveal_session');
const { buildProtocolParams } = require('../negotiation/protocol_config');
const { createRemoteAgents, readRemoteAgentSpecs } = require('./remote_agent_registry');
const { AgentRegistryJsonStore, normalizeAgentRecord } = require('../store/agent_registry_store');
const { AgentDirectory } = require('./agent_directory');

function normalizeRemoteVerifierMode(value) {
    const normalized = String(value || 'append').trim().toLowerCase();
    return normalized === 'replace' ? 'replace' : 'append';
}

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.max(0, Math.min(1, n));
}

class AgentRuntime {
    constructor({
        eventStore,
        remoteAgents = null,
        remoteVerifierMode = null,
        agentRegistryStore = undefined,
        agentRegistryPath = null,
        enableAgentRegistryStore = null
    } = {}) {
        this.eventStore = eventStore;
        this.registry = new AgentRegistry();
        this.agentRegistryStore = this.resolveAgentRegistryStore({
            agentRegistryStore,
            agentRegistryPath,
            enableAgentRegistryStore
        });
        this.agentRegistrySnapshot = this.loadAgentRegistrySnapshot();
        const configuredRemoteAgents = Array.isArray(remoteAgents) ? remoteAgents : readRemoteAgentSpecs(process.env);
        const persistedRemoteAgents = this.readPersistedRemoteAgentSpecs(this.agentRegistrySnapshot);
        this.remoteAgentSpecs = this.mergeRemoteAgentSpecs(configuredRemoteAgents, persistedRemoteAgents);
        this.remoteVerifierMode = normalizeRemoteVerifierMode(remoteVerifierMode || process.env.DEMO_REMOTE_VERIFIER_MODE);
        this.reputationStore = new ReputationStore();
        this.reputationStore.importSnapshots(this.agentRegistrySnapshot?.reputationByAgentId || {});
        this.weightAllocator = new WeightAllocator({
            reputationStore: this.reputationStore
        });
        this.behaviorAnalyzer = new BehaviorAnalyzer();
        this.committeeSelector = new CommitteeSelector({
            reputationStore: this.reputationStore,
            targetCommitteeSize: Math.max(1, Number(process.env.DEMO_NEGOTIATION_COMMITTEE_SIZE) || 5)
        });
        this.includeLocalVerifiers = !(this.remoteVerifierMode === 'replace' && this.remoteAgentSpecs.length);
        this.bootstrapDefaults({
            includeLocalVerifiers: this.includeLocalVerifiers
        });
        this.bootstrapPersistedLocalAgents(this.agentRegistrySnapshot?.agents || [], {
            includeLocalVerifiers: this.includeLocalVerifiers
        });
        this.bootstrapRemoteAgents(this.remoteAgentSpecs);
        this.applyPersistedAgentMetadata(this.agentRegistrySnapshot?.agents || []);
        this.persistAgentRegistrySnapshot();
        this.onchainState = this.loadOnchainState();
        this.bootstrapOnchainAgents();
        this.importOnchainReputation();
    }

    resolveAgentRegistryStore({ agentRegistryStore, agentRegistryPath, enableAgentRegistryStore } = {}) {
        if (agentRegistryStore !== undefined) {
            return agentRegistryStore;
        }

        const disabledByEnv = String(process.env.DEMO_AGENT_REGISTRY_DISABLED || '').toLowerCase() === 'true';
        const enabled = enableAgentRegistryStore !== null
            ? Boolean(enableAgentRegistryStore)
            : process.env.NODE_ENV !== 'test' && !disabledByEnv;
        if (!enabled) {
            return null;
        }
        return new AgentRegistryJsonStore({ filePath: agentRegistryPath });
    }

    loadOnchainState() {
        const enabled = String(process.env.DEMO_ONCHAIN_AGENTS_ENABLED || '').toLowerCase() === 'true';
        if (!enabled) {
            return null;
        }
        const statePath = process.env.DEMO_ONCHAIN_STATE_PATH
            || path.join(__dirname, '../../.demo/agents/onchain-state.json');
        try {
            const raw = fs.readFileSync(statePath, 'utf8');
            const state = JSON.parse(raw);
            if (!state || !Array.isArray(state.agents)) {
                throw new Error('Invalid onchain state format');
            }
            this.emitEvent({
                level: 'info',
                type: 'agent',
                relayState: 'ONCHAIN_STATE_LOADED',
                correlationId: null,
                message: `Loaded ${state.agents.length} agents from on-chain state`,
                data: { contractAddress: state.contractAddress, syncedAt: state.syncedAt }
            });
            return state;
        } catch (error) {
            this.emitEvent({
                level: 'warn',
                type: 'agent',
                relayState: 'ONCHAIN_STATE_LOAD_FAILED',
                correlationId: null,
                message: `On-chain state load failed: ${error.message || error}`,
                data: { statePath }
            });
            return null;
        }
    }

    bootstrapOnchainAgents() {
        if (!this.onchainState || !Array.isArray(this.onchainState.agents)) {
            return;
        }
        const agentDirectory = new AgentDirectory();
        const remoteSpecs = this.onchainState.agents
            .filter((agent) => agent.status === 1 && agent.role === 2)
            .map((agent) => {
                // 优先从链下安全目录读取 endpoint 和 sharedSecret
                const dirConfig = agentDirectory.load(agent.agentId);
                const endpoint = dirConfig?.endpoint || agent.endpoint;
                const sharedSecret = dirConfig?.sharedSecret || null;
                if (!endpoint) {
                    this.emitEvent({
                        level: 'warn',
                        type: 'agent',
                        relayState: 'ONCHAIN_AGENT_NO_ENDPOINT',
                        correlationId: null,
                        message: `Agent ${agent.agentId} has no endpoint (chain or directory)`,
                        data: { agentId: agent.agentId }
                    });
                    return null;
                }
                if (!sharedSecret) {
                    this.emitEvent({
                        level: 'warn',
                        type: 'agent',
                        relayState: 'ONCHAIN_AGENT_NO_SECRET',
                        correlationId: null,
                        message: `Agent ${agent.agentId} has no sharedSecret in directory, using unauthenticated call`,
                        data: { agentId: agent.agentId }
                    });
                }
                return {
                    baseUrl: endpoint,
                    agentId: agent.agentId,
                    role: 'VERIFIER',
                    organization: agent.organization,
                    strategyType: agent.strategyType,
                    focus: this.strategyToFocus(agent.strategyType),
                    enabled: true,
                    timeoutMs: 10000,
                    sharedSecret
                };
            })
            .filter(Boolean);
        if (!remoteSpecs.length) {
            return;
        }
        const remotes = createRemoteAgents(remoteSpecs);
        for (const agent of remotes) {
            if (this.registry.get(agent.agentId)) {
                this.registry.unregister(agent.agentId);
            }
            this.registry.register(agent);
        }
        this.emitEvent({
            level: 'info',
            type: 'agent',
            relayState: 'ONCHAIN_AGENTS_BOOTSTRAPPED',
            correlationId: null,
            message: `Bootstrapped ${remotes.length} on-chain agents as remote verifiers`,
            data: { agentIds: remotes.map((a) => a.agentId) }
        });
    }

    strategyToFocus(strategyType) {
        if (!strategyType) return 'balanced';
        if (strategyType.startsWith('A_')) return 'proof';
        if (strategyType.startsWith('B_')) return 'balanced';
        if (strategyType.startsWith('C_')) return 'semantic';
        return 'balanced';
    }

    importOnchainReputation() {
        if (!this.onchainState || !Array.isArray(this.onchainState.agents)) {
            return;
        }
        const snapshots = {};
        for (const agent of this.onchainState.agents) {
            if (!agent.agentId) continue;
            const onchainRep = Number(agent.reputation) || 500;
            const normalizedRep = onchainRep / 1000;
            const successCount = Number(agent.successCount) || 0;
            const totalTasks = Number(agent.totalTasks) || 0;
            snapshots[agent.agentId] = {
                agentId: agent.agentId,
                weight: normalizedRep,
                qualityScore: normalizedRep,
                trustScore: totalTasks > 0 ? successCount / totalTasks : 0.5,
                successCount,
                totalCount: totalTasks,
                lastUpdatedAt: this.onchainState.syncedAt || new Date().toISOString(),
                formulaVersion: 'onchain-import-v1'
            };
        }
        this.reputationStore.importSnapshots(snapshots);
        this.emitEvent({
            level: 'info',
            type: 'agent',
            relayState: 'ONCHAIN_REPUTATION_IMPORTED',
            correlationId: null,
            message: `Imported reputation for ${Object.keys(snapshots).length} agents from on-chain state`,
            data: {}
        });
    }

    loadAgentRegistrySnapshot() {
        if (!this.agentRegistryStore || typeof this.agentRegistryStore.load !== 'function') {
            return null;
        }
        try {
            return this.agentRegistryStore.load();
        } catch (error) {
            this.emitEvent({
                level: 'warn',
                type: 'agent',
                relayState: 'AGENT_REGISTRY_LOAD_FAILED',
                correlationId: null,
                message: `Agent registry JSON load failed: ${error.message || error}`,
                data: {
                    filePath: this.agentRegistryStore.filePath || null
                }
            });
            return null;
        }
    }

    readPersistedRemoteAgentSpecs(snapshot = null) {
        const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
        return agents
            .map(normalizeAgentRecord)
            .filter((item) => item && item.enabled !== false && item.role === 'VERIFIER' && item.kind === 'remote' && item.endpoint)
            .map((item) => ({
                baseUrl: item.endpoint,
                agentId: item.agentId,
                role: item.role,
                capabilities: item.capabilities,
                organization: item.organization,
                strategyType: item.strategyType,
                llmBackend: item.llmBackend,
                focus: item.focus,
                enabled: item.enabled,
                timeoutMs: item.timeoutMs
            }));
    }

    mergeRemoteAgentSpecs(primary = [], secondary = []) {
        const byKey = new Map();
        for (const spec of [...secondary, ...primary]) {
            if (!spec) {
                continue;
            }
            const key = spec.agentId || spec.baseUrl || spec.endpoint || spec.url;
            if (key) {
                byKey.set(key, spec);
            }
        }
        return Array.from(byKey.values());
    }

    bootstrapDefaults({ includeLocalVerifiers = true } = {}) {
        if (includeLocalVerifiers) {
            // Optional allowlist: DEMO_LOCAL_VERIFIER_IDS="verifier-proof-01,verifier-balanced-01,..."
            // When set, only listed verifier IDs are registered. Comma-separated, whitespace ignored.
            const allowEnv = String(process.env.DEMO_LOCAL_VERIFIER_IDS || '').trim();
            const allowSet = allowEnv
                ? new Set(allowEnv.split(',').map((s) => s.trim()).filter(Boolean))
                : null;
            const allowed = (id) => !allowSet || allowSet.has(id);

            if (allowed('verifier-structural-01')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-structural-01',
                    focus: 'structural',
                    strictProof: false,
                    organization: 'org-a',
                    strategyType: 'A_PROOF_VALIDATOR'
                }));
            }
            if (allowed('verifier-proof-01')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-proof-01',
                    focus: 'proof',
                    strictProof: true,
                    organization: 'org-b',
                    strategyType: 'A_PROOF_VALIDATOR'
                }));
            }
            if (allowed('verifier-balanced-01')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-balanced-01',
                    focus: 'balanced',
                    strictProof: false,
                    organization: 'org-c',
                    strategyType: 'B_POLICY_CHECKER',
                    llmBackend: 'rules-plus-llm-a'
                }));
            }
            if (allowed('verifier-proof-02')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-proof-02',
                    focus: 'proof',
                    strictProof: true,
                    organization: 'org-d',
                    strategyType: 'A_PROOF_VALIDATOR'
                }));
            }
            if (allowed('verifier-balanced-02')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-balanced-02',
                    focus: 'balanced',
                    strictProof: false,
                    organization: 'org-e',
                    strategyType: 'B_POLICY_CHECKER',
                    llmBackend: 'rules-plus-llm-b'
                }));
            }
            if (allowed('verifier-semantic-01')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-semantic-01',
                    focus: 'semantic',
                    strictProof: false,
                    organization: 'org-f',
                    strategyType: 'C_SEMANTIC_REASONER',
                    llmBackend: 'semantic-llm-a'
                }));
            }
            if (allowed('verifier-semantic-02')) {
                this.registry.register(new VerifierAgent({
                    agentId: 'verifier-semantic-02',
                    focus: 'semantic',
                    strictProof: false,
                    organization: 'org-g',
                    strategyType: 'C_SEMANTIC_REASONER',
                    llmBackend: 'semantic-llm-b'
                }));
            }
        }
        this.registry.register(new CoordinatorAgent({
            agentId: 'coordinator-01',
            organization: 'org-coordinator'
        }));
        this.registry.register(new EvidenceAgent({
            agentId: 'evidence-01',
            organization: 'org-collector-a'
        }));
        this.registry.register(new EvidenceAgent({
            agentId: 'evidence-02',
            organization: 'org-collector-b'
        }));
        // Arbitration pool: k=5, all 3 strategy types present, each from a
        // distinct org so the org-diversity constraint (≤⌊5/3⌋=1) can be met.
        this.registry.register(new ArbitrationAgent({
            agentId: 'arbitration-01',
            organization: 'org-arb-a',
            strategyType: 'A_PROOF_VALIDATOR'
        }));
        this.registry.register(new ArbitrationAgent({
            agentId: 'arbitration-02',
            organization: 'org-arb-b',
            strategyType: 'B_POLICY_CHECKER'
        }));
        this.registry.register(new ArbitrationAgent({
            agentId: 'arbitration-03',
            organization: 'org-arb-c',
            strategyType: 'C_SEMANTIC_REASONER'
        }));
        this.registry.register(new ArbitrationAgent({
            agentId: 'arbitration-04',
            organization: 'org-arb-d',
            strategyType: 'A_PROOF_VALIDATOR'
        }));
        this.registry.register(new ArbitrationAgent({
            agentId: 'arbitration-05',
            organization: 'org-arb-e',
            strategyType: 'B_POLICY_CHECKER'
        }));
        this.registry.register(new SubmitterAgent({
            agentId: 'submitter-01',
            organization: 'org-submitter'
        }));
    }

    bootstrapRemoteAgents(remoteAgents = []) {
        const agents = remoteAgents
            .filter(Boolean)
            .map((item, index) => (typeof item.execute === 'function' ? item : createRemoteAgents([item])[0]));
        for (const agent of agents) {
            if (agent.role === 'VERIFIER') {
                this.registry.register(agent);
            }
        }
    }

    bootstrapPersistedLocalAgents(agentRecords = [], { includeLocalVerifiers = true } = {}) {
        if (!includeLocalVerifiers) {
            return;
        }
        for (const record of agentRecords.map(normalizeAgentRecord).filter(Boolean)) {
            if (record.enabled === false || record.kind !== 'local' || record.role !== 'VERIFIER') {
                continue;
            }
            if (this.registry.get(record.agentId)) {
                continue;
            }
            this.registry.register(new VerifierAgent({
                agentId: record.agentId,
                focus: record.focus || 'balanced',
                strictProof: Boolean(record.strictProof),
                organization: record.organization,
                strategyType: record.strategyType,
                llmBackend: record.llmBackend
            }));
        }
    }

    applyPersistedAgentMetadata(agentRecords = []) {
        for (const record of agentRecords.map(normalizeAgentRecord).filter(Boolean)) {
            const agent = this.registry.get(record.agentId);
            if (!agent) {
                continue;
            }
            agent.enabled = record.enabled !== false;
            agent.organization = record.organization || agent.organization;
            agent.strategyType = record.strategyType || agent.strategyType;
            agent.llmBackend = record.llmBackend || agent.llmBackend;
            if (Array.isArray(record.capabilities) && record.capabilities.length) {
                agent.capabilities = record.capabilities.slice();
            }
            if (record.focus) {
                agent.focus = record.focus;
            }
            if (record.strictProof !== undefined) {
                agent.strictProof = Boolean(record.strictProof);
            }
        }
    }

    refreshPersistedAgentState() {
        const snapshot = this.loadAgentRegistrySnapshot();
        if (!snapshot) {
            return;
        }
        this.agentRegistrySnapshot = snapshot;
        this.reputationStore.importSnapshots(snapshot.reputationByAgentId || {});
        this.bootstrapPersistedLocalAgents(snapshot.agents || [], {
            includeLocalVerifiers: this.includeLocalVerifiers
        });
        this.applyPersistedAgentMetadata(snapshot.agents || []);
    }

    describeAgents() {
        return this.registry.list().map((agent) => {
            const descriptor = agent.getDescriptor
                ? agent.getDescriptor()
                : {
                    agentId: agent.agentId,
                    role: agent.role
                };
            return normalizeAgentRecord({
                ...descriptor,
                kind: descriptor.kind || (descriptor.remote ? 'remote' : 'local'),
                endpoint: descriptor.endpoint || descriptor.baseUrl || agent.baseUrl || null,
                enabled: descriptor.enabled ?? agent.enabled
            });
        }).filter(Boolean);
    }

    persistAgentRegistrySnapshot({ recentRound = null } = {}) {
        if (!this.agentRegistryStore || typeof this.agentRegistryStore.saveSnapshot !== 'function') {
            return null;
        }
        try {
            return this.agentRegistryStore.saveSnapshot({
                agents: this.describeAgents(),
                reputationByAgentId: this.reputationStore.exportSnapshots(),
                recentRound
            });
        } catch (error) {
            this.emitEvent({
                level: 'warn',
                type: 'agent',
                relayState: 'AGENT_REGISTRY_SAVE_FAILED',
                correlationId: recentRound?.queryId || null,
                message: `Agent registry JSON save failed: ${error.message || error}`,
                data: {
                    filePath: this.agentRegistryStore.filePath || null
                }
            });
            return null;
        }
    }

    getVerifiers() {
        return this.registry.list('VERIFIER');
    }

    getCoordinator() {
        return this.registry.list('COORDINATOR')[0] || null;
    }

    getEvidenceAgents() {
        return this.registry.list('EVIDENCE');
    }

    getSubmitter() {
        return this.registry.list('SUBMITTER')[0] || null;
    }

    getArbitrationAgents() {
        return this.registry.list('ARBITRATION');
    }

    getArbitrationAgent() {
        return this.registry.list('ARBITRATION')[0] || null;
    }

    emitEvent(event) {
        if (!this.eventStore || typeof this.eventStore.addEvent !== 'function') {
            return;
        }
        this.eventStore.addEvent(event);
    }

    async refreshRemoteAgentDescriptors(agents = []) {
        const remotes = agents.filter((agent) => typeof agent.refreshDescriptor === 'function');
        for (const agent of remotes) {
            try {
                const previousAgentId = agent.agentId;
                await agent.refreshDescriptor();
                if (previousAgentId && previousAgentId !== agent.agentId) {
                    this.registry.unregister(previousAgentId);
                    this.registry.register(agent);
                }
            } catch (error) {
                if (typeof agent.markUnavailable === 'function') {
                    agent.markUnavailable(error);
                }
                this.emitEvent({
                    level: 'warn',
                    type: 'agent',
                    relayState: 'REMOTE_AGENT_UNAVAILABLE',
                    correlationId: null,
                    message: `${agent.agentId} unavailable: ${error.message || error}`,
                    data: agent.getDescriptor ? agent.getDescriptor() : { agentId: agent.agentId }
                });
            }
        }
        if (remotes.length) {
            this.persistAgentRegistrySnapshot();
        }
    }

    async evaluateTask(task, context = {}) {
        this.refreshPersistedAgentState();
        let allVerifiers = this.getVerifiers();
        await this.refreshRemoteAgentDescriptors(allVerifiers);
        const unavailableAgents = allVerifiers
            .filter((agent) => !agent.supports(task))
            .map((agent) => ({
                agentId: agent.agentId,
                availabilityStatus: agent.availabilityStatus || 'unavailable',
                lastError: agent.lastError || null
            }));
        allVerifiers = allVerifiers.filter((agent) => agent.supports(task));
        const round = Number(context.round || context.currentRound || 1);
        const protocolParams = buildProtocolParams(task?.risk);
        const behaviorAnalysis = this.behaviorAnalyzer.analyzeCandidates({
            agents: allVerifiers,
            history: context.negotiationHistory || [],
            reputationStore: this.reputationStore
        });
        const committee = this.committeeSelector.select({
            agents: allVerifiers,
            behaviorAnalysis,
            committeeSize: protocolParams.groupSize,
            task,
            protocolParams
        });
        const verifiers = committee.selected;
        for (const v of verifiers) {
            if (typeof v.markInUse === 'function') v.markInUse();
        }
        try {
        const assignedWeights = this.weightAllocator.assign(verifiers.map((agent) => agent.agentId));
        const weightVector = this.reputationStore.getWeightVector(verifiers.map((agent) => agent.agentId));
        const weightVectorMap = new Map(weightVector.map((item) => [item.agentId, item]));

        // ── COMMIT-REVEAL SESSION (论文 §IV-E) ────────────────────────────────
        // Phase separation: agents commit a hash first, reveal plaintext after
        // the commit window closes. In this single-process demo both phases
        // execute synchronously, preserving the structural audit trail and
        // correct penalty classification for absent / silent agents.
        const crSession = new CommitRevealSession({
            agentIds: verifiers.map((v) => v.agentId),
            taskId: task?.taskId,
            round
        });

        // COMMIT PHASE: all verifiers execute in parallel (Promise.allSettled) so
        // that latency is bounded by max(latency_i) rather than sum(latency_i), and
        // each agent's decision is independent of the others' timing — preserving the
        // isolation assumption of the commit-reveal scheme (§IV-E).
        const sealedByAgent = new Map();
        const commitSettled = await Promise.allSettled(
            verifiers.map(async (verifier) => {
                const startedAt = Date.now();
                const verdict = await verifier.execute(task, {
                    ...context,
                    assignedWeight: assignedWeights[verifier.agentId] || 0
                });
                return sealOpinion({
                    ...verdict,
                    assignedWeight: assignedWeights[verifier.agentId] || 0,
                    latencyMs: Date.now() - startedAt,
                    wbft: weightVectorMap.get(verifier.agentId) || null
                }, { task, round });
            })
        );
        for (let i = 0; i < commitSettled.length; i++) {
            const verifier = verifiers[i];
            const result = commitSettled[i];
            if (result.status === 'rejected') {
                // Byzantine/silent or transiently-faulty agent — no commit submitted;
                // will appear in crSession.absentCommitters after closeCommitPhase().
                const error = result.reason;
                if (typeof verifier.markUnavailable === 'function') {
                    verifier.markUnavailable(error);
                }
                this.emitEvent({
                    level: 'warn',
                    type: 'negotiation',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'AGENT_NO_RESPONSE',
                    correlationId: task?.queryId || null,
                    message: `${verifier.agentId} failed to respond: ${error.message || error}`,
                    data: { agentId: verifier.agentId, code: error.code || null, round }
                });
            } else {
                const sealed = result.value;
                crSession.submitCommit(verifier.agentId, sealed.commitReveal.commitHash);
                sealedByAgent.set(verifier.agentId, sealed);
                this.emitEvent({
                    type: 'negotiation',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'COMMITTED',
                    correlationId: task?.queryId || null,
                    message: `${verifier.agentId} submitted commit in round ${round}`,
                    data: {
                        agentId: verifier.agentId,
                        commitHash: sealed.commitReveal.commitHash,
                        round
                    }
                });
            }
        }

        // Close commit phase — absent agents (threw errors above) are recorded.
        crSession.closeCommitPhase();
        if (crSession.absentCommitters.length) {
            this.emitEvent({
                level: 'warn',
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'COMMIT_PHASE_CLOSED',
                correlationId: task?.queryId || null,
                message: `Commit phase closed: ${crSession.absentCommitters.length} agent(s) absent`,
                data: { absentCommitters: crSession.absentCommitters, round }
            });
        }

        // REVEAL PHASE: submit reveals for all committed agents and verify hashes.
        for (const [agentId, sealed] of sealedByAgent) {
            const rev = sealed.commitReveal.reveal;
            crSession.submitReveal(agentId, {
                judgment: rev.judgment,
                confidence: rev.confidence,
                nonce: rev.nonce,
                reasonHash: rev.reasonHash
            });
        }

        // Close reveal phase — in the synchronous demo silentRevealers will
        // always be empty, but the session tracks it for correctness.
        crSession.closeRevealPhase();
        if (crSession.silentRevealers.length) {
            this.emitEvent({
                level: 'warn',
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'SILENCE_ATTACK_DETECTED',
                correlationId: task?.queryId || null,
                message: `Reveal phase: ${crSession.silentRevealers.length} agent(s) withheld reveal`,
                data: { silentRevealers: crSession.silentRevealers, round }
            });
        }

        // Only valid reveals (hash-verified) contribute to consensus opinions.
        const validRevealIds = new Set(crSession.validReveals().map((r) => r.agentId));
        const opinions = [];
        for (const [agentId, sealed] of sealedByAgent) {
            if (!validRevealIds.has(agentId)) continue;
            opinions.push(sealed);
            this.emitEvent({
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: sealed.decision,
                correlationId: task?.queryId || null,
                message: `${agentId} revealed ${sealed.decision} (confidence=${sealed.confidence}) in round ${round}`,
                data: sealed
            });
        }

        const coordinator = this.getCoordinator();
        const coordination = coordinator
            ? await coordinator.execute(task, { ...context, opinions })
            : null;
        if (coordination) {
            this.emitEvent({
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: coordination.status,
                correlationId: task?.queryId || null,
                message: `${coordination.agentId} summarized negotiation round ${round}`,
                data: coordination
            });
        }

        const submitter = this.getSubmitter();
        const submitterPlan = submitter
            ? await submitter.execute(task, { ...context, opinions, coordination })
            : null;

        return {
            opinions,
            coordination,
            submitterPlan,
            weightVector,
            behaviorAnalysis,
            protocolParams,
            sessionSummary: crSession.summary(),
            unavailableAgents,
            committee: {
                selected: verifiers.map((agent) => agent.getDescriptor ? agent.getDescriptor() : { agentId: agent.agentId, role: agent.role }),
                excluded: committee.excluded,
                unavailableAgents,
                selectionSeed: committee.selectionSeed || null,
                constraints: committee.constraints || null
            }
        };
        } finally {
            for (const v of verifiers) {
                if (typeof v.markAvailable === 'function') v.markAvailable();
            }
        }
    }

    async collectEvidence(task, context = {}) {
        const evidenceAgents = this.getEvidenceAgents().filter((agent) => agent.supports(task));
        const collections = [];
        const mergedPatch = {
            artifacts: [],
            appliedRequests: [],
            pendingRequests: [],
            collectorAttestations: []
        };

        for (const agent of evidenceAgents) {
            const result = await agent.execute(task, context);
            collections.push(result);
            if (result?.evidencePatch && typeof result.evidencePatch === 'object') {
                if (Array.isArray(result.evidencePatch.artifacts)) {
                    mergedPatch.artifacts.push(...result.evidencePatch.artifacts);
                }
                if (Array.isArray(result.evidencePatch.appliedRequests)) {
                    mergedPatch.appliedRequests.push(...result.evidencePatch.appliedRequests);
                }
                if (Array.isArray(result.evidencePatch.pendingRequests)) {
                    mergedPatch.pendingRequests.push(...result.evidencePatch.pendingRequests);
                }
                if (Array.isArray(result.evidencePatch.collectorAttestations)) {
                    mergedPatch.collectorAttestations.push(...result.evidencePatch.collectorAttestations);
                }
                for (const [key, value] of Object.entries(result.evidencePatch)) {
                    if (key === 'artifacts' || key === 'appliedRequests' || key === 'pendingRequests' || key === 'collectorAttestations') {
                        continue;
                    }
                    mergedPatch[key] = value;
                }
            }
            this.emitEvent({
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: result?.status || 'COLLECTED',
                correlationId: task?.queryId || null,
                message: `${result.agentId} collected evidence for round ${Number(context.round || context.currentRound || 1)}`,
                data: result
            });
        }

        return {
            collections,
            evidencePatch: mergedPatch
        };
    }

    finalizeRound({ opinions = [], finalProposal = null, sessionSummary = null } = {}) {
        const updates = this.reputationStore.updateFromRound(opinions, finalProposal, {
            absentCommitters: sessionSummary?.absentCommitters || [],
            silentRevealers: sessionSummary?.silentRevealers || []
        });
        this.persistAgentRegistrySnapshot({
            recentRound: {
                proposalId: finalProposal?.proposalId || null,
                taskId: finalProposal?.taskId || null,
                queryId: finalProposal?.queryId || null,
                finalDecision: finalProposal?.finalDecision || null,
                agentIds: opinions.map((item) => item.agentId).filter(Boolean),
                opinionCount: opinions.length,
                reputationUpdates: updates
            }
        });
        this.syncResultsToChain({ opinions, finalProposal, updates });
        return updates;
    }

    syncResultsToChain({ opinions = [], finalProposal = null, updates = [] } = {}) {
        const enabled = String(process.env.DEMO_ONCHAIN_AGENTS_ENABLED || '').toLowerCase() === 'true';
        if (!enabled || !opinions.length) {
            return;
        }
        const taskId = finalProposal?.taskId || finalProposal?.queryId || `task_${Date.now()}`;
        const results = opinions.map((opinion) => {
            const finalDecision = String(finalProposal?.finalDecision || 'OBSERVE').toUpperCase();
            const decision = String(opinion.decision || 'QUESTION').toUpperCase();
            const aligned = (
                (finalDecision === 'COMMIT' && decision === 'APPROVE') ||
                (finalDecision === 'REJECT' && decision === 'REJECT') ||
                (finalDecision === 'OBSERVE' && decision === 'QUESTION')
            );
            return {
                agentId: opinion.agentId,
                aligned,
                confidence: clamp01(opinion.confidence ?? 0.5),
                latencyMs: Number(opinion.latencyMs) || 0
            };
        });

        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '../../scripts/record-task-results.js');
        const child = spawn(process.execPath, [
            scriptPath,
            taskId,
            JSON.stringify(results)
        ], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();

        this.emitEvent({
            level: 'info',
            type: 'agent',
            relayState: 'ONCHAIN_SYNC_TRIGGERED',
            correlationId: taskId,
            message: `Triggered on-chain reputation sync for ${results.length} agents`,
            data: { taskId, agentIds: results.map((r) => r.agentId) }
        });
    }

    async arbitrate(task, context = {}) {
        const arbitrators = this.getArbitrationAgents();
        if (!arbitrators.length) {
            return null;
        }

        // Build full context for arbitrators (论文 §IV-F):
        // evidence + all verifier opinions + reason hashes + conflict evidence.
        const fullContext = {
            evidence: task?.evidenceBundle || {},
            verifierOpinions: context.opinions || [],
            reasonHashes: (context.opinions || [])
                .map((op) => op.reasonHash || op.commitReveal?.reveal?.reasonHash)
                .filter(Boolean),
            conflictEvidence: context.disagreements || null,
            behaviorAnalysis: context.behaviorAnalysis || null,
            round: context.round || 1,
            currentRound: context.round || 1
        };

        const protocolParams = buildProtocolParams(task?.risk);
        const committee = new ArbitrationCommittee({
            agentPool: arbitrators,
            reputationStore: this.reputationStore,
            committeeSelector: this.committeeSelector
        });

        const result = await committee.run(task, fullContext, {
            protocolParams,
            eventEmit: (evt) => this.emitEvent({
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: evt.phase,
                correlationId: task?.queryId || null,
                message: `Arbitration ${evt.phase}: ${evt.agentId || evt.finalDecision || ''}`,
                data: evt
            })
        });

        this.emitEvent({
            type: 'negotiation',
            direction: 'FISCO_TO_FABRIC',
            relayState: result.finalDecision,
            correlationId: task?.queryId || null,
            message: `Arbitration committee reached terminal decision: ${result.finalDecision} — ${result.decisionReason}`,
            data: result
        });
        return result;
    }
}

module.exports = { AgentRuntime };
