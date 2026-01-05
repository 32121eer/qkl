// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title ChainRegistry - 链注册表合约
 * @dev 管理跨链网络中所有区块链的注册信息和身份验证
 */
contract ChainRegistry {
    
    // 链注册信息结构
    struct ChainInfo {
        string chainId;           // 链唯一标识
        string chainType;         // 链类型: "FABRIC", "FISCO_BCOS"
        string endpoint;          // RPC端点地址
        bytes publicKey;          // 链的公钥
        string consensusType;     // 共识类型
        uint256 registeredAt;     // 注册时间戳
        address[] validators;     // 验证者地址列表
        bytes certificate;        // CA证书
        string status;            // 状态: "ACTIVE", "SUSPENDED", "PENDING"
        bool exists;              // 是否存在
    }
    
    // 存储所有注册的链
    mapping(string => ChainInfo) public chains;
    string[] public chainIds;
    
    // 管理员地址
    address public admin;
    
    // 事件
    event ChainRegistered(string indexed chainId, string chainType, uint256 timestamp);
    event ChainStatusUpdated(string indexed chainId, string newStatus);
    event ValidatorAdded(string indexed chainId, address validator);
    event ValidatorRemoved(string indexed chainId, address validator);
    
    // 修饰符
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }
    
    modifier chainExists(string memory chainId) {
        require(chains[chainId].exists, "Chain not registered");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    /**
     * @dev 注册新链
     * @param chainId 链唯一标识
     * @param chainType 链类型
     * @param endpoint RPC端点
     * @param publicKey 公钥
     * @param consensusType 共识类型
     * @param certificate CA证书
     * @param validators 初始验证者列表
     */
    function registerChain(
        string memory chainId,
        string memory chainType,
        string memory endpoint,
        bytes memory publicKey,
        string memory consensusType,
        bytes memory certificate,
        address[] memory validators
    ) public onlyAdmin {
        require(!chains[chainId].exists, "Chain already registered");
        require(validators.length > 0, "At least one validator required");
        
        chains[chainId] = ChainInfo({
            chainId: chainId,
            chainType: chainType,
            endpoint: endpoint,
            publicKey: publicKey,
            consensusType: consensusType,
            registeredAt: block.timestamp,
            validators: validators,
            certificate: certificate,
            status: "ACTIVE",
            exists: true
        });
        
        chainIds.push(chainId);
        
        emit ChainRegistered(chainId, chainType, block.timestamp);
    }
    
    /**
     * @dev 更新链状态
     */
    function updateChainStatus(string memory chainId, string memory newStatus) 
        public 
        onlyAdmin 
        chainExists(chainId) 
    {
        chains[chainId].status = newStatus;
        emit ChainStatusUpdated(chainId, newStatus);
    }
    
    /**
     * @dev 添加验证者
     */
    function addValidator(string memory chainId, address validator) 
        public 
        onlyAdmin 
        chainExists(chainId) 
    {
        chains[chainId].validators.push(validator);
        emit ValidatorAdded(chainId, validator);
    }
    
    /**
     * @dev 移除验证者
     */
    function removeValidator(string memory chainId, address validator) 
        public 
        onlyAdmin 
        chainExists(chainId) 
    {
        address[] storage validators = chains[chainId].validators;
        for (uint i = 0; i < validators.length; i++) {
            if (validators[i] == validator) {
                validators[i] = validators[validators.length - 1];
                validators.pop();
                emit ValidatorRemoved(chainId, validator);
                break;
            }
        }
    }
    
    /**
     * @dev 获取链信息
     */
    function getChainInfo(string memory chainId) 
        public 
        view 
        chainExists(chainId)
        returns (
            string memory chainType,
            string memory endpoint,
            bytes memory publicKey,
            string memory consensusType,
            uint256 registeredAt,
            string memory status
        ) 
    {
        ChainInfo memory info = chains[chainId];
        return (
            info.chainType,
            info.endpoint,
            info.publicKey,
            info.consensusType,
            info.registeredAt,
            info.status
        );
    }
    
    /**
     * @dev 获取验证者列表
     */
    function getValidators(string memory chainId) 
        public 
        view 
        chainExists(chainId)
        returns (address[] memory) 
    {
        return chains[chainId].validators;
    }
    
    /**
     * @dev 验证链是否激活
     */
    function isChainActive(string memory chainId) public view returns (bool) {
        if (!chains[chainId].exists) {
            return false;
        }
        return keccak256(bytes(chains[chainId].status)) == keccak256(bytes("ACTIVE"));
    }
    
    /**
     * @dev 获取所有注册的链ID
     */
    function getAllChainIds() public view returns (string[] memory) {
        return chainIds;
    }
    
    /**
     * @dev 获取注册链的数量
     */
    function getChainCount() public view returns (uint256) {
        return chainIds.length;
    }
}
