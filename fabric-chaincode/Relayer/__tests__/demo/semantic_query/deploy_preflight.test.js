const path = require('node:path');
const {
    readConsolePeer,
    bundledNodeFormat
} = require('../../../scripts/deploy-semantic-audit-anchor');

describe('FISCO deployment preflight', () => {
    const consoleDir = path.resolve(__dirname, '../../../../fisco-bcos/console');

    test('reads the SDK peer selected by the console', () => {
        expect(readConsolePeer(consoleDir)).toMatchObject({ host: '127.0.0.1', port: 20203 });
    });

    test('identifies that the bundled node cannot run natively on macOS', () => {
        expect(bundledNodeFormat(consoleDir)).toMatchObject({ format: 'linux-elf' });
    });
});
