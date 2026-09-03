// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/**
 * @title SupplyChainEvidenceRegistry
 * @dev Minimal prototype registry for FISCO-side identity and logistics evidence.
 *      JSON payloads keep the experiment contract independent of one business schema.
 */
contract SupplyChainEvidenceRegistry {
    struct Record {
        string payloadJson;
        uint256 updatedAt;
        address submitter;
    }

    mapping(bytes32 => Record) private records;

    event EvidenceUpdated(
        string indexed category,
        string indexed recordId,
        bytes32 payloadHash,
        address submitter
    );

    function putRecord(
        string calldata category,
        string calldata recordId,
        string calldata payloadJson
    ) external {
        require(bytes(category).length > 0, "category required");
        require(bytes(recordId).length > 0, "record id required");
        require(bytes(payloadJson).length > 0, "payload required");

        bytes32 key = _key(category, recordId);
        records[key] = Record({
            payloadJson: payloadJson,
            updatedAt: block.timestamp,
            submitter: msg.sender
        });
        emit EvidenceUpdated(category, recordId, keccak256(bytes(payloadJson)), msg.sender);
    }

    function getRecord(
        string calldata category,
        string calldata recordId
    ) external view returns (string memory payloadJson) {
        Record storage record = records[_key(category, recordId)];
        require(bytes(record.payloadJson).length > 0, "record not found");
        return record.payloadJson;
    }

    function getRecordMeta(
        string calldata category,
        string calldata recordId
    ) external view returns (uint256 updatedAt, address submitter, bytes32 payloadHash) {
        Record storage record = records[_key(category, recordId)];
        require(bytes(record.payloadJson).length > 0, "record not found");
        return (record.updatedAt, record.submitter, keccak256(bytes(record.payloadJson)));
    }

    function _key(string memory category, string memory recordId) internal pure returns (bytes32) {
        return keccak256(abi.encode(category, recordId));
    }
}
