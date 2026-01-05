// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title GatewayContract for FISCO-BCOS (V2 - with Light Client Verification + Trusted Mode)
 * @dev Implements bidirectional cross-chain communication with optional verification
 */
contract GatewayAir {
    
    // 引用其他合约
    address public registryContract;
    address public lightClientContract;
    
    // 已处理的跨链消息（防止重放攻击）
    mapping(bytes32 => bool) public processedMessages;
    
    // 可信链：跳过轻客户端验证（用于 Fabric 等无 SPV 的链）
    mapping(string => bool) public trustedChains;
    
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
     */
    function receive(
        string memory sourceChainId,
        string memory sourceTxHash,
        uint64 sourceBlockNumber,
        bytes memory payload,
        bytes32[] memory merkleProof
    ) public {
        bytes32 messageId = keccak256(abi.encodePacked(
            sourceChainId,
            sourceTxHash,
            sourceBlockNumber
        ));
        
        require(!processedMessages[messageId], "Message already processed");
        
        // 对非可信链执行轻客户端验证
        if (!trustedChains[sourceChainId]) {
            bool blockVerified = ILightClient(lightClientContract).isBlockVerified(
                sourceChainId,
                sourceBlockNumber
            );
            require(blockVerified, "Source block not verified");

            bool txVerified = ILightClient(lightClientContract).verifyTransaction(
                sourceChainId,
                sourceBlockNumber,
                bytes32(bytes(sourceTxHash)),
                merkleProof
            );
            require(txVerified, "Transaction verification failed");
        }
        
        processedMessages[messageId] = true;
        emit MessageReceived(sourceChainId, sourceTxHash, payload, true);
        
        processPayload(payload);
    }
    
    /**
     * @dev 业务逻辑处理（示例）
     */
    function processPayload(bytes memory payload) internal {
        // 示例：可触发其他合约或记录日志
        // 实际业务由子合约或外部调用扩展
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
     * @dev 设置可信链（跳过验证）
     */
    function setTrustedChain(string memory chainId, bool trusted) public onlyAdmin {
        trustedChains[chainId] = trusted;
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

/**
 * @dev 轻客户端接口（需与你的 lightClientAir.sol 匹配）
 */
interface ILightClient {
    function isBlockVerified(string calldata chainId, uint64 blockNumber) external view returns (bool);
    function verifyTransaction(
        string calldata chainId,
        uint64 blockNumber,
        bytes32 txHash,
        bytes32[] calldata merkleProof
    ) external view returns (bool);
}