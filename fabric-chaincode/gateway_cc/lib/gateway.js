'use strict';

const { Contract } = require('fabric-contract-api');

function lcLatestKey(chainId) {
    return `lc_latest::${chainId}`;
}

function lcHashKey(chainId, blockNumber) {
    return `lc_hash::${chainId}::${blockNumber}`;
}

function lcParentKey(chainId, blockNumber) {
    return `lc_parent::${chainId}::${blockNumber}`;
}

function lcHeaderKey(chainId, blockNumber) {
    return `lc_header::${chainId}::${blockNumber}`;
}

function orchardRecordKey(orchardBatchId) {
    return `orchard::${orchardBatchId}`;
}

function normalizeHex(v) {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    if (!s) return '';
    return (s.startsWith('0x') ? s : `0x${s}`).toLowerCase();
}

function isHexString(v) {
    return typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);
}

function decodeHexJson(hexStr) {
    if (!isHexString(hexStr) || hexStr.length < 3) {
        throw new Error('Invalid blockHeader hex');
    }
    const raw = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    const jsonStr = Buffer.from(raw, 'hex').toString('utf8');
    return JSON.parse(jsonStr);
}

class Gateway extends Contract {
    /**
     * 初始化 Chaincode
     */
    async InitLedger(ctx) {
        console.log('Gateway Chaincode initialized');
        return JSON.stringify({ status: 'success', message: 'Gateway initialized' });
    }

