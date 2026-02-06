// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface IChainRegistry {
    function isRegistered(string memory chainId) external view returns (bool);
    function getChainInfo(string memory chainId) external view returns (string memory, string memory);
}

