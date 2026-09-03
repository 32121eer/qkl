// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/**
 * @title SemanticQueryAuditAnchor
 * @dev Stores one immutable audit-receipt commitment for each semantic query.
 *      Full evidence, execution traces and service outputs remain off-chain.
 */
contract SemanticQueryAuditAnchor {
    struct ReceiptAnchor {
        bytes32 queryDigest;
        bytes32 receiptRoot;
        uint8 terminalState;
        uint8 outcome;
        uint256 blockNumber;
        address submitter;
    }

    mapping(bytes32 => ReceiptAnchor) private receiptAnchors;

    event ReceiptAnchored(
        bytes32 indexed qid,
        bytes32 indexed queryDigest,
        bytes32 receiptRoot,
        uint8 terminalState,
        uint8 outcome,
        address submitter
    );

    function anchorReceipt(
        bytes32 qid,
        bytes32 queryDigest,
        bytes32 receiptRoot,
        uint8 terminalState,
        uint8 outcome
    ) external {
        require(qid != bytes32(0), "qid required");
        require(queryDigest != bytes32(0), "query digest required");
        require(receiptRoot != bytes32(0), "receipt root required");
        require(receiptAnchors[qid].receiptRoot == bytes32(0), "receipt already anchored");
        require(terminalState >= 1 && terminalState <= 3, "invalid terminal state");
        require(outcome <= 3, "invalid outcome");

        receiptAnchors[qid] = ReceiptAnchor({
            queryDigest: queryDigest,
            receiptRoot: receiptRoot,
            terminalState: terminalState,
            outcome: outcome,
            blockNumber: block.number,
            submitter: msg.sender
        });

        emit ReceiptAnchored(
            qid,
            queryDigest,
            receiptRoot,
            terminalState,
            outcome,
            msg.sender
        );
    }

    function getReceipt(bytes32 qid) external view returns (ReceiptAnchor memory) {
        return receiptAnchors[qid];
    }

    function isAnchored(bytes32 qid) external view returns (bool) {
        return receiptAnchors[qid].receiptRoot != bytes32(0);
    }
}
