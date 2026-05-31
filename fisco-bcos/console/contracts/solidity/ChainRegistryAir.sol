// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

contract ChainRegistryAir {
    struct ChainInfo {
        string status;
        string chainType;
        string consensusType;
        string rpcEndpoint;
        string chainPublicKey;   // 链管理方公钥（如部署者）
        string caPublicKey;      // CA 公钥（hex 格式）
        uint256 registeredAt;
        bool exists;
    }

    mapping(string => ChainInfo) public chains;
    string[] private _chainIdList;
    address public admin;

    // 声明所有事件
    event ChainRegistered(
        string indexed chainId,
        string status,
        string chainType,
        string consensusType,
        string rpcEndpoint,
        string chainPublicKey,
        string caPublicKey,
        uint256 registeredAt
    );

    event ChainStatusUpdated(string indexed chainId, string newStatus); // ← 关键修复！

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier chainExists(string memory chainId) {
        require(chains[chainId].exists, "Chain not found");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function registerChain(
        string memory chainId,
        string memory status,
        string memory chainType,
        string memory consensusType,
        string memory rpcEndpoint,
        string memory chainPublicKey,
        string memory caPublicKey
    ) public onlyAdmin {
        require(!chains[chainId].exists, "Already registered");
        require(bytes(status).length > 0, "Status required");
        require(bytes(chainType).length > 0, "ChainType required");
        require(bytes(consensusType).length > 0, "ConsensusType required");
        require(bytes(rpcEndpoint).length > 0, "RpcEndpoint required");
        require(bytes(chainPublicKey).length > 0, "ChainPublicKey required");
        require(bytes(caPublicKey).length > 0, "CaPublicKey required");

        uint256 nowTs = block.timestamp;

        chains[chainId] = ChainInfo({
            status: status,
            chainType: chainType,
            consensusType: consensusType,
            rpcEndpoint: rpcEndpoint,
            chainPublicKey: chainPublicKey,
            caPublicKey: caPublicKey,
            registeredAt: nowTs,
            exists: true
        });

        _chainIdList.push(chainId);

        emit ChainRegistered(
            chainId, status, chainType, consensusType,
            rpcEndpoint, chainPublicKey, caPublicKey, nowTs
        );
    }

    // 合并为单一 getChainInfo（返回所有字段）
    function getChainInfo(string memory chainId)
        public view chainExists(chainId)
        returns (
            string memory status,
            string memory chainType,
            string memory consensusType,
            string memory rpcEndpoint,
            string memory chainPublicKey,
            string memory caPublicKey,
            uint256 registeredAt
        )
    {
        ChainInfo storage info = chains[chainId];
        return (
            info.status,
            info.chainType,
            info.consensusType,
            info.rpcEndpoint,
            info.chainPublicKey,
            info.caPublicKey,
            info.registeredAt
        );
    }

    function updateChainStatus(string memory chainId, string memory newStatus)
        public onlyAdmin chainExists(chainId)
    {
        chains[chainId].status = newStatus;
        emit ChainStatusUpdated(chainId, newStatus);
    }

    function isChainActive(string memory chainId) public view returns (bool) {
        return chains[chainId].exists && 
               keccak256(abi.encodePacked(chains[chainId].status)) == 
               keccak256(abi.encodePacked("ACTIVE"));
    }

    /**
     * @dev 检查链是否已注册（供 GatewayAir 调用）
     */
    function isRegistered(string memory chainId) public view returns (bool) {
        return chains[chainId].exists;
    }

    function getAllChainIds() public view returns (string[] memory) {
        return _chainIdList;
    }
}