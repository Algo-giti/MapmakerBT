'use strict';
// Gemeinsamer Loader fuer alle app.js-Tests: laedt die App per vm in einen Sandkasten
// mit DOM-Stubs, optional mit virtueller Uhr und injiziertem Fake-BLE-Adapter.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

function elementStub(id) {
  const el = {
    id, textContent: '', value: '', checked: true, disabled: false, hidden: false,
    scrollTop: 0, scrollHeight: 0, dataset: {}, children: [],
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
    classes: new Set(),
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, append() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  // Kinder und innerHTML mitfuehren, damit Tests gezeichnete Elemente pruefen koennen.
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => inner,
    set: (value) => { inner = value; if (value === '') el.children.length = 0; },
  });
  el.appendChild = (child) => { el.children.push(child); return child; };
  // Echte Klassenliste: die UI-Tests pruefen Zustaende ueber CSS-Klassen.
  el.classList = {
    add(...names) { names.forEach((n) => el.classes.add(n)); },
    remove(...names) { names.forEach((n) => el.classes.delete(n)); },
    toggle(name, force) { const on = force === undefined ? !el.classes.has(name) : Boolean(force); if (on) el.classes.add(name); else el.classes.delete(name); return on; },
    contains(name) { return el.classes.has(name); },
  };
  return el;
}

function loadApp(options = {}) {
  const { clock = null, bleAdapter = null, exportNames = [], missingIds = [] } = options;
  const elements = new Map();
  // Simuliert fehlende Elemente, z. B. eine aeltere index.html aus dem Cache.
  const missing = new Set(missingIds);
  const documentStub = {
    documentElement: (() => {
      const attrs = new Map();
      return {
        lang: 'de',
        style: (() => {
          const props = new Map();
          return {
            props,
            setProperty(name, value) { props.set(name, String(value)); },
            getPropertyValue(name) { return props.get(name) ?? ''; },
            removeProperty(name) { props.delete(name); },
          };
        })(),
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        removeAttribute(name) { attrs.delete(name); },
      };
    })(),
    getElementById(id) {
      if (missing.has(id)) return null;
      if (!elements.has(id)) elements.set(id, elementStub(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return elementStub(); },
    createElementNS() {
      // SVG-Knoten merken sich Attribute und Kinder, damit Tests die Zeichnung pruefen koennen.
      const el = elementStub();
      el.attributes = {};
      el.setAttribute = (name, value) => { el.attributes[name] = String(value); };
      el.getAttribute = (name) => (name in el.attributes ? el.attributes[name] : null);
      el.appendChild = (child) => { el.children.push(child); return child; };
      return el;
    },
    addEventListener() {},
    body: elementStub('body'),
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
  // Rueckfragen laufen ueber askConfirm(); der Adapter beantwortet sie automatisch, damit
  // Tests ohne Klick auskommen. Steuerung: sandbox.__confirmAnswer, Rueckschau: __lastConfirm.
  sandbox.__confirmAdapter = (request) => {
    sandbox.__lastConfirm = request.message;
    sandbox.__lastConfirmRequest = request;
    return sandbox.__confirmAnswer !== false;
  };

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
