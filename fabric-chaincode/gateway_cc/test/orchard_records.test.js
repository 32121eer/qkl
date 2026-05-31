const test = require('node:test');
const assert = require('node:assert/strict');

const Gateway = require('../lib/gateway');

function createIterator(entries) {
    let index = 0;
    return {
        async next() {
            if (index >= entries.length) {
                return { done: true };
            }

            const [key, value] = entries[index];
            index += 1;
            return {
                done: false,
                value: {
                    key,
                    value: Buffer.from(value)
                }
            };
        },
        async close() {}
    };
}

function createContext() {
    const state = new Map();
    let txCounter = 0;
    let timestampSeconds = 1000;

    return {
        state,
        stub: {
            getTxTimestamp() {
                timestampSeconds += 1;
                return { seconds: timestampSeconds };
            },
            getTxID() {
                txCounter += 1;
                return `tx-${txCounter}`;
            },
            async putState(key, value) {
                state.set(key, Buffer.from(value));
            },
            async getState(key) {
                return state.get(key) || Buffer.alloc(0);
            },
            async getStateByRange(startKey, endKey) {
                const entries = Array.from(state.entries())
                    .filter(([key]) => key >= startKey && key < endKey)
                    .sort((left, right) => left[0].localeCompare(right[0]));
                return createIterator(entries);
            },
            setEvent() {}
        }
    };
}

test('PutOrchardRecord persists a record and ListOrchardRecords returns latest records first', async () => {
    const contract = new Gateway();
    const ctx = createContext();

    await contract.PutOrchardRecord(ctx, 'BATCH-0001', JSON.stringify({
        payloadVersion: '1.0',
        orchardBatchId: 'BATCH-0001',
        eventType: 'packed',
        eventAt: '2026-04-15T17:00:00+08:00',
        sourceSystem: 'test',
        data: { order: 1 }
    }));
    await contract.PutOrchardRecord(ctx, 'BATCH-0002', JSON.stringify({
        payloadVersion: '1.0',
        orchardBatchId: 'BATCH-0002',
        eventType: 'loaded',
        eventAt: '2026-04-15T17:01:00+08:00',
        sourceSystem: 'test',
        data: { order: 2 }
    }));

    const recordText = await contract.GetOrchardRecord(ctx, 'BATCH-0001');
    const record = JSON.parse(recordText);
    assert.equal(record.orchardBatchId, 'BATCH-0001');
    assert.equal(record.payload.data.order, 1);

    const listText = await contract.ListOrchardRecords(ctx, '10', '');
    const list = JSON.parse(listText);
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].orchardBatchId, 'BATCH-0002');
    assert.equal(list.items[1].orchardBatchId, 'BATCH-0001');
    assert.equal(list.bookmark, '');
});

test('ListOrchardRecords supports bookmark paging', async () => {
    const contract = new Gateway();
    const ctx = createContext();

    for (const id of ['BATCH-0001', 'BATCH-0002', 'BATCH-0003']) {
        await contract.PutOrchardRecord(ctx, id, JSON.stringify({
            payloadVersion: '1.0',
            orchardBatchId: id,
            eventType: 'synced',
            eventAt: '2026-04-15T17:00:00+08:00',
            sourceSystem: 'test',
            data: { id }
        }));
    }

    const firstPage = JSON.parse(await contract.ListOrchardRecords(ctx, '2', ''));
    assert.deepEqual(firstPage.items.map((item) => item.orchardBatchId), ['BATCH-0003', 'BATCH-0002']);
    assert.equal(firstPage.bookmark, 'BATCH-0002');

    const secondPage = JSON.parse(await contract.ListOrchardRecords(ctx, '2', firstPage.bookmark));
    assert.deepEqual(secondPage.items.map((item) => item.orchardBatchId), ['BATCH-0001']);
    assert.equal(secondPage.bookmark, '');
});
