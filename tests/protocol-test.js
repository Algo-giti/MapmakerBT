const assert = require('assert');
const P = require('../protocol.js');

assert.strictEqual(P.withChecksum('AT+S'), 'AT+S,0x13');
assert.strictEqual(P.withChecksum('AT+V'), 'AT+V,0x16');
assert.strictEqual(P.withChecksum('AT+M,0.15,0.00'), 'AT+M,0.15,0.00,0xe7');
assert.strictEqual(P.withChecksum('AT+M,0,0'), 'AT+M,0,0,0xc5');
assert.strictEqual(P.withChecksum('AT+C,1,-1'), 'AT+C,1,-1,0xea');
assert.strictEqual(P.withChecksum('AT+C,0,-1'), 'AT+C,0,-1,0xe9');
assert.strictEqual(P.withChecksum('AT+C,0,0'), 'AT+C,0,0,0xbb');
assert.strictEqual(P.withChecksum('AT+C,-1,-1,-1,-1,-1,-1,-1,-1,0'), 'AT+C,-1,-1,-1,-1,-1,-1,-1,-1,0,0xaf');
assert.strictEqual(P.withChecksum('AT+C,-1,-1,-1,-1,-1,-1,-1,-1,128'), 'AT+C,-1,-1,-1,-1,-1,-1,-1,-1,128,0x1a');
assert.strictEqual(P.withChecksum('AT+C,-1,-1,-1,-1,-1,-1,-1,-1,255'), 'AT+C,-1,-1,-1,-1,-1,-1,-1,-1,255,0x1b');
assert.strictEqual(P.deriveEncryptionKey('123456', 162), 12);
assert.strictEqual(P.encryptPrintable('AT+S,0x13', 12), 'M`7_8<%=?');

const simState = 'S,28.60,15.15,-10.24,2.02,2,2,0,0.25,0,15.70,-11.39,0.02,49,-0.05,48,-971195,0x92';
const parsed = P.parseState(simState);
assert.strictEqual(parsed.x, 15.15);
assert.strictEqual(parsed.y, -10.24);
assert.strictEqual(parsed.delta, 2.02);
assert.strictEqual(parsed.solution, 2);
assert.strictEqual(parsed.accuracy, 0.02);
assert.strictEqual(parsed.visibleSatellites, 49);
assert.strictEqual(parsed.visibleSatellitesDgps, 48);
assert.strictEqual(parsed.checksumValid, true);

console.log('protocol tests: OK');
