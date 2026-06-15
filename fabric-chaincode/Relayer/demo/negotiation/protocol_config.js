const NORMAL_RISK = 'NORMAL';
const CRITICAL_RISK = 'CRITICAL';

const DEFAULT_PROTOCOL_VERSION = 'ma3c-paper-v1';
const DEFAULT_NORMAL_GROUP_SIZE = 5;
const DEFAULT_CRITICAL_GROUP_SIZE = 7;
const DEFAULT_NORMAL_THRESHOLD = 0.70;
const DEFAULT_CRITICAL_THRESHOLD = 0.75;
const DEFAULT_ARBITRATION_THRESHOLD = 0.75;
const DEFAULT_ARBITRATION_GROUP_SIZE = 5;
const DEFAULT_ARBITRATION_REP_THRESHOLD = 0.05;
const DEFAULT_REPUTATION_MIN = 0.1;
const DEFAULT_REPUTATION_MAX_RATIO = 2;

function readPositiveNumberEnv(name, fallback) {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return value;
}

function readRatioEnv(name, fallback) {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) {
        return fallback;
    }
    return value;
}

function normalizeRisk(risk) {
    const value = String(risk || NORMAL_RISK).toUpperCase();
    return value === CRITICAL_RISK ? CRITICAL_RISK : NORMAL_RISK;
}

function groupSizeForRisk(risk) {
    return normalizeRisk(risk) === CRITICAL_RISK
        ? Math.max(1, Math.round(readPositiveNumberEnv('DEMO_MA3C_CRITICAL_GROUP_SIZE', DEFAULT_CRITICAL_GROUP_SIZE)))
        : Math.max(1, Math.round(readPositiveNumberEnv('DEMO_MA3C_NORMAL_GROUP_SIZE', DEFAULT_NORMAL_GROUP_SIZE)));
}

function thresholdForRisk(risk) {
    return normalizeRisk(risk) === CRITICAL_RISK
        ? readRatioEnv('DEMO_MA3C_CRITICAL_THRESHOLD', DEFAULT_CRITICAL_THRESHOLD)
        : readRatioEnv('DEMO_MA3C_NORMAL_THRESHOLD', DEFAULT_NORMAL_THRESHOLD);
}

function minimumRevealCount(groupSize) {
    const n = Math.max(1, Number(groupSize) || 1);
    return Math.min(n, Math.ceil(n / 2) + 1);
}

function organizationLimit(groupSize) {
    return Math.max(1, Math.floor((Number(groupSize) || DEFAULT_NORMAL_GROUP_SIZE) / 3));
}

function buildProtocolParams(risk) {
    const normalizedRisk = normalizeRisk(risk);
    const groupSize = groupSizeForRisk(normalizedRisk);
    const arbitrationGroupSize = Math.max(1, Math.round(readPositiveNumberEnv('DEMO_MA3C_ARBITRATION_GROUP_SIZE', DEFAULT_ARBITRATION_GROUP_SIZE)));
    return {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        risk: normalizedRisk,
        groupSize,
        threshold: thresholdForRisk(normalizedRisk),
        arbitrationThreshold: readRatioEnv('DEMO_MA3C_ARBITRATION_THRESHOLD', DEFAULT_ARBITRATION_THRESHOLD),
        arbitrationGroupSize,
        arbitrationRepThreshold: readRatioEnv('DEMO_MA3C_ARBITRATION_REP_THRESHOLD', DEFAULT_ARBITRATION_REP_THRESHOLD),
        minimumRevealCount: minimumRevealCount(groupSize),
        organizationLimit: organizationLimit(groupSize),
        reputationMin: readRatioEnv('DEMO_MA3C_REPUTATION_MIN', DEFAULT_REPUTATION_MIN),
        reputationMaxRatio: readPositiveNumberEnv('DEMO_MA3C_REPUTATION_MAX_RATIO', DEFAULT_REPUTATION_MAX_RATIO)
    };
}

module.exports = {
    CRITICAL_RISK,
    DEFAULT_ARBITRATION_GROUP_SIZE,
    DEFAULT_ARBITRATION_REP_THRESHOLD,
    DEFAULT_ARBITRATION_THRESHOLD,
    DEFAULT_CRITICAL_THRESHOLD,
    DEFAULT_NORMAL_THRESHOLD,
    DEFAULT_PROTOCOL_VERSION,
    NORMAL_RISK,
    buildProtocolParams,
    groupSizeForRisk,
    minimumRevealCount,
    normalizeRisk,
    organizationLimit,
    thresholdForRisk
};
