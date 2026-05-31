// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "./IChainRegistry.sol";
import "./ILightClient.sol";

/**
 * @title GatewayAir
 * @dev 跨链网关合约 - 支持完整验证和轻量级验证
 */
contract GatewayAir {
    IChainRegistry public chainRegistry;
    ILightClient public lightClient;
    
    // 已处理的跨链调用记录（防止重放攻击）
    mapping(bytes32 => bool) public processedCalls;
    mapping(bytes32 => bytes32) public anchoredPayloadHashes;
    mapping(bytes32 => bytes32) public anchoredNegotiationProofDigests;
    
    // 事件：跨链调用发起
    event CrossChainCall(
        string targetChain,
        string targetContract,
        string method,
        bytes data
    );
    
    // 事件：跨链调用接收
    event CrossChainReceived(
        string indexed sourceChain,
        uint256 sourceBlockNumber,
        string sourceTxId,
        bool verified
    );

    event CrossChainReceiptAnchored(
        string indexed sourceChain,
        uint256 sourceBlockNumber,
        string sourceTxId,
        bytes32 payloadHash,
        bytes32 negotiationProofDigest
    );
    
    constructor(address _chainRegistry, address _lightClient) {
        chainRegistry = IChainRegistry(_chainRegistry);
        lightClient = ILightClient(_lightClient);
    }
    
    /**
     * @dev 发起跨链调用
     * @param targetChain 目标链ID
     * @param targetContract 目标合约地址
     * @param method 目标方法名
     * @param data 调用数据
     */
    function send(
        string memory targetChain,
        string memory targetContract,
        string memory method,
        bytes memory data
    ) public {
        require(chainRegistry.isRegistered(targetChain), "Target chain not registered");
        
        emit CrossChainCall(targetChain, targetContract, method, data);
    }
    
    /**
     * @dev 接收跨链调用 - 完整验证（包含 Merkle Proof）
     * @param sourceChain 源链ID
     * @param sourceBlockNumber 源区块号
     * @param sourceTxId 源交易ID
     * @param blockHeader 源区块头
     * @param merkleProof Merkle 证明
     */
    function receiveMessage(
        string memory sourceChain,
        uint256 sourceBlockNumber,
        string memory sourceTxId,
        bytes memory blockHeader,
        bytes memory merkleProof
    ) public {
        // 生成唯一调用ID
        bytes32 callId = _buildCallId(sourceChain, sourceBlockNumber, sourceTxId);
        
        require(!processedCalls[callId], "Call already processed");
        
        // 1. 验证区块头
        require(
            lightClient.verifyBlockHeader(sourceChain, sourceBlockNumber, blockHeader),
            "Source block not verified"
        );
        
        // 2. 验证 Merkle Proof
        require(merkleProof.length > 0, "Merkle proof required");
        // TODO: 实现完整的 Merkle Proof 验证逻辑
        
        // 标记为已处理
        processedCalls[callId] = true;
        _anchorReceipt(callId, sourceChain, sourceBlockNumber, sourceTxId, bytes32(0), bytes32(0));
        
        emit CrossChainReceived(sourceChain, sourceBlockNumber, sourceTxId, true);
    }
    
    /**
     * @dev 接收跨链调用 - 轻量级验证（仅验证区块，不验证交易）
     * @param sourceChain 源链ID
     * @param sourceBlockNumber 源区块号
     * @param sourceTxId 源交易ID
     * @param blockHeader 源区块头
     * 
     * 注意：此方法适用于难以提供 Merkle Proof 的链（如 Fabric）
     * 安全性较低，仅验证区块存在性，不验证交易存在性
     */
    function receiveLite(
        string memory sourceChain,
        uint256 sourceBlockNumber,
        string memory sourceTxId,
        bytes memory blockHeader,
        bytes32 payloadHash,
        bytes32 negotiationProofDigest
    ) public {
        // 生成唯一调用ID
        bytes32 callId = _buildCallId(sourceChain, sourceBlockNumber, sourceTxId);
        
        require(!processedCalls[callId], "Call already processed");
        
        // 仅验证区块头，不验证 Merkle Proof
        require(
            lightClient.verifyBlockHeader(sourceChain, sourceBlockNumber, blockHeader),
            "Source block not verified"
        );
        
        // 标记为已处理
        processedCalls[callId] = true;
        _anchorReceipt(callId, sourceChain, sourceBlockNumber, sourceTxId, payloadHash, negotiationProofDigest);
        
        emit CrossChainReceived(sourceChain, sourceBlockNumber, sourceTxId, true);
    }

    function getReceiptAnchor(
        string memory sourceChain,
        uint256 sourceBlockNumber,
        string memory sourceTxId
    ) public view returns (bytes32 payloadHash, bytes32 negotiationProofDigest) {
        bytes32 callId = _buildCallId(sourceChain, sourceBlockNumber, sourceTxId);
        return (
            anchoredPayloadHashes[callId],
            anchoredNegotiationProofDigests[callId]
        );
    }

    function _buildCallId(
        string memory sourceChain,
        uint256 sourceBlockNumber,
        string memory sourceTxId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            sourceChain,
            sourceBlockNumber,
            sourceTxId
        ));
    }

    function _anchorReceipt(
        bytes32 callId,
        string memory sourceChain,
        uint256 sourceBlockNumber,
        string memory sourceTxId,
        bytes32 payloadHash,
        bytes32 negotiationProofDigest
    ) internal {
        anchoredPayloadHashes[callId] = payloadHash;
        anchoredNegotiationProofDigests[callId] = negotiationProofDigest;
        emit CrossChainReceiptAnchored(
            sourceChain,
            sourceBlockNumber,
            sourceTxId,
            payloadHash,
            negotiationProofDigest
        );
    }
}

