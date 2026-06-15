// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

/**
 * @title AgentRegistryAir
 * @dev Lightweight on-chain Agent registry — paper §IV-B reproduction.
 *
 * Stores everything in flat mappings (no nested struct) to avoid the
 * "Stack too deep" error that the full AgentRegistry hits under FISCO
 * console's solcJ 0.8.11 without viaIR. Functionally equivalent for the
 * Relayer's bootstrapOnchainAgents() consumer: agentId, role, org,
 * strategyType, status are all we read.
 */
contract AgentRegistryAir {
    address public admin;

    // role: 0=NONE 1=COLLECTOR 2=VERIFIER 3=ARBITER 4=COORDINATOR 5=SUBMITTER
    // status: 0=INACTIVE 1=ACTIVE 2=SUSPENDED 3=REVOKED
    mapping(string => uint8)  public agentRole;
    mapping(string => uint8)  public agentStatus;
    mapping(string => string) public agentOrganization;
    mapping(string => string) public agentStrategyType;
    mapping(string => uint256) public agentReputation;       // scaled by 1000

    string[] public agentIdList;

    event AgentRegistered(string indexed agentId, uint8 role, string organization, string strategyType, uint256 ts);
    event AgentStatusChanged(string indexed agentId, uint8 oldStatus, uint8 newStatus, uint256 ts);
    event ReputationUpdated(string indexed agentId, int256 delta, uint256 newRep, uint256 ts);

    modifier onlyAdmin() { require(msg.sender == admin, "Only admin"); _; }

    constructor() { admin = msg.sender; }

    function registerAgent(
        string memory agentId,
        uint8 role,
        string memory organization,
        string memory strategyType
    ) public onlyAdmin {
        require(agentRole[agentId] == 0, "Agent already exists");
        require(role != 0, "Invalid role");
        require(bytes(organization).length > 0, "Organization required");

        agentRole[agentId] = role;
        agentStatus[agentId] = 1;                       // ACTIVE
        agentOrganization[agentId] = organization;
        agentStrategyType[agentId] = strategyType;
        agentReputation[agentId] = 500;                 // default 0.5
        agentIdList.push(agentId);

        emit AgentRegistered(agentId, role, organization, strategyType, block.timestamp);
    }

    function setStatus(string memory agentId, uint8 newStatus) public onlyAdmin {
        require(agentRole[agentId] != 0, "Agent not found");
        uint8 old = agentStatus[agentId];
        agentStatus[agentId] = newStatus;
        emit AgentStatusChanged(agentId, old, newStatus, block.timestamp);
    }

    function adjustReputation(string memory agentId, int256 delta) public onlyAdmin {
        require(agentRole[agentId] != 0, "Agent not found");
        uint256 cur = agentReputation[agentId];
        uint256 nw;
        if (delta >= 0) {
            nw = cur + uint256(delta);
            if (nw > 1000) nw = 1000;
        } else {
            uint256 d = uint256(-delta);
            nw = cur > d ? cur - d : 0;
            if (nw < 100) nw = 100;
        }
        agentReputation[agentId] = nw;
        emit ReputationUpdated(agentId, delta, nw, block.timestamp);
    }

    function getAgentCount() public view returns (uint256) {
        return agentIdList.length;
    }

    function getAgentIdAt(uint256 idx) public view returns (string memory) {
        return agentIdList[idx];
    }

    function getAgent(string memory agentId)
        public view
        returns (uint8 role, uint8 status, string memory organization, string memory strategyType, uint256 reputation)
    {
        role = agentRole[agentId];
        status = agentStatus[agentId];
        organization = agentOrganization[agentId];
        strategyType = agentStrategyType[agentId];
        reputation = agentReputation[agentId];
    }
}