    /**
     * 发起跨链调用
     * @param {Context} ctx - 交易上下文
     * @param {string} targetChain - 目标链ID
     * @param {string} targetContract - 目标合约地址
     * @param {string} method - 目标方法名
     * @param {string} data - 调用数据（hex 字符串）
     */
    async Send(ctx, targetChain, targetContract, method, data) {
        console.log(`[Gateway.Send] Target: ${targetChain}/${targetContract}.${method}`);
        console.log(`[Gateway.Send] Data: ${data}`);

        const txId = ctx.stub.getTxID();
        const timestamp = ctx.stub.getTxTimestamp();

        // 构造跨链调用记录
        const crossChainCall = {
            txId: txId,
            timestamp: timestamp.seconds.low,
            sourceChain: 'FABRIC_NET_01',
            targetChain: targetChain,
            targetContract: targetContract,
            method: method,
            data: data
        };

        // 存储到账本
        const key = `crosschain_${txId}`;
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(crossChainCall)));

        // 触发跨链事件
        const eventPayload = {
            eventType: 'CrossChainCall',
            txId: txId,
            sourceChain: 'FABRIC_NET_01',
            targetChain: targetChain,
            targetContract: targetContract,
            method: method,
            data: data,
            destChain: targetChain  // 为了兼容性
        };

        ctx.stub.setEvent('CrossChainCall', Buffer.from(JSON.stringify(eventPayload)));

        console.log(`[Gateway.Send] CrossChainCall event emitted: ${JSON.stringify(eventPayload)}`);

        return JSON.stringify({
            status: 'success',
            txId: txId,
            message: 'Cross-chain call initiated'
        });
    }

    /**
     * 接收来自其他链的跨链消息
     * @param {Context} ctx - 交易上下文
     * @param {string} sourceChain - 源链ID
     * @param {string} sourceBlockNumber - 源区块号
     * @param {string} sourceTxId - 源交易ID
     * @param {string} blockHeader - 区块头（hex 字符串）
     * @param {string} data - 消息数据
     */
    /**
     * Submit a remote chain block header to Fabric world state (LightClient-lite).
     * Enforces sequential continuity: blockNumber must be latest+1 and previousHash must match previous blockHash.
     *
     * @param {Context} ctx
     * @param {string} headerJson - Standardized header JSON string (from Relayer)
     */
    async SubmitBlockHeader(ctx, headerJson) {
        let header;
        try {
            header = JSON.parse(headerJson);
        } catch (e) {
            throw new Error('Invalid headerJson');
        }

        const chainId = String(header.chainId || '').trim();
        if (!chainId) {
            throw new Error('Invalid header: missing chainId');
        }

        const blockNumber = Number(header.blockNumber);
        if (!Number.isInteger(blockNumber) || blockNumber < 0) {
            throw new Error('Invalid header: invalid blockNumber');
        }

        const blockHash = normalizeHex(header.blockHash);
        const previousHash = normalizeHex(header.previousHash);

        if (!isHexString(blockHash) || blockHash.length < 4) {
            throw new Error('Invalid header: missing blockHash');
        }
        if (!isHexString(previousHash) || previousHash.length < 4) {
            throw new Error('Invalid header: missing previousHash');
        }

        const latestKey = lcLatestKey(chainId);
        const hashKey = lcHashKey(chainId, blockNumber);

        // Idempotency: if the same block is already submitted, accept; otherwise reject.
        const existingHashBytes = await ctx.stub.getState(hashKey);
        if (existingHashBytes && existingHashBytes.length > 0) {
            const existingHash = normalizeHex(existingHashBytes.toString('utf8'));
            if (existingHash === blockHash) {
                return JSON.stringify({ status: 'success', skipped: true, chainId, blockNumber });
            }
            throw new Error('Header already exists with different hash');
        }

        const latestBytes = await ctx.stub.getState(latestKey);
        if (latestBytes && latestBytes.length > 0) {
            const latest = parseInt(latestBytes.toString('utf8').trim(), 10);
            if (Number.isNaN(latest) || latest < 0) {
                throw new Error('LightClient state corrupted: latest is invalid');
            }
            if (blockNumber !== latest + 1) {
                throw new Error(`Non-sequential header: expect ${latest + 1}, got ${blockNumber}`);
            }

            const prevHashBytes = await ctx.stub.getState(lcHashKey(chainId, latest));
            if (!prevHashBytes || prevHashBytes.length === 0) {
                throw new Error('LightClient state corrupted: previous hash missing');
            }
            const prevHash = normalizeHex(prevHashBytes.toString('utf8'));
            if (prevHash !== previousHash) {
                throw new Error('Parent hash mismatch');
            }
        }

        await ctx.stub.putState(hashKey, Buffer.from(blockHash));
        await ctx.stub.putState(lcParentKey(chainId, blockNumber), Buffer.from(previousHash));
        await ctx.stub.putState(lcHeaderKey(chainId, blockNumber), Buffer.from(JSON.stringify(header)));
        await ctx.stub.putState(latestKey, Buffer.from(String(blockNumber)));

        return JSON.stringify({ status: 'success', chainId, blockNumber });
    }

    /**
     * Get latest submitted (verified) block number for a remote chain.
     * Returns "-1" if none.
     */
    async GetLatestBlockNumber(ctx, chainId) {
        const id = String(chainId || '').trim();
        if (!id) {
            throw new Error('chainId is required');
        }
        const latestBytes = await ctx.stub.getState(lcLatestKey(id));
        if (!latestBytes || latestBytes.length === 0) {
            return '-1';
        }
        const latest = latestBytes.toString('utf8').trim();
        return latest || '-1';
    }

    /**
     * Get stored block hash for a remote chain at a given height.
     * Returns empty string if not found.
     */
    async GetBlockHash(ctx, chainId, blockNumber) {
        const id = String(chainId || '').trim();
        const n = Number(blockNumber);
        if (!id) {
            throw new Error('chainId is required');
        }
        if (!Number.isInteger(n) || n < 0) {
            throw new Error('blockNumber is invalid');
        }
        const hashBytes = await ctx.stub.getState(lcHashKey(id, n));
        if (!hashBytes || hashBytes.length === 0) {
            return '';
        }
        return hashBytes.toString('utf8').trim();
    }

    /**
     * Check if a block is verified (exists in LightClient-lite world state).
     * Returns "true" or "false".
     */
    async IsBlockVerified(ctx, chainId, blockNumber) {
        const id = String(chainId || '').trim();
        const n = Number(blockNumber);
        if (!id) {
            throw new Error('chainId is required');
        }
        if (!Number.isInteger(n) || n < 0) {
            throw new Error('blockNumber is invalid');
        }
        const hashBytes = await ctx.stub.getState(lcHashKey(id, n));
        return hashBytes && hashBytes.length > 0 ? 'true' : 'false';
    }

    async Receive(ctx, sourceChain, p2, p3, p4, p5) {
        // 兼容两种参数顺序：
        // 1) 推荐（JS 链码标准）：Receive(sourceChain, sourceBlockNumber, sourceTxId, blockHeaderHex, data)
        // 2) 旧版 Relayer：Receive(sourceChain, sourceTxHash, sourceBlockNumber, payload, merkleProofJSON)
        const looksLikeNumber = (v) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v));
        const looksLikeHex = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);

        let sourceBlockNumber;
        let sourceTxId;
        let blockHeader;
        let data;
        let merkleProof;

        if (looksLikeNumber(p2)) {
            // Receive(sourceChain, sourceBlockNumber, sourceTxId, blockHeader, data)
            sourceBlockNumber = p2;
            sourceTxId = p3;
            blockHeader = p4;
            data = p5;
        } else if (looksLikeNumber(p3) && looksLikeHex(p2)) {
            // Receive(sourceChain, sourceTxHash, sourceBlockNumber, payload, merkleProofJSON)
            sourceBlockNumber = p3;
            sourceTxId = p2;
            if (looksLikeHex(p4)) {
                blockHeader = p4;
                data = p5;
            } else {
                blockHeader = '0x00';
                data = p4;
                merkleProof = p5;
            }
        } else {
            // 兜底：尽量按推荐格式解析
            sourceBlockNumber = p2;
            sourceTxId = p3;
            blockHeader = p4;
            data = p5;
        }

        console.log(`[Gateway.Receive] From: ${sourceChain}, Block: ${sourceBlockNumber}, TxId: ${sourceTxId}`);
        console.log(`[Gateway.Receive] Data: ${data}`);

        const txId = ctx.stub.getTxID();
        const callId = `${sourceChain}_${sourceBlockNumber}_${sourceTxId}`;

        // 检查是否已处理
        const existingRecord = await ctx.stub.getState(callId);
        if (existingRecord && existingRecord.length > 0) {
            throw new Error(`Cross-chain call already processed: ${callId}`);
        }

        // TODO: 验证区块头（与 LightClient 集成）
        // 当前简化版本：仅记录

        // 构造接收记录
        // Strict mode: require the source block to be verified in LightClient-lite state.
        if (sourceChain && sourceChain !== 'FABRIC_NET_01') {
            try {
                if (!blockHeader || blockHeader === '0x00') {
                    throw new Error('missing header');
                }
                const headerObj = decodeHexJson(blockHeader);
                const headerChainId = String(headerObj.chainId || '').trim();
                const headerBlockNumber = Number(headerObj.blockNumber);
                const headerBlockHash = normalizeHex(headerObj.blockHash);

                const srcBlockNum = parseInt(String(sourceBlockNumber), 10);
                if (!headerChainId || headerChainId !== String(sourceChain)) {
                    throw new Error('chainId mismatch');
                }
                if (!Number.isInteger(headerBlockNumber) || headerBlockNumber !== srcBlockNum) {
                    throw new Error('blockNumber mismatch');
                }
                if (!isHexString(headerBlockHash) || headerBlockHash.length < 4) {
                    throw new Error('missing blockHash');
                }

                const verifiedHashBytes = await ctx.stub.getState(lcHashKey(sourceChain, srcBlockNum));
                if (!verifiedHashBytes || verifiedHashBytes.length === 0) {
                    throw new Error('not verified');
                }
                const verifiedHash = normalizeHex(verifiedHashBytes.toString('utf8'));
                if (verifiedHash !== headerBlockHash) {
                    throw new Error('hash mismatch');
                }
            } catch (e) {
                console.error(`[Gateway.Receive] Source block verification failed: ${e.message}`);
                throw new Error('Source block not verified');
            }
        }

        const receiveRecord = {
            callId: callId,
            sourceChain: sourceChain,
            sourceBlockNumber: parseInt(sourceBlockNumber),
            sourceTxId: sourceTxId,
            blockHeader: blockHeader,
            data: data,
            merkleProof: merkleProof,
            receivedAt: ctx.stub.getTxTimestamp().seconds.low,
            receivedTxId: txId
        };

        // 存储到账本
        await ctx.stub.putState(callId, Buffer.from(JSON.stringify(receiveRecord)));

        // 触发接收事件
        const eventPayload = {
            eventType: 'CrossChainReceived',
            callId: callId,
            sourceChain: sourceChain,
            sourceBlockNumber: parseInt(sourceBlockNumber),
            sourceTxId: sourceTxId
        };

        ctx.stub.setEvent('CrossChainReceived', Buffer.from(JSON.stringify(eventPayload)));

        console.log(`[Gateway.Receive] CrossChainReceived event emitted: ${JSON.stringify(eventPayload)}`);

        return JSON.stringify({
            status: 'success',
            callId: callId,
            message: 'Cross-chain message received'
        });
    }

    /**
     * 查询跨链调用记录
     * @param {Context} ctx - 交易上下文
     * @param {string} key - 记录key (txId 或 callId)
     */
    async PutOrchardRecord(ctx, orchardBatchId, payloadJson) {
        const batchId = String(orchardBatchId || '').trim();
        if (!batchId) {
            throw new Error('orchardBatchId is required');
        }
        const payloadText = String(payloadJson || '').trim();
        if (!payloadText) {
            throw new Error('payloadJson is required');
        }

        let payload;
        try {
            payload = JSON.parse(payloadText);
        } catch (_error) {
            throw new Error('payloadJson must be valid JSON');
        }

        const key = orchardRecordKey(batchId);
        const ts = ctx.stub.getTxTimestamp();
        const record = {
            orchardBatchId: batchId,
            payload,
            updatedAt: ts?.seconds ? Number(ts.seconds.low ?? ts.seconds) : null,
            updatedTxId: ctx.stub.getTxID()
        };

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(record)));
        ctx.stub.setEvent(
            'OrchardRecordUpserted',
            Buffer.from(JSON.stringify({ orchardBatchId: batchId, updatedTxId: record.updatedTxId }))
        );

        return JSON.stringify({
            status: 'success',
            orchardBatchId: batchId
        });
    }

    async GetOrchardRecord(ctx, orchardBatchId) {
        const batchId = String(orchardBatchId || '').trim();
        if (!batchId) {
            throw new Error('orchardBatchId is required');
        }

        const data = await ctx.stub.getState(orchardRecordKey(batchId));
        if (!data || data.length === 0) {
            throw new Error(`Orchard record not found: ${batchId}`);
        }
        return data.toString('utf8');
    }

    async ListOrchardRecords(ctx, limit, bookmark) {
        const parsed = parseInt(String(limit || '20'), 10);
        const pageSize = Number.isNaN(parsed) ? 20 : Math.max(1, Math.min(100, parsed));
        const pageBookmark = String(bookmark || '');

        const { iterator, metadata } = await ctx.stub.getStateByRangeWithPagination(
            'orchard::',
            'orchard::\uffff',
            pageSize,
            pageBookmark
        );

        const items = [];
        let result = await iterator.next();
        while (!result.done) {
            const value = result.value.value.toString('utf8');
            try {
                items.push(JSON.parse(value));
            } catch (_error) {
                items.push({ raw: value });
            }
            result = await iterator.next();
        }

        await iterator.close();
        return JSON.stringify({
            items,
            fetchedRecordsCount: Number(metadata?.fetchedRecordsCount || items.length),
            bookmark: metadata?.bookmark || ''
        });
    }

    async Query(ctx, key) {
        console.log(`[Gateway.Query] Key: ${key}`);

        // 尝试两种格式
        let data = await ctx.stub.getState(key);
        if (!data || data.length === 0) {
            data = await ctx.stub.getState(`crosschain_${key}`);
        }

        if (!data || data.length === 0) {
            throw new Error(`Record not found: ${key}`);
        }

        return data.toString();
    }

    /**
     * 查询所有跨链调用记录（分页）
     * @param {Context} ctx - 交易上下文
     * @param {string} startKey - 起始key
     * @param {string} endKey - 结束key
     */
    async QueryAll(ctx, startKey, endKey) {
        const iterator = await ctx.stub.getStateByRange(startKey || '', endKey || '');
        const results = [];

        let result = await iterator.next();
        while (!result.done) {
            const record = {
                key: result.value.key,
                value: JSON.parse(result.value.value.toString())
            };
            results.push(record);
            result = await iterator.next();
        }

        await iterator.close();
        return JSON.stringify(results);
    }
}

module.exports = Gateway;
