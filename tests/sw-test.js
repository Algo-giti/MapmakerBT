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
const assets = (sw.match(/const ASSETS = \[([^\]]*)\]/s) || [])[1] || '';
const shell = (sw.match(/const SHELL = \[([^\]]*)\]/s) || [])[1] || '';

test('Die Cache-Version steht an genau einer Stelle in sw.js', () => {
  assert.ok(swVersion, 'sw.js braucht APP_VERSION');
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
  assert.ok(/fetch\(event\.request, \{ cache: 'no-cache' \}\)/.test(branch),
    "ohne cache: 'no-cache' liefert der HTTP-Cache des Browsers bis zu max-age lang die alte Datei");
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
  assert.ok(sw.includes('clients.claim'), 'die aktivierte Fassung soll offene Seiten uebernehmen');
});

test('Die Version bleibt intern und taucht nirgends im UI auf', () => {
  // Bewusste Entscheidung des Nutzers: in der App ist keine Versionsnummer sichtbar.
  // Der Cache-Name in sw.js bleibt davon unberuehrt.
  assert.ok(!/APP_VERSION/.test(app), 'app.js darf keine Versionskonstante mehr fuehren');
  assert.ok(!/help-version/.test(html), 'kein Versions-Abzeichen in der Hilfe');
  assert.ok(!/\bv\d+\b/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'keine sichtbare Versionsangabe im Markup');
});

test('Ein Update wird auf der Hauptseite angeboten, nicht in der Diagnose', () => {
  assert.ok(/id="updateBar"/.test(html), 'Hinweisleiste fehlt');
  const bar = html.slice(html.indexOf('id="updateBar"'), html.indexOf('<header class="appbar">'));
  assert.ok(bar.includes('data-i18n="updateAvailable"'), 'Leiste braucht einen erklaerenden Text');
  assert.ok(!/checkUpdateBtn/.test(html), 'der Knopf in der Diagnose ist entfallen');
  assert.ok(app.includes('function watchForUpdates('), 'die App muss auf neue Fassungen horchen');
  assert.ok(app.includes("postMessage({ type: 'skipWaiting' })"), 'Tippen uebergibt an die wartende Fassung');
});

test('Die neue Fassung uebernimmt erst auf Tastendruck', () => {
  // Kommentare raus: dort steht bewusst, warum kein skipWaiting im install steht.
  const code = sw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const install = code.slice(code.indexOf("addEventListener('install'"), code.indexOf("addEventListener('activate'"));
  assert.ok(!install.includes('skipWaiting'),
    'ohne Wartestand wuerde die Seite ungefragt neu laden, mitten in der Aufnahme');
  assert.ok(/addEventListener\('message'[\s\S]*skipWaiting/.test(sw),
    'der Worker muss auf die Nachricht der App reagieren');
});

test('Ein Wechsel des Service Workers laedt die Seite einmal neu', () => {
  // Ohne das zeigt der erste Neuladevorgang nach einem Deploy noch die Dateien des alten,
  // cache-first arbeitenden Workers — der Nutzer muesste von Hand ein zweites Mal neu laden.
  assert.ok(app.includes("addEventListener('controllerchange'"), 'controllerchange wird nicht ausgewertet');
  assert.ok(app.includes('state.reloadingForUpdate'), 'ohne Merker droht eine Neulade-Schleife');
  assert.ok(/if \(navigator\.serviceWorker\.controller\)/.test(app),
    'beim allerersten Besuch gibt es noch keinen Controller — dann darf nicht neu geladen werden');
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
