class BuiltinSqliteBackend {
    constructor(DatabaseSync, dbPath) {
        this.db = new DatabaseSync(dbPath);
    }

    async exec(sql) {
        this.db.exec(sql);
    }

    async run(sql, params = []) {
        const result = this.db.prepare(sql).run(...params);
        return { changes: Number(result.changes || 0), lastID: Number(result.lastInsertRowid || 0) };
    }

    async get(sql, params = []) {
        return this.db.prepare(sql).get(...params) || null;
    }

    async all(sql, params = []) {
        return this.db.prepare(sql).all(...params);
    }

    async close() {
        this.db.close();
    }
}

class PackageSqliteBackend {
    constructor(sqlite3, dbPath) {
        this.db = new sqlite3.Database(dbPath);
    }

    exec(sql) {
        return new Promise((resolve, reject) => this.db.exec(sql, (error) => (error ? reject(error) : resolve())));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function complete(error) {
                if (error) reject(error);
                else resolve({ changes: this.changes, lastID: this.lastID });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
        });
    }

    close() {
        return new Promise((resolve, reject) => this.db.close((error) => (error ? reject(error) : resolve())));
    }
}

function openSqliteDatabase(dbPath) {
    try {
        const { DatabaseSync } = require('node:sqlite');
        return new BuiltinSqliteBackend(DatabaseSync, dbPath);
    } catch (_builtinError) {
        // Node versions without node:sqlite use the dependency already declared by the relayer.
        const sqlite3 = require('sqlite3');
        return new PackageSqliteBackend(sqlite3, dbPath);
    }
}

module.exports = { openSqliteDatabase };
