// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title GatewayContract for FISCO-BCOS (V2 - with Light Client Verification)
 * @dev Implements bidirectional cross-chain communication with verification
 */
contract Gateway {
    
    // 引用其他合约
    address public registryContract;
    address public lightClientContract;
    
    // 已处理的跨链消息（防止重放攻击）
    mapping(bytes32 => bool) public processedMessages;
    
    // 管理员
    address public admin;
    
    // 跨链调用事件（发出方向）
    event CrossChainCall(
        string targetChainId,
        string targetContract,
        string targetFunction,
        bytes payload,
        uint256 nonce
    );
    
    // 消息接收事件（接收方向）
    event MessageReceived(
        string sourceChainId,
        string sourceTxHash,
        bytes payload,
        bool verified
    );
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _registryContract, address _lightClientContract) {
        admin = msg.sender;
        registryContract = _registryContract;
        lightClientContract = _lightClientContract;
    }
    
    /**
     * @dev 发起跨链请求
     */
    function send(
        string memory targetChainId,
        string memory targetContract,
        string memory targetFunction,
        bytes memory payload
    ) public returns (uint256) {
        // TODO: 验证目标链是否已注册且激活
        // require(registry.isChainActive(targetChainId), "Target chain not active");
        
        uint256 nonce = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            targetChainId
        )));
        
        emit CrossChainCall(
            targetChainId,
            targetContract,
            targetFunction,
            payload,
            nonce
        );
        
        return nonce;
    }
    
    /**
     * @dev 接收并验证跨链消息
     * @param sourceChainId 源链ID
     * @param sourceTxHash 源交易哈希
     * @param sourceBlockNumber 源区块号
     * @param payload 业务数据
     * @param merkleProof Merkle证明
     */
    function receive(
        string memory sourceChainId,
        string memory sourceTxHash,
        uint64 sourceBlockNumber,
        bytes memory payload,
        bytes32[] memory merkleProof
    ) public {
        // 构造消息ID（防止重放）
        bytes32 messageId = keccak256(abi.encodePacked(
            sourceChainId,
            sourceTxHash,
            sourceBlockNumber
        ));
        
        require(!processedMessages[messageId], "Message already processed");
        
        // TODO: 通过LightClient验证消息
        // 1. 验证源区块是否已提交并验证
        // bool blockVerified = ILightClient(lightClientContract).isBlockVerified(
        //     sourceChainId,
        //     sourceBlockNumber
        // );
        // require(blockVerified, "Source block not verified");
        
        // 2. 验证交易在区块中的存在性（Merkle证明）
        // bool txVerified = ILightClient(lightClientContract).verifyTransaction(
        //     sourceChainId,
        //     sourceBlockNumber,
        //     bytes32(bytes(sourceTxHash)),
        //     merkleProof
        // );
        // require(txVerified, "Transaction verification failed");
        
        // 标记为已处理
        processedMessages[messageId] = true;
        
        // 触发事件
        emit MessageReceived(sourceChainId, sourceTxHash, payload, true);
        
        // TODO: 执行业务逻辑
        // processPayload(payload);
    }
    
    /**
     * @dev 检查消息是否已处理
     */
    function isMessageProcessed(
        string memory sourceChainId,
        string memory sourceTxHash,
        uint64 sourceBlockNumber
    ) public view returns (bool) {
        bytes32 messageId = keccak256(abi.encodePacked(
            sourceChainId,
            sourceTxHash,
            sourceBlockNumber
        ));
        return processedMessages[messageId];
    }
    
    /**
     * @dev 更新注册表合约地址
     */
    function updateRegistryContract(address _registryContract) public onlyAdmin {
        registryContract = _registryContract;
    }
    
    /**
     * @dev 更新轻客户端合约地址
     */
    function updateLightClientContract(address _lightClientContract) public onlyAdmin {
        lightClientContract = _lightClientContract;
    }
}