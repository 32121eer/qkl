#!/usr/bin/env node
// Compile AgentRegistry.sol with solc + optimizer + viaIR and write the
// resulting .bin / .abi files into the FISCO console's compile cache so
// `console.sh deploy AgentRegistry` can use them (avoids the console's
// own solcJ which hits "Stack too deep").

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'fisco-bcos/console/contracts/solidity');
const COMPILED_DIR = path.join(PROJECT_ROOT, 'fisco-bcos/console/contracts/.compiled');

const sources = {};
for (const file of ['AgentRegistry.sol', 'Crypto.sol']) {
    sources[file] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8') };
}
const input = {
    language: 'Solidity',
    sources,
    settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        evmVersion: 'istanbul',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
if (errs.length) {
    for (const e of errs) console.error(e.formattedMessage);
    process.exit(1);
}
const c = out.contracts['AgentRegistry.sol']['AgentRegistry'];
fs.mkdirSync(COMPILED_DIR, { recursive: true });
fs.writeFileSync(path.join(COMPILED_DIR, 'AgentRegistry.bin'), c.evm.bytecode.object);
fs.writeFileSync(path.join(COMPILED_DIR, 'AgentRegistry.abi'), JSON.stringify(c.abi));
console.log(`bin: ${path.join(COMPILED_DIR, 'AgentRegistry.bin')} (${c.evm.bytecode.object.length / 2} bytes)`);
console.log(`abi: ${path.join(COMPILED_DIR, 'AgentRegistry.abi')} (${c.abi.length} entries)`);
