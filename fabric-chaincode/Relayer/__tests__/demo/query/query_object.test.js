const { buildQueryObject } = require('../../../demo/query/query_object');

describe('buildQueryObject', () => {
    test('same batch id produces same query object', () => {
        const left = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });
        const right = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });

        expect(left).toEqual(right);
    });

    test('different batch id produces different key', () => {
        const left = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });
        const right = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0002' });

        expect(left.key).not.toBe(right.key);
    });

    test('required fields exist', () => {
        expect(buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' })).toEqual({
            chainId: 'FABRIC_NET_01',
            namespace: 'orchard',
            key: 'batch:BATCH-APPLE-0001',
            queryType: 'single-key-read',
            codec: 'json',
            context: {
                channel: 'mychannel',
                chaincode: 'gateway_cc',
                schema: 'orchard-record-v1'
            }
        });
    });

    test('invalid batch id throws clear error', () => {
        expect(() => buildQueryObject({ orchardBatchId: '  ' })).toThrow(
            'orchardBatchId is required to build query object'
        );
    });
});
