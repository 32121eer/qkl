#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { ethers } = require('../fabric-chaincode/Relayer/node_modules/ethers');

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONSOLE_DIR = path.join(PROJECT_ROOT, 'fabric-chaincode', 'fisco-bcos', 'console');
const RELAYER_CONFIG_PATH = path.join(PROJECT_ROOT, 'fabric-chaincode', 'Relayer', 'config.json');
const GATEWAY_SOURCE = path.join(CONSOLE_DIR, 'contracts', 'solidity', 'GatewayAir.sol');
const COMPILED_DIR = path.join(CONSOLE_DIR, 'contracts', '.compiled');
const CONSOLE_CONFIG_PATH = path.join(CONSOLE_DIR, 'conf', 'config.toml');
const DEPLOY_LOG_PATH = path.join(CONSOLE_DIR, 'deploylog.txt');
const EXPECTED_SELECTORS = ['627dc718', '4100197d', 'deaf04b5', '4334550f'];

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveRelayerPrivateKey() {
    if (process.env.FISCO_PRIVATE_KEY) {
        return process.env.FISCO_PRIVATE_KEY;
    }
    const config = readJson(RELAYER_CONFIG_PATH);
    return config?.relayer?.privateKey || '';
}

function resolveRpcUrl() {
    return process.env.FISCO_RPC_URL || 'http://127.0.0.1:8545';
}

function resolveGroupName() {
    const text = fs.readFileSync(CONSOLE_CONFIG_PATH, 'utf8');
    const match = text.match(/defaultGroup\s*=\s*"([^"]+)"/);
    return match ? match[1] : 'group0';
}

async function rpc(method, params) {
    const response = await fetch(resolveRpcUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params
        })
    });
    const json = await response.json();
    if (json.error) {
        throw new Error(`${method}: ${json.error.message}`);
    }
    return json.result;
}

async function compileGatewayAir() {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gatewayair-build-'));
    try {
        await execFileAsync('npx', [
            '--yes',
            'solc@0.8.11',
            '--bin',
            '--abi',
            '--base-path',
            path.dirname(GATEWAY_SOURCE),
            '--include-path',
            path.dirname(GATEWAY_SOURCE),
            '-o',
            outputDir,
            GATEWAY_SOURCE
        ], {
            cwd: PROJECT_ROOT,
            env: {
                ...process.env,
                npm_config_loglevel: 'error',
                npm_config_fund: 'false',
                npm_config_audit: 'false'
            },
            timeout: 120_000
        });
    } catch (error) {
        const cachedAbiPath = path.join(COMPILED_DIR, 'GatewayAir.abi');
        const cachedBinPath = path.join(COMPILED_DIR, 'GatewayAir.bin');
        await fsp.copyFile(cachedAbiPath, path.join(outputDir, 'GatewayAir_sol_GatewayAir.abi'));
        await fsp.copyFile(cachedBinPath, path.join(outputDir, 'GatewayAir_sol_GatewayAir.bin'));
    }

    const abiPath = path.join(outputDir, 'GatewayAir_sol_GatewayAir.abi');
    const binPath = path.join(outputDir, 'GatewayAir_sol_GatewayAir.bin');
    const abi = readJson(abiPath);
    const bytecode = `0x${fs.readFileSync(binPath, 'utf8').trim()}`;
    return {
        outputDir,
        abiPath,
        binPath,
        abi,
        bytecode
    };
}

function ensureExpectedAbi(abi, bytecode) {
    const functions = new Set(
        abi.filter((item) => item.type === 'function').map((item) => item.name)
    );
    for (const name of ['getReceiptAnchor', 'anchoredPayloadHashes', 'anchoredNegotiationProofDigests']) {
        if (!functions.has(name)) {
            throw new Error(`compiled ABI missing ${name}`);
        }
    }
    const lowered = String(bytecode || '').toLowerCase();
    for (const selector of EXPECTED_SELECTORS) {
        if (!lowered.includes(selector)) {
            throw new Error(`compiled bytecode missing selector ${selector}`);
        }
    }
}

