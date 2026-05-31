// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title LightClient - 轻节点验证合约
 * @dev 验证和存储外部链的区块头，实现跨链消息验证
 */
contract LightClient {
    
    // 标准化区块头结构
    struct BlockHeader {
        string chainId;
        uint64 blockNumber;
        uint256 timestamp;
        bytes32 previousHash;
        bytes32 transactionsRoot;
        bytes32 stateRoot;
        bytes consensusProof;
        string consensusType;
        bytes[] validatorSignatures;
        bytes extraData;
    }
    
    // 存储每条链的最新区块头
    // chainId => blockNumber => blockHash
    mapping(string => mapping(uint64 => bytes32)) public blockHashes;
    
    // 每条链的最新区块高度
    mapping(string => uint64) public latestBlockNumber;
    
    // 区块头详细信息
    mapping(bytes32 => BlockHeader) public blockHeaders;
    
    // 信任的中继者地址
    mapping(address => bool) public trustedRelayers;
    
    // 管理员
    address public admin;
    
    // 引用注册表合约
    address public registryContract;
    
    // 事件
    event BlockHeaderSubmitted(
        string indexed chainId, 
        uint64 blockNumber, 
        bytes32 blockHash,
        address relayer
    );
    
    event BlockHeaderVerified(
        string indexed chainId,
        uint64 blockNumber,
        bytes32 blockHash
    );
    
    event RelayerAdded(address relayer);
    event RelayerRemoved(address relayer);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyTrustedRelayer() {
        require(trustedRelayers[msg.sender], "Not a trusted relayer");
        _;
    }
    
    constructor(address _registryContract) {
        admin = msg.sender;
        registryContract = _registryContract;
        trustedRelayers[msg.sender] = true;
    }
    
    /**
     * @dev 添加信任的中继者
     */
    function addRelayer(address relayer) public onlyAdmin {
        trustedRelayers[relayer] = true;
        emit RelayerAdded(relayer);
    }
    
    /**
     * @dev 移除中继者
     */
    function removeRelayer(address relayer) public onlyAdmin {
        trustedRelayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }
    
    /**
     * @dev 提交外部链的区块头
     * @param chainId 链ID
     * @param blockNumber 区块号
     * @param timestamp 时间戳
     * @param previousHash 前一区块哈希
     * @param transactionsRoot 交易根
     * @param stateRoot 状态根
     * @param consensusProof 共识证明
     * @param consensusType 共识类型
     * @param validatorSignatures 验证者签名
     * @param extraData 额外数据
     */
    function submitBlockHeader(
        string memory chainId,
        uint64 blockNumber,
        uint256 timestamp,
        bytes32 previousHash,
        bytes32 transactionsRoot,
        bytes32 stateRoot,
        bytes memory consensusProof,
        string memory consensusType,
        bytes[] memory validatorSignatures,
        bytes memory extraData
    ) public onlyTrustedRelayer returns (bytes32) {
        
        // 验证区块链式关系
        if (latestBlockNumber[chainId] > 0) {
            require(
                blockNumber == latestBlockNumber[chainId] + 1,
                "Block number must be sequential"
            );
            require(
                previousHash == blockHashes[chainId][latestBlockNumber[chainId]],
                "Previous hash mismatch"
            );
        }
        
        // 创建区块头
        BlockHeader memory header = BlockHeader({
            chainId: chainId,
            blockNumber: blockNumber,
            timestamp: timestamp,
            previousHash: previousHash,
            transactionsRoot: transactionsRoot,
            stateRoot: stateRoot,
            consensusProof: consensusProof,
            consensusType: consensusType,
            validatorSignatures: validatorSignatures,
            extraData: extraData
        });
        
        // 计算区块头哈希
        bytes32 blockHash = keccak256(abi.encode(
            chainId,
            blockNumber,
            timestamp,
            previousHash,
            transactionsRoot,
            stateRoot
        ));
        
        // 验证共识证明（简化版本，实际需要根据共识类型进行具体验证）
        require(verifyConsensusProof(header), "Invalid consensus proof");
        
        // 存储区块头
        blockHashes[chainId][blockNumber] = blockHash;
        blockHeaders[blockHash] = header;
        latestBlockNumber[chainId] = blockNumber;
        
        emit BlockHeaderSubmitted(chainId, blockNumber, blockHash, msg.sender);
        emit BlockHeaderVerified(chainId, blockNumber, blockHash);
        
        return blockHash;
    }
    
    /**
     * @dev 验证共识证明（简化版本）
     */
    function verifyConsensusProof(BlockHeader memory header) 
        internal 
        pure 
        returns (bool) 
    {
        // TODO: 实现具体的共识验证逻辑
        // - PBFT: 验证2f+1个签名
        // - RAFT: 验证Leader签名
        // - PoA: 验证授权节点签名
        
        // 目前简化为检查是否有签名
        return header.validatorSignatures.length > 0;
    }
    
    /**
     * @dev 验证交易是否在某个区块中（通过Merkle证明）
     */
    function verifyTransaction(
        string memory chainId,
        uint64 blockNumber,
        bytes32 txHash,
        bytes32[] memory merkleProof
    ) public view returns (bool) {
        bytes32 blockHash = blockHashes[chainId][blockNumber];
        require(blockHash != bytes32(0), "Block not found");
        
        BlockHeader memory header = blockHeaders[blockHash];
        
        // 验证Merkle证明
        return verifyMerkleProof(txHash, merkleProof, header.transactionsRoot);
    }
    
    /**
     * @dev 验证Merkle证明
     */
    function verifyMerkleProof(
        bytes32 leaf,
        bytes32[] memory proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            
            if (computedHash < proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        
        return computedHash == root;
    }
    
    /**
     * @dev 获取区块哈希
     */
    function getBlockHash(string memory chainId, uint64 blockNumber) 
        public 
        view 
        returns (bytes32) 
    {
        return blockHashes[chainId][blockNumber];
    }
    
    /**
     * @dev 获取最新区块号
     */
    function getLatestBlockNumber(string memory chainId) 
        public 
        view 
        returns (uint64) 
    {
        return latestBlockNumber[chainId];
    }
    
    /**
     * @dev 检查区块是否已验证
     */
    function isBlockVerified(string memory chainId, uint64 blockNumber) 
        public 
        view 
        returns (bool) 
    {
        return blockHashes[chainId][blockNumber] != bytes32(0);
    }
}

