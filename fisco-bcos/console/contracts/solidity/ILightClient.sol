// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface ILightClient {
    function verifyBlockHeader(
        string memory chainId,
        uint256 blockNumber,
        bytes memory blockHeader
    ) external view returns (bool);
    
    function getLatestBlockNumber(string memory chainId) external view returns (uint64);
}

