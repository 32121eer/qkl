/**
 * AgentDirectory - 链下安全目录管理
 *
 * 存储真实的 endpoint、sharedSecret、TLS 配置等敏感信息。
 * 链上合约只存身份哈希、公钥、信誉，具体连接信息存在这里。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR_PATH = path.join(__dirname, '../../.demo/agents/directory');
const FILE_MODE = 0o600; // 仅所有者可读写

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
}

function agentFilePath(dirPath, agentId) {
    const safeId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(dirPath, `${safeId}.json`);
}

function getMasterKey() {
    const key = process.env.DEMO_AGENT_DIRECTORY_MASTER_KEY;
    if (!key) return null;
    // 从 base64 或 hex 解码
    if (key.length === 64) return Buffer.from(key, 'hex');
    try {
        return Buffer.from(key, 'base64');
    } catch {
        return crypto.createHash('sha256').update(key).digest();
    }
}

function encryptField(plainText, masterKey) {
    if (!masterKey || !plainText) return plainText;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    return `enc:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

function decryptField(cipherText, masterKey) {
    if (!masterKey || !cipherText || !String(cipherText).startsWith('enc:')) return cipherText;
    const parts = String(cipherText).split(':');
    if (parts.length !== 4) return cipherText;
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const encrypted = parts[3];
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function maybeEncrypt(config, masterKey) {
    if (!masterKey) return config;
    const result = { ...config };
    if (result.sharedSecret) result.sharedSecret = encryptField(result.sharedSecret, masterKey);
    if (result.endpoint) result.endpoint = encryptField(result.endpoint, masterKey);
    return result;
}

function maybeDecrypt(config, masterKey) {
    if (!masterKey) return config;
    const result = { ...config };
    if (result.sharedSecret) result.sharedSecret = decryptField(result.sharedSecret, masterKey);
    if (result.endpoint) result.endpoint = decryptField(result.endpoint, masterKey);
    return result;
}

class AgentDirectory {
    constructor({ dirPath = null } = {}) {
        this.dirPath = dirPath || process.env.AGENT_DIRECTORY_PATH || DEFAULT_DIR_PATH;
        this.masterKey = getMasterKey();
        ensureDir(this.dirPath);
    }

    /**
     * 读取单个 Agent 配置
     */
    load(agentId) {
        const filePath = agentFilePath(this.dirPath, agentId);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const config = JSON.parse(raw);
            return maybeDecrypt(config, this.masterKey);
        } catch (error) {
            throw new Error(`Failed to load agent directory for ${agentId}: ${error.message}`);
        }
    }

    /**
     * 保存 Agent 配置
     */
    save(agentId, config) {
        const filePath = agentFilePath(this.dirPath, agentId);
        ensureDir(path.dirname(filePath));
        const toSave = maybeEncrypt({
            agentId,
            version: 1,
            createdAt: new Date().toISOString(),
            ...config
        }, this.masterKey);
        fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), { mode: FILE_MODE });
        return filePath;
    }

    /**
     * 检查是否存在
     */
    exists(agentId) {
        return fs.existsSync(agentFilePath(this.dirPath, agentId));
    }

    /**
     * 列出所有 Agent ID
     */
    list() {
        if (!fs.existsSync(this.dirPath)) return [];
        return fs.readdirSync(this.dirPath)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace(/\.json$/, ''));
    }

    /**
     * 删除配置
     */
    remove(agentId) {
        const filePath = agentFilePath(this.dirPath, agentId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    /**
     * 生成随机共享密钥（256-bit，base64 编码）
     */
    static generateSharedSecret() {
        return crypto.randomBytes(32).toString('base64');
    }
}

module.exports = { AgentDirectory };
