'use strict';
// Gemeinsamer Loader fuer alle app.js-Tests: laedt die App per vm in einen Sandkasten
// mit DOM-Stubs, optional mit virtueller Uhr und injiziertem Fake-BLE-Adapter.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

function elementStub(id) {
  const el = {
    id, textContent: '', innerHTML: '', value: '', checked: true, disabled: false, hidden: false,
    scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
  };
  return el;
}

function loadApp(options = {}) {
  const { clock = null, bleAdapter = null, exportNames = [] } = options;
  const elements = new Map();
  const documentStub = {
    documentElement: { lang: 'de' },
    getElementById(id) { if (!elements.has(id)) elements.set(id, elementStub(id)); return elements.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return elementStub(); },
    createElementNS() { return elementStub(); },
    addEventListener() {},
    body: { appendChild() {} },
    hidden: false,
  };
  const localStore = new Map();

  const sandbox = {
    console, structuredClone, TextEncoder, TextDecoder, Blob, DataView, Uint8Array, ArrayBuffer,
    crypto: require('crypto').webcrypto,
    document: documentStub,
    window: { isSecureContext: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    navigator: { bluetooth: undefined, onLine: true },
    localStorage: { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    alert() {}, confirm() { return true; },
  };

  if (clock) {
    Object.assign(sandbox, clock.globals);
    // Date.now() an die virtuelle Uhr binden; new Date(...) bleibt unveraendert nutzbar.
    const RealDate = Date;
    class VirtualDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock.now()])); }
      static now() { return clock.now(); }
    }
    sandbox.Date = VirtualDate;
  }
  if (bleAdapter) sandbox.__bleAdapter = bleAdapter;

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // protocol.js wird im Browser per <script> vor app.js geladen.
  const protocolSource = fs.readFileSync(path.join(__dirname, '..', 'protocol.js'), 'utf8');
  vm.runInContext(protocolSource, sandbox, { filename: 'protocol.js' });

  let source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // Auto-Start (init()) abschneiden: Tests steuern den Ablauf selbst.
  source = source.replace(/init\(\)\.catch\([\s\S]*?\n\}\);\s*$/, '');
  if (exportNames.length) source += `\n;globalThis.__test = { ${exportNames.join(', ')} };`;

  vm.runInContext(source, sandbox, { filename: 'app.js' });

  return { sandbox, elements, t: sandbox.__test, ui: sandbox.__test && sandbox.__test.ui };
}

module.exports = { loadApp, elementStub };
