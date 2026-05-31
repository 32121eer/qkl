const { buildQueryObject } = require('../../../demo/query/query_object');
const { buildQueryCommitment, stableStringify } = require('../../../demo/query/query_commitment');

describe('query commitment', () => {
    const queryObject = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });
    const sourceHeaderHash = '0xheaderhash';
    const resultValue = { found: true, record: { orchardBatchId: 'BATCH-APPLE-0001' } };

    test('stableStringify sorts object keys', () => {
        expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });

    test('same inputs produce same commitment', () => {
        const left = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue,
            meta: { schema: 'orchard-record-v1' }
        });
        const right = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue,
            meta: { schema: 'orchard-record-v1' }
        });

        expect(left.value).toBe(right.value);
    });

    test('result change produces different commitment', () => {
        const left = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue
        });
        const right = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue: { found: false, record: null }
        });

        expect(left.value).not.toBe(right.value);
    });

    test('source height change produces different commitment', () => {
        const left = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue
        });
        const right = buildQueryCommitment({
            queryObject,
            sourceHeight: 124,
            sourceHeaderHash,
            resultValue
        });

        expect(left.value).not.toBe(right.value);
    });

    test('query object change produces different commitment', () => {
        const left = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue
        });
        const right = buildQueryCommitment({
            queryObject: buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0002' }),
            sourceHeight: 123,
            sourceHeaderHash,
            resultValue
        });

        expect(left.value).not.toBe(right.value);
        expect(left.version).toBe('query-proof-v1');
    });
});
