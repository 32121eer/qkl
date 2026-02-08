const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

class DemoSqliteStore {
    constructor({ dbPath, maxSessions = 1000 } = {}) {
        this.dbPath = dbPath || path.join(process.cwd(), '.demo', 'demo.db');
        this.maxSessions = maxSessions;
        ensureDir(path.dirname(this.dbPath));

        this.db = new sqlite3.Database(this.dbPath);
        this.db.serialize(() => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS query_sessions (
                    query_id TEXT PRIMARY KEY,
                    request_ts TEXT,
                    updated_at TEXT,
                    session_json TEXT NOT NULL
                )
            `);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_query_sessions_updated_at ON query_sessions(updated_at)`);
        });
    }

    close() {
        return new Promise((resolve) => this.db.close(resolve));
    }

    saveQuerySession(session) {
        const json = JSON.stringify(session);
        const queryId = session.queryId;
        const requestTs = session.requestTs || null;
        const updatedAt = session.updatedAt || new Date().toISOString();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO query_sessions(query_id, request_ts, updated_at, session_json) VALUES(?,?,?,?)`,
                [queryId, requestTs, updatedAt, json],
                (err) => {
                    if (err) return reject(err);

                    // Best-effort trimming.
                    this.db.all(
                        `SELECT query_id FROM query_sessions ORDER BY updated_at DESC LIMIT -1 OFFSET ?`,
                        [this.maxSessions],
                        (trimErr, rows) => {
                            if (!trimErr && Array.isArray(rows) && rows.length) {
                                const ids = rows.map((row) => row.query_id);
                                this.db.run(
                                    `DELETE FROM query_sessions WHERE query_id IN (${ids.map(() => '?').join(',')})`,
                                    ids,
                                    () => resolve(session)
                                );
                            } else {
                                resolve(session);
                            }
                        }
                    );
                }
            );
        });
    }

    getQuerySession(queryId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT session_json FROM query_sessions WHERE query_id = ?`,
                [queryId],
                (err, row) => {
                    if (err) return reject(err);
                    if (!row) return resolve(null);
                    try {
                        return resolve(JSON.parse(row.session_json));
                    } catch (parseError) {
                        return reject(parseError);
                    }
                }
            );
        });
    }

    async listQuerySessions(limit = 20) {
        const safeLimit = Math.max(1, Math.min(this.maxSessions, Number(limit) || 20));
        const rows = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT session_json FROM query_sessions ORDER BY updated_at DESC LIMIT ?`,
                [safeLimit],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result || []);
                }
            );
        });

        const items = [];
        for (const row of rows) {
            try {
                items.push(JSON.parse(row.session_json));
            } catch (_error) {
                // Skip corrupted rows.
            }
        }
        return items;
    }
}

module.exports = { DemoSqliteStore };

