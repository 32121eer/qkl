const fs = require('node:fs');
const path = require('node:path');
const { verifyAuditReceipt } = require('./audit_receipt');
const { openSqliteDatabase } = require('./sqlite_backend');

function ensureParent(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

class SemanticAuditStore {
    constructor({ dbPath } = {}) {
        this.dbPath = dbPath || path.join(process.cwd(), '.demo', 'semantic-audit.db');
        ensureParent(this.dbPath);
        this.db = openSqliteDatabase(this.dbPath);
        this._writeTail = Promise.resolve();
        this.ready = this._exec(`
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS audit_queries (
                query_id TEXT PRIMARY KEY,
                schema_version TEXT NOT NULL,
                query_digest TEXT NOT NULL,
                dag_version TEXT NOT NULL,
                root_node_id TEXT NOT NULL,
                terminal_state TEXT NOT NULL,
                outcome TEXT,
                receipt_root TEXT NOT NULL,
                conflicts_json TEXT NOT NULL,
                recoveries_json TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_nodes (
                query_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                node_json TEXT NOT NULL,
                PRIMARY KEY(query_id, node_id),
                FOREIGN KEY(query_id) REFERENCES audit_queries(query_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS audit_evidence (
                query_id TEXT NOT NULL,
                evidence_id TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                PRIMARY KEY(query_id, evidence_id),
                FOREIGN KEY(query_id) REFERENCES audit_queries(query_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS audit_service_outputs (
                query_id TEXT NOT NULL,
                output_id TEXT NOT NULL,
                output_json TEXT NOT NULL,
                PRIMARY KEY(query_id, output_id),
                FOREIGN KEY(query_id) REFERENCES audit_queries(query_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS audit_events (
                query_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                event_json TEXT NOT NULL,
                PRIMARY KEY(query_id, seq),
                FOREIGN KEY(query_id) REFERENCES audit_queries(query_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS audit_anchors (
                query_id TEXT NOT NULL,
                anchor_id TEXT NOT NULL,
                receipt_root TEXT NOT NULL,
                chain_id TEXT,
                tx_hash TEXT,
                block_height INTEGER,
                anchor_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(query_id, anchor_id),
                FOREIGN KEY(query_id) REFERENCES audit_queries(query_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_audit_query_completed ON audit_queries(completed_at);
            CREATE INDEX IF NOT EXISTS idx_audit_anchor_root ON audit_anchors(receipt_root);
        `);
    }

    _exec(sql) {
        return this.db.exec(sql);
    }

    _run(sql, params = []) {
        return this.db.run(sql, params);
    }

    _get(sql, params = []) {
        return this.db.get(sql, params);
    }

    _all(sql, params = []) {
        return this.db.all(sql, params);
    }

    _enqueueWrite(operation) {
        const queued = this._writeTail.then(operation);
        this._writeTail = queued.catch(() => undefined);
        return queued;
    }

    saveReceipt(receipt, anchor = null) {
        return this._enqueueWrite(() => this._saveReceipt(receipt, anchor));
    }

    async _saveReceipt(receipt, anchor = null) {
        await this.ready;
        const verification = verifyAuditReceipt(receipt);
        if (!verification.ok) {
            throw new Error(`Refusing invalid audit receipt: ${verification.issues.map((item) => item.code).join(',')}`);
        }

        await this._run('BEGIN IMMEDIATE');
        try {
            await this._run('DELETE FROM audit_queries WHERE query_id = ?', [receipt.queryId]);
            await this._run(
                `INSERT INTO audit_queries(
                    query_id, schema_version, query_digest, dag_version, root_node_id,
                    terminal_state, outcome, receipt_root, conflicts_json, recoveries_json,
                    started_at, completed_at, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    receipt.queryId, receipt.schemaVersion, receipt.queryDigest, receipt.dagVersion,
                    receipt.rootNodeId, receipt.terminalState, receipt.outcome, receipt.receiptRoot,
                    JSON.stringify(receipt.conflicts || []), JSON.stringify(receipt.recoveries || []),
                    receipt.startedAt, receipt.completedAt, new Date().toISOString()
                ]
            );
            for (const node of receipt.nodes || []) {
                await this._run(
                    'INSERT INTO audit_nodes(query_id,node_id,node_json) VALUES(?,?,?)',
                    [receipt.queryId, node.nodeId, JSON.stringify(node)]
                );
            }
            for (const evidence of receipt.evidence || []) {
                await this._run(
                    'INSERT INTO audit_evidence(query_id,evidence_id,evidence_json) VALUES(?,?,?)',
                    [receipt.queryId, evidence.evidenceId, JSON.stringify(evidence)]
                );
            }
            for (const output of receipt.serviceOutputs || []) {
                await this._run(
                    'INSERT INTO audit_service_outputs(query_id,output_id,output_json) VALUES(?,?,?)',
                    [receipt.queryId, output.serviceOutputId, JSON.stringify(output)]
                );
            }
            for (let index = 0; index < (receipt.events || []).length; index += 1) {
                const event = { ...receipt.events[index], seq: Number(receipt.events[index].seq ?? index) };
                await this._run(
                    'INSERT INTO audit_events(query_id,seq,event_json) VALUES(?,?,?)',
                    [receipt.queryId, event.seq, JSON.stringify(event)]
                );
            }
            if (anchor) await this._insertAnchor(receipt.queryId, receipt.receiptRoot, anchor);
            await this._run('COMMIT');
            return receipt;
        } catch (error) {
            await this._run('ROLLBACK');
            throw error;
        }
    }

    async _insertAnchor(queryId, receiptRoot, anchor) {
        const normalized = {
            ...anchor,
            anchorId: anchor.anchorId || `${anchor.chainId || 'local'}:${anchor.txHash || receiptRoot}`,
            chainId: anchor.chainId || null,
            txHash: anchor.txHash || null,
            blockHeight: anchor.blockHeight ?? null,
            anchoredAt: anchor.anchoredAt || new Date().toISOString(),
            mode: anchor.mode || 'external'
        };
        await this._run(
            `INSERT OR REPLACE INTO audit_anchors(
                query_id,anchor_id,receipt_root,chain_id,tx_hash,block_height,anchor_json,created_at
            ) VALUES(?,?,?,?,?,?,?,?)`,
            [
                queryId, normalized.anchorId, receiptRoot, normalized.chainId, normalized.txHash,
                normalized.blockHeight, JSON.stringify(normalized), normalized.anchoredAt
            ]
        );
        return normalized;
    }

    recordAnchor(queryId, receiptRoot, anchor) {
        return this._enqueueWrite(() => this._recordAnchor(queryId, receiptRoot, anchor));
    }

    async _recordAnchor(queryId, receiptRoot, anchor) {
        await this.ready;
        const query = await this._get('SELECT receipt_root FROM audit_queries WHERE query_id = ?', [queryId]);
        if (!query) throw new Error(`Unknown audit query '${queryId}'`);
        if (query.receipt_root !== receiptRoot) throw new Error('Anchor root does not match stored receipt root');
        return this._insertAnchor(queryId, receiptRoot, anchor);
    }

    async loadReceipt(queryId) {
        await this.ready;
        const query = await this._get('SELECT * FROM audit_queries WHERE query_id = ?', [queryId]);
        if (!query) return null;
        const [nodes, evidence, serviceOutputs, events] = await Promise.all([
            this._all('SELECT node_json FROM audit_nodes WHERE query_id = ? ORDER BY node_id', [queryId]),
            this._all('SELECT evidence_json FROM audit_evidence WHERE query_id = ? ORDER BY evidence_id', [queryId]),
            this._all('SELECT output_json FROM audit_service_outputs WHERE query_id = ? ORDER BY output_id', [queryId]),
            this._all('SELECT event_json FROM audit_events WHERE query_id = ? ORDER BY seq', [queryId])
        ]);
        return {
            schemaVersion: query.schema_version,
            queryId: query.query_id,
            queryDigest: query.query_digest,
            dagVersion: query.dag_version,
            rootNodeId: query.root_node_id,
            terminalState: query.terminal_state,
            outcome: query.outcome,
            nodes: nodes.map((row) => JSON.parse(row.node_json)),
            evidence: evidence.map((row) => JSON.parse(row.evidence_json)),
            serviceOutputs: serviceOutputs.map((row) => JSON.parse(row.output_json)),
            conflicts: JSON.parse(query.conflicts_json),
            recoveries: JSON.parse(query.recoveries_json),
            events: events.map((row) => JSON.parse(row.event_json)),
            startedAt: query.started_at,
            completedAt: query.completed_at,
            receiptRoot: query.receipt_root
        };
    }

    async listAnchors(queryId) {
        await this.ready;
        const rows = await this._all(
            'SELECT anchor_json,receipt_root FROM audit_anchors WHERE query_id = ? ORDER BY created_at',
            [queryId]
        );
        return rows.map((row) => ({ ...JSON.parse(row.anchor_json), receiptRoot: row.receipt_root }));
    }

    async verifyStoredReceipt(queryId, anchoredRoot = null) {
        const receipt = await this.loadReceipt(queryId);
        if (!receipt) return { ok: false, issues: [{ code: 'MISSING_RECEIPT' }] };
        return verifyAuditReceipt(receipt, { anchoredRoot });
    }

    async close() {
        await this.ready;
        return this.db.close();
    }
}

module.exports = { SemanticAuditStore };
