'use strict';
// Startet alle Tests nacheinander: node tests/run-all.js
const { execFileSync } = require('child_process');
const path = require('path');

const files = ['protocol-test.js', 'app-core-test.js', 'ble-test.js', 'ui-test.js', 'layout-test.js', 'sw-test.js'];
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'app.js')]);
    execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  } catch (error) {
    failed += 1;
    console.error(`-> ${file} fehlgeschlagen`);
  }
}
if (failed) process.exit(1);
console.log('alle Tests: OK');
