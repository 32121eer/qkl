const QUERY_PROOF_VERSION = 'query-proof-v1';
const RECORD_SNAPSHOT_WITNESS_TYPE = 'record-snapshot';
const DEFAULT_QUERY_CHAIN_ID = 'FABRIC_NET_01';
const DEFAULT_QUERY_NAMESPACE = 'orchard';
const DEFAULT_QUERY_TYPE = 'single-key-read';
const DEFAULT_QUERY_CODEC = 'json';
const DEFAULT_QUERY_CONTEXT = {
    channel: 'mychannel',
    chaincode: 'gateway_cc',
    schema: 'orchard-record-v1'
};
const DEFAULT_SOURCE_FUNCTION = 'GetOrchardRecord';
const PROTOTYPE_WITNESS_NOTE = 'prototype witness, not full merkle proof';

module.exports = {
    QUERY_PROOF_VERSION,
    RECORD_SNAPSHOT_WITNESS_TYPE,
    DEFAULT_QUERY_CHAIN_ID,
    DEFAULT_QUERY_NAMESPACE,
    DEFAULT_QUERY_TYPE,
    DEFAULT_QUERY_CODEC,
    DEFAULT_QUERY_CONTEXT,
    DEFAULT_SOURCE_FUNCTION,
    PROTOTYPE_WITNESS_NOTE
};
