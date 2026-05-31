const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FABRIC_RUNTIME_SAMPLES_DIR = path.join(PROJECT_ROOT, '.fabric-runtime', 'fabric-samples');

const FABRIC_SAMPLES_CANDIDATES = [
    process.env.FABRIC_SAMPLES_DIR,
    FABRIC_RUNTIME_SAMPLES_DIR,
    '/mnt/fast18/xunuo/czs/fabric-samples',
    '/mnt/fast18/xunuo/czs/fabric-samples-main',
    '/mnt/fast18/xunuo/qukuialian/czs/fabric-samples-main',
    '/home/tr/fabric-samples',
    '/root/czs/fabric/fabric-samples-main'
].filter(Boolean);

function pathExists(targetPath) {
    try {
        return fs.existsSync(targetPath);
    } catch (_error) {
        return false;
    }
}

function resolveFabricSamplesDir(inputPath) {
    const candidates = [];
    if (inputPath) {
        candidates.push(path.resolve(inputPath));
    }
    candidates.push(...FABRIC_SAMPLES_CANDIDATES.map((item) => path.resolve(item)));

    for (const candidate of candidates) {
        if (path.basename(candidate) === 'test-network' && pathExists(path.join(candidate, 'network.sh'))) {
            return path.dirname(candidate);
        }
        if (pathExists(path.join(candidate, 'test-network', 'network.sh'))) {
            return candidate;
        }
    }

    return null;
}

function resolveFabricTestNetworkDir(inputPath) {
    if (inputPath) {
        const candidate = path.resolve(inputPath);
        if (path.basename(candidate) === 'test-network' && pathExists(path.join(candidate, 'network.sh'))) {
            return candidate;
        }
    }

    const samplesDir = resolveFabricSamplesDir(inputPath);
    if (!samplesDir) {
        return null;
    }

    const testNetworkDir = path.join(samplesDir, 'test-network');
    return pathExists(path.join(testNetworkDir, 'network.sh')) ? testNetworkDir : null;
}

function resolveFabricCryptoPath(inputPath) {
    const explicitCandidates = [
        process.env.FABRIC_CRYPTO_PATH,
        inputPath
    ].filter(Boolean).map((item) => path.resolve(item));

    for (const candidate of explicitCandidates) {
        if (pathExists(path.join(candidate, 'users')) && pathExists(path.join(candidate, 'peers'))) {
            return candidate;
        }
    }

    const testNetworkDir = resolveFabricTestNetworkDir();
    if (!testNetworkDir) {
        return null;
    }

    const orgCryptoPath = path.join(
        testNetworkDir,
        'organizations',
        'peerOrganizations',
        'org1.example.com'
    );
    return pathExists(orgCryptoPath) ? orgCryptoPath : null;
}

module.exports = {
    FABRIC_SAMPLES_CANDIDATES,
    resolveFabricSamplesDir,
    resolveFabricTestNetworkDir,
    resolveFabricCryptoPath
};
