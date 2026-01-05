// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title LightClientAir - 轻节点验证合约（简化版）
 * @dev 移除验证者签名依赖，仅验证区块连续性和基本结构
 */
contract LightClientAir {
    
    // 简化后的区块头结构（无 validatorSignatures 和 consensusProof）
    struct BlockHeader {
        string chainId;
        uint64 blockNumber;
        uint256 timestamp;
        bytes32 previousHash;
        bytes32 transactionsRoot;
        bytes32 stateRoot;
        string consensusType;   // 仅记录类型，不验证
        bytes extraData;
    }
    
    // 存储：chainId => blockNumber => blockHash
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
    
    function addRelayer(address relayer) public onlyAdmin {
        trustedRelayers[relayer] = true;
        emit RelayerAdded(relayer);
    }
    
    function removeRelayer(address relayer) public onlyAdmin {
        trustedRelayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }
    
    /**
     * @dev 提交区块头（简化参数）
     */
    function submitBlockHeader(
        string memory chainId,
        uint64 blockNumber,
        uint256 timestamp,
        bytes32 previousHash,
        bytes32 transactionsRoot,
        bytes32 stateRoot,
        string memory consensusType,
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
            consensusType: consensusType,
            extraData: extraData
        });
        
        // 计算区块哈希（不含 extraData 和 consensusType，保持一致性）
        bytes32 blockHash = keccak256(abi.encode(
            chainId,
            blockNumber,
            timestamp,
            previousHash,
            transactionsRoot,
            stateRoot
        ));
        
        // 共识验证跳过（简化版）
        // 实际生产环境建议根据 registry 中的链配置做基础校验
        
        // 存储
        blockHashes[chainId][blockNumber] = blockHash;
        blockHeaders[blockHash] = header;
        latestBlockNumber[chainId] = blockNumber;
        
        emit BlockHeaderSubmitted(chainId, blockNumber, blockHash, msg.sender);
        emit BlockHeaderVerified(chainId, blockNumber, blockHash);
        
        return blockHash;
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
    
    function getBlockHash(string memory chainId, uint64 blockNumber) 
        public 
        view 
        returns (bytes32) 
    {
        return blockHashes[chainId][blockNumber];
    }
    
    function getLatestBlockNumber(string memory chainId) 
        public 
        view 
        returns (uint64) 
    {
        return latestBlockNumber[chainId];
    }
    
    function isBlockVerified(string memory chainId, uint64 blockNumber) 
        public 
        view 
        returns (bool) 
    {
        return blockHashes[chainId][blockNumber] != bytes32(0);
    }
}