async function deployCompiledGateway({ abi, bytecode, registryAddress, lightClientAddress }) {
    const privateKey = resolveRelayerPrivateKey();
    if (!privateKey) {
        throw new Error('missing relayer.privateKey or FISCO_PRIVATE_KEY');
    }
    const wallet = new ethers.Wallet(privateKey);
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const from = await wallet.getAddress();
    const nonce = await rpc('eth_getTransactionCount', [from, 'latest']);
    const gasPrice = await rpc('eth_gasPrice', []);
    const chainId = Number(await rpc('eth_chainId', []));
    const deployTx = await factory.getDeployTransaction(registryAddress, lightClientAddress);

    const raw = await wallet.signTransaction({
        type: 0,
        chainId,
        nonce: BigInt(nonce),
        gasPrice: BigInt(gasPrice),
        gasLimit: 12_000_000n,
        value: 0,
        data: deployTx.data
    });

    const txHash = await rpc('eth_sendRawTransaction', [raw]);
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
        if (receipt) {
            if (receipt.status !== '0x1') {
                throw new Error(`deployment reverted, txHash=${txHash}`);
            }
            return {
                txHash,
                receipt,
                contractAddress: ethers.getAddress(receipt.contractAddress)
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`deployment receipt timeout, txHash=${txHash}`);
}

async function deployGatewayWithConsole(registryAddress, lightClientAddress) {
    const env = { ...process.env };
    const javaUserHome = process.env.FISCO_JAVA_USER_HOME || '/tmp/cross-chain-home';
    const userHomeFlag = `-Duser.home=${javaUserHome}`;
    env.FISCO_JAVA_USER_HOME = javaUserHome;
    env.HOME = javaUserHome;
    if (!env.JAVA_TOOL_OPTIONS || !env.JAVA_TOOL_OPTIONS.includes('-Duser.home=')) {
        env.JAVA_TOOL_OPTIONS = env.JAVA_TOOL_OPTIONS ? `${env.JAVA_TOOL_OPTIONS} ${userHomeFlag}` : userHomeFlag;
    }

    const { stdout, stderr } = await execFileAsync(
        path.join(CONSOLE_DIR, 'console.sh'),
        ['deploy', 'GatewayAir', registryAddress, lightClientAddress],
        {
            cwd: CONSOLE_DIR,
            env,
            timeout: 120_000,
            maxBuffer: 20 * 1024 * 1024
        }
    );
    const output = `${stdout || ''}\n${stderr || ''}`;
    const txHash = output.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/)?.[1] || '';
    const contractAddress = output.match(/contract address:\s*(0x[0-9a-fA-F]{40})/)?.[1] || '';
    if (!contractAddress) {
        throw new Error(`console GatewayAir deployment did not return a contract address: ${output.trim()}`);
    }
    return {
        txHash,
        receipt: null,
        contractAddress: ethers.getAddress(contractAddress)
    };
}

async function verifyDeployedCode(contractAddress) {
    let code = '';
    try {
        code = String(await rpc('eth_getCode', [contractAddress, 'latest']) || '').toLowerCase();
    } catch (_error) {
        const { stdout, stderr } = await execFileAsync(
            path.join(CONSOLE_DIR, 'console.sh'),
            ['getCode', contractAddress],
            {
                cwd: CONSOLE_DIR,
                env: process.env,
                timeout: 30_000,
                maxBuffer: 20 * 1024 * 1024
            }
        );
        code = String(stdout || stderr || '').toLowerCase();
    }
    for (const selector of EXPECTED_SELECTORS) {
        if (!code.includes(selector)) {
            throw new Error(`deployed bytecode missing selector ${selector}`);
        }
    }
    return code;
}

async function syncConsoleArtifacts({ abiPath, binPath, contractAddress }) {
    await fsp.mkdir(COMPILED_DIR, { recursive: true });
    await fsp.copyFile(abiPath, path.join(COMPILED_DIR, 'GatewayAir.abi'));
    await fsp.copyFile(binPath, path.join(COMPILED_DIR, 'GatewayAir.bin'));

    const groupName = resolveGroupName();
    const addressDir = path.join(COMPILED_DIR, groupName, 'GatewayAir', contractAddress);
    await fsp.mkdir(addressDir, { recursive: true });
    await fsp.copyFile(abiPath, path.join(addressDir, 'GatewayAir.abi'));
    await fsp.copyFile(binPath, path.join(addressDir, 'GatewayAir.bin'));
}

async function appendDeployLog(contractAddress) {
    const groupName = resolveGroupName();
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    await fsp.appendFile(
        DEPLOY_LOG_PATH,
        `${timestamp}  [group:${groupName}]  GatewayAir            ${contractAddress}\n`
    );
}

async function main() {
    const [registryAddress, lightClientAddress] = process.argv.slice(2);
    if (!registryAddress || !lightClientAddress) {
        throw new Error('usage: deploy_gatewayair_rpc.js <chainRegistryAddress> <lightClientAddress>');
    }

    const compiled = await compileGatewayAir();
    ensureExpectedAbi(compiled.abi, compiled.bytecode);
    let deployed;
    try {
        deployed = await deployCompiledGateway({
            abi: compiled.abi,
            bytecode: compiled.bytecode,
            registryAddress,
            lightClientAddress
        });
    } catch (_error) {
        deployed = await deployGatewayWithConsole(registryAddress, lightClientAddress);
    }
    await verifyDeployedCode(deployed.contractAddress);
    await syncConsoleArtifacts({
        abiPath: compiled.abiPath,
        binPath: compiled.binPath,
        contractAddress: deployed.contractAddress
    });
    await appendDeployLog(deployed.contractAddress);

    process.stdout.write(JSON.stringify({
        contractAddress: deployed.contractAddress,
        txHash: deployed.txHash,
        group: resolveGroupName(),
        abiPath: compiled.abiPath,
        binPath: compiled.binPath
    }));
}

main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
});
