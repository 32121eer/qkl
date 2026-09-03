#!/usr/bin/env node
'use strict';

const { deployContract } = require('./deploy-semantic-audit-anchor');

if (require.main === module) {
    deployContract('SupplyChainEvidenceRegistry')
        .then((result) => {
            process.stdout.write(`${JSON.stringify({
                contractAddress: result.contractAddress,
                configField: 'chains[FISCO_BCOS].contracts.supplyChainEvidence'
            }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}
