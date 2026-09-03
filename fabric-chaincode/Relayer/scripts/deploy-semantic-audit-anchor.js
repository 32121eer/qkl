#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function readConsolePeer(consoleDir) {
    const configPath = path.join(consoleDir, 'conf', 'config.toml');
    const content = fs.readFileSync(configPath, 'utf8');
    const match = content.match(/peers\s*=\s*\[\s*["']([^"']+)["']/i);
    if (!match) throw new Error(`No console peer found in ${configPath}`);
    const [host, portText] = match[1].split(':');
    const port = Number(portText);
    if (!host || !Number.isInteger(port)) throw new Error(`Invalid console peer '${match[1]}'`);
    return { host, port, configPath };
}

function probeTcp(host, port, timeoutMs = 1200) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

function bundledNodeFormat(consoleDir) {
    const binaryPath = path.resolve(consoleDir, '..', 'nodes', '127.0.0.1', 'fisco-bcos');
    if (!fs.existsSync(binaryPath)) return { binaryPath, format: 'missing' };
    const header = fs.readFileSync(binaryPath).subarray(0, 4);
    if (header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return { binaryPath, format: 'linux-elf' };
    const text = fs.readFileSync(binaryPath, 'utf8').slice(0, 64);
    if (text.startsWith('version https://git-lfs.github.com/spec/v1')) return { binaryPath, format: 'git-lfs-pointer' };
    return { binaryPath, format: 'other' };
}

async function assertConsolePeerReady(consoleDir) {
    const peer = readConsolePeer(consoleDir);
    if (await probeTcp(peer.host, peer.port)) return peer;
    const binary = bundledNodeFormat(consoleDir);
    const platformHint = process.platform === 'darwin' && binary.format === 'linux-elf'
        ? ` The bundled node binary is Linux ELF (${binary.binaryPath}) and cannot run natively on macOS; start the nodes in Docker/Linux or provide a macOS-compatible node.`
        : '';
    const error = new Error(
        `FISCO console peer ${peer.host}:${peer.port} is not reachable.${platformHint} ` +
        `After the node is listening, verify with: ${path.join(consoleDir, 'console.sh')} getBlockNumber`
    );
    error.code = 'FISCO_PEER_UNREACHABLE';
    throw error;
}

async function deployContract(contractName, { consoleDir = process.env.FISCO_CONSOLE_DIR } = {}) {
    if (!contractName || !/^[A-Za-z][A-Za-z0-9_]*$/.test(contractName)) {
        throw new Error('A valid Solidity contract name is required');
    }
    const resolvedConsoleDir = path.resolve(
        consoleDir || path.join(__dirname, '..', '..', 'fisco-bcos', 'console')
    );
    const consoleBin = path.join(resolvedConsoleDir, 'console.sh');
    await assertConsolePeerReady(resolvedConsoleDir);
    const { stdout, stderr } = await execFileAsync(
        consoleBin,
        ['deploy', contractName],
        { cwd: resolvedConsoleDir, timeout: 120000 }
    );
    const output = `${stdout || ''}${stderr || ''}`;
    const contractAddress = output.match(/contract address:\s*(0x[0-9a-fA-F]{40})/i)?.[1] || null;
    if (!contractAddress) {
        throw new Error(`Deployment did not return a contract address:\n${output.trim()}`);
    }
    return { contractName, contractAddress, consoleDir: resolvedConsoleDir, output: output.trim() };
}

function deploy(options = {}) {
    return deployContract('SemanticQueryAuditAnchor', options);
}

if (require.main === module) {
    deploy()
        .then((result) => {
            process.stdout.write(`${JSON.stringify({
                contractAddress: result.contractAddress,
                configField: 'chains[FISCO_BCOS].contracts.semanticAuditAnchor'
            }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    deploy,
    deployContract,
    readConsolePeer,
    probeTcp,
    bundledNodeFormat,
    assertConsolePeerReady
};
