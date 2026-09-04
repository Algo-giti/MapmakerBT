'use strict';
// Regressionstest fuer die Auslieferung.
//
// Der Service Worker war cache-first mit festem Cache-Namen. Folge: korrigierte Dateien lagen
// zwar auf GitHub Pages, das Geraet zeigte aber weiter die alte Version — Fehler galten als
// "nicht behoben", obwohl der Fix laengst deployt war. Dieser Test haelt die Auslieferung
// pruefbar: App-Dateien network-first, Versionsnummer an einer Stelle, nichts vergessen.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

const swVersion = (sw.match(/const APP_VERSION = '([^']+)'/) || [])[1];
const appVersion = (app.match(/const APP_VERSION = '([^']+)'/) || [])[1];
const assets = (sw.match(/const ASSETS = \[([^\]]*)\]/s) || [])[1] || '';
const shell = (sw.match(/const SHELL = \[([^\]]*)\]/s) || [])[1] || '';

test('Version steht in sw.js und app.js und stimmt ueberein', () => {
  assert.ok(swVersion, 'sw.js braucht APP_VERSION');
  assert.ok(appVersion, 'app.js braucht APP_VERSION');
  assert.strictEqual(swVersion, appVersion, 'sonst laeuft der Cache-Name der App davon');
  assert.ok(sw.includes('const CACHE = `mapcreator-ardumower-${APP_VERSION}`'),
    'der Cache-Name muss aus APP_VERSION gebildet werden, sonst wird das Erhoehen wieder vergessen');
});

test('Die App-Dateien werden network-first ausgeliefert', () => {
  for (const file of ['index.html', 'styles.css', 'app.js', 'protocol.js']) {
    assert.ok(shell.includes(file), `${file} fehlt in SHELL`);
    assert.ok(sw.includes(file.replace('.', '\\.')) || sw.includes(file),
      `${file} muss auch von isShellRequest() erkannt werden`);
  }
  const branch = sw.slice(sw.indexOf('if (isShellRequest('), sw.indexOf('return;', sw.indexOf('if (isShellRequest(')));
  assert.ok(branch.includes('fetch('), 'der Shell-Zweig muss das Netz fragen');
  assert.ok(branch.indexOf('fetch(') < branch.indexOf('caches.match('),
    'network-first: erst fetch(), der Cache ist nur die Rueckfallebene');
  assert.ok(branch.includes('.catch('), 'ohne Netz muss der Cache einspringen (Offline-Betrieb)');
});

test('Der Cache wird beim Aufbau nicht aus dem HTTP-Cache befuellt', () => {
  assert.ok(sw.includes("cache: 'reload'"),
    "addAll muss mit cache: 'reload' laufen, sonst landen alte Dateien im neuen Cache");
});

test('Alle von index.html geladenen Dateien stehen in ASSETS', () => {
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  const cached = `${shell} ${assets}`; // ASSETS baut auf SHELL auf
  const missing = [...new Set(refs)].filter((ref) => !cached.includes(ref));
  assert.deepStrictEqual(missing, [], `nicht im Offline-Cache: ${missing.join(', ')}`);
});

test('Alter Cache-Bestand wird beim Aktivieren entfernt', () => {
  assert.ok(sw.includes('caches.keys()') && sw.includes('caches.delete('),
    'sonst sammeln sich Caches der Vorversionen an');
  assert.ok(sw.includes('skipWaiting') && sw.includes('clients.claim'),
    'neue Version soll ohne zweiten Neustart uebernehmen');
});

test('Die laufende Version steht im Diagnoseprotokoll', () => {
  assert.ok(/log\(tr\('appStarted'\), APP_VERSION\)/.test(app),
    'sonst laesst sich auf dem Geraet nicht ablesen, welcher Stand laeuft');
});

let failed = 0;
for (const c of cases) {
  try { c.fn(); } catch (error) {
    failed += 1;
    console.error(`FAIL ${c.name}\n     ${error.message}`);
    if (process.env.SW_TEST_STACK) console.error(error.stack);
  }
}
if (failed) { console.error(`sw tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
console.log(`sw tests: OK (${cases.length} Faelle)`);
