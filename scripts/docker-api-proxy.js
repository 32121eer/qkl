#!/usr/bin/env node
// Docker API version proxy — rewrites old API version prefixes to a
// version accepted by the current Docker daemon (minimum 1.40 in Docker Desktop 29+).
//
// Usage: node scripts/docker-api-proxy.js [proxy-socket] [target-socket]
// Default: listens on /tmp/docker-api-proxy.sock, forwards to /var/run/docker.sock

'use strict';

const net = require('net');
const fs = require('fs');

const PROXY_SOCKET = process.argv[2] || '/tmp/docker-api-proxy.sock';
const TARGET_SOCKET = process.argv[3] || '/var/run/docker.sock';
const OLD_VERSION_RE = /\/v1\.(?:[12]\d|[0-9])\//g;  // v1.0–v1.29
const NEW_VERSION = '/v1.40/';

if (fs.existsSync(PROXY_SOCKET)) {
    try { fs.unlinkSync(PROXY_SOCKET); } catch (_) {}
}

const server = net.createServer((client) => {
    const upstream = net.createConnection(TARGET_SOCKET);

    client.on('data', (chunk) => {
        // Rewrite old Docker API version in HTTP request line.
        // Applies to all chunks (version prefix is always in the first bytes).
        const rewritten = chunk.toString('latin1').replace(OLD_VERSION_RE, NEW_VERSION);
        upstream.write(Buffer.from(rewritten, 'latin1'));
    });

    upstream.on('data', (chunk) => client.write(chunk));

    client.on('end', () => upstream.end());
    upstream.on('end', () => client.end());

    client.on('error', () => { try { upstream.destroy(); } catch (_) {} });
    upstream.on('error', () => { try { client.destroy(); } catch (_) {} });
});

server.listen(PROXY_SOCKET, () => {
    try { fs.chmodSync(PROXY_SOCKET, '0777'); } catch (_) {}
    console.log(`[docker-api-proxy] Listening on ${PROXY_SOCKET} → ${TARGET_SOCKET}`);
    console.log(`[docker-api-proxy] Rewriting old API versions to ${NEW_VERSION.slice(1, -1)}`);
});

server.on('error', (err) => {
    console.error('[docker-api-proxy] Server error:', err.message);
    process.exit(1);
});

process.on('SIGTERM', () => {
    server.close();
    try { fs.unlinkSync(PROXY_SOCKET); } catch (_) {}
    process.exit(0);
});
