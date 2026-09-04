'use strict';
// Tests fuer die Kartier-Oberflaeche (v17): Modus-Chip, Punktaufnahme, Auswahl per Tap,
// Verschieben/Loeschen, Zoom-Grenzen, Joystick-Kennlinie und RTK-Badge.
// Laeuft ohne Browser gegen die DOM-Stubs aus app-harness.js.

const assert = require('assert');
const { loadApp } = require('./app-harness.js');
const { createClock } = require('./virtual-clock.js');
const { createFakeBluetooth } = require('./fake-ble.js');

const EXPORTS = ['state', 'ui', 'setMode', 'cycleMode', 'modeLabel', 'CAPTURE_MODES', 'addCurrentPoint', 'undoPoint',
  'deleteSelectedPoint', 'handleMapTap', 'applyPointSelection', 'clearPointSelection', 'refreshCaptureState',
  'renderMap', 'resetViewport', 'clampViewport', 'activeTransform', 'toScreen', 'svgMetrics', 'beginCustomViewport',
  'updateRtkBadge', 'setMenuOpen', 'onMapPointerDown', 'onMapPointerMove', 'onMapPointerUp', 'beginCaptureHold', 'cancelCaptureHold', 'driveSpeedLimits', 'joystickVectorFromPointer', 'makeMap', 'normalizeMap',
  'MIN_USER_ZOOM', 'MAX_USER_ZOOM', 'init'];

/** Minimaler IndexedDB-Ersatz, damit saveActiveMap() im Test durchlaeuft. */
function fakeDb() {
  const rows = new Map();
  const request = (result) => { const r = { result }; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r; };
  const store = {
    put(value) { rows.set(value.id, value); return request(value); },
    delete(id) { rows.delete(id); return request(undefined); },
    getAll() { return request([...rows.values()]); },
  };
  return { transaction: () => ({ objectStore: () => store }) };
}

function setup() {
  const clock = createClock();
  const fake = createFakeBluetooth({ clock });
  const { t, elements, sandbox } = loadApp({ clock, bleAdapter: fake.adapter, exportNames: EXPORTS });
  t.state.db = fakeDb();
  t.state.activeMap = t.normalizeMap(t.makeMap('Test'));
  t.state.maps = [t.state.activeMap];
  t.ui.fixOnly.checked = false;
  t.state.telemetry = {
    x: 2, y: 3, delta: 0, solution: 2, age: 0.1, accuracy: 0.02,
    visibleSatellites: 35, visibleSatellitesDgps: 42, batteryVoltage: 27.5, receivedAt: clock.now(),
  };
  t.setMode('perimeter');
  return { clock, fake, t, elements, sandbox };
}

/** Rechnet viewBox-Koordinaten in einen Zeiger-Event um (SVG-Stub: 300x300 px). */
function tapAt(t, vx, vy) {
  const m = t.svgMetrics();
  return { clientX: vx * m.scale + m.offX, clientY: vy * m.scale + m.offY };
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('Moduswahl schaltet Perimeter → Ausschluss → Wegpunkt → Dock', () => {
  const { t } = setup();
  assert.deepStrictEqual([...t.CAPTURE_MODES], ['perimeter', 'exclusion', 'waypoint', 'dock']);
  const seen = [];
  for (let i = 0; i < 4; i += 1) { seen.push(t.state.mode); t.cycleMode(); }
  assert.deepStrictEqual(seen, ['perimeter', 'exclusion', 'waypoint', 'dock']);
  assert.strictEqual(t.state.mode, 'perimeter', 'nach dem letzten Modus wieder von vorn');
  t.setMode('waypoint');
  assert.strictEqual(t.ui.modeChipLabel.textContent, 'Wegpunkte');
});

test('Punkt aufnehmen und Undo im Wegpunkt-Modus', async () => {
  const { t } = setup();
  t.setMode('waypoint');
  await t.addCurrentPoint();
  assert.strictEqual(t.state.activeMap.waypoints.length, 1);
  assert.strictEqual(t.state.activeMap.waypoints[0].x, 2);
  await t.undoPoint();
  assert.strictEqual(t.state.activeMap.waypoints.length, 0);
});

test('Tap auf einen Punkt waehlt ihn aus, Tap ins Leere hebt die Auswahl auf', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.renderMap();
  const screen = t.toScreen({ x: 4, y: 0 }, t.state.currentTransform);
  t.handleMapTap(tapAt(t, screen.x, screen.y));
  assert.ok(t.state.selectedPoint, 'Punkt muss ausgewaehlt sein');
  assert.strictEqual(t.state.selectedPoint.role, 'perimeter');
  assert.strictEqual(t.state.selectedPoint.index, 1);
  assert.strictEqual(t.ui.deletePointBtn.hidden, false, 'Loeschwerkzeug wird sichtbar');
  assert.ok(t.ui.addPointBtn.classList.contains('move-mode'), 'Hauptbutton wechselt zu Verschieben');

  t.handleMapTap(tapAt(t, screen.x + 400, screen.y + 250));
  assert.strictEqual(t.state.selectedPoint, null);
  assert.strictEqual(t.ui.deletePointBtn.hidden, true);
  assert.ok(!t.ui.addPointBtn.classList.contains('move-mode'));
});


test('Kurzes Tippen waehlt aus, Ziehen verschiebt die Karte statt auszuwaehlen', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  t.renderMap();
  const screen = t.toScreen({ x: 4, y: 0 }, t.state.currentTransform);
  const at = tapAt(t, screen.x, screen.y);

  // Tap: gleiche Position bei down und up.
  t.onMapPointerDown({ ...at, pointerId: 1, type: 'pointerdown' });
  t.onMapPointerUp({ ...at, pointerId: 1, type: 'pointerup' });
  assert.ok(t.state.selectedPoint, 'kurzes Tippen waehlt den Punkt aus');

  t.clearPointSelection();
  // Ziehen: deutlich ueber der 8-px-Schwelle.
  t.onMapPointerDown({ ...at, pointerId: 2, type: 'pointerdown' });
  t.onMapPointerMove({ clientX: at.clientX + 40, clientY: at.clientY + 25, pointerId: 2, type: 'pointermove' });
  t.onMapPointerUp({ clientX: at.clientX + 40, clientY: at.clientY + 25, pointerId: 2, type: 'pointerup' });
  assert.strictEqual(t.state.selectedPoint, null, 'Ziehen darf nichts auswaehlen');
  assert.strictEqual(t.state.viewport.custom, true, 'Ziehen schaltet auf eigene Ansicht um');
  assert.ok(t.state.viewport.dx > 0 && t.state.viewport.dy > 0, 'die Karte ist mitgewandert');
  assert.strictEqual(t.ui.fitViewBtn.hidden, false, 'Zuruecksetzen-Knopf erscheint');
});

test('Pinch mit zwei Fingern zoomt', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
  t.renderMap();
  t.onMapPointerDown({ clientX: 100, clientY: 150, pointerId: 1, type: 'pointerdown' });
  t.onMapPointerDown({ clientX: 140, clientY: 150, pointerId: 2, type: 'pointerdown' });
  t.onMapPointerMove({ clientX: 60, clientY: 150, pointerId: 1, type: 'pointermove' });
  t.onMapPointerMove({ clientX: 180, clientY: 150, pointerId: 2, type: 'pointermove' });
  assert.ok(t.state.viewport.zoom > 1.5, `Zoom sollte deutlich steigen, ist ${t.state.viewport.zoom}`);
  assert.ok(t.state.viewport.zoom <= t.MAX_USER_ZOOM);
  t.onMapPointerUp({ clientX: 60, clientY: 150, pointerId: 1, type: 'pointerup' });
  t.onMapPointerUp({ clientX: 180, clientY: 150, pointerId: 2, type: 'pointerup' });
  assert.strictEqual(t.state.selectedPoint, null, 'Pinch waehlt keinen Punkt aus');
});


test('Laufende Halteaktion überlebt eine Telemetrie-Aktualisierung', () => {
  const { t } = setup();
  t.refreshCaptureState();
  t.beginCaptureHold({ pointerId: 1, preventDefault() {} });
  assert.ok(t.state.captureHold, 'Halten laeuft');
  t.refreshCaptureState(); // wie bei jeder AT+S-Antwort
  assert.ok(t.state.captureHold, 'Telemetrie darf das Halten nicht abbrechen');
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }];
  t.refreshCaptureState();
  assert.strictEqual(t.state.captureHold, null, 'Auswahl beendet das Halten');
  t.cancelCaptureHold();
});

test('Trefferflaeche der Punkte ist mindestens 44x44 px', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 40, y: 40 }];
  t.renderMap();
  const px = t.state.hitRadiusUnits * t.svgMetrics().scale;
  assert.ok(px >= 22, `Trefferradius ${px.toFixed(1)} px muss >= 22 px sein`);
});

test('Mit Auswahl verschiebt ein Tap den Punkt auf die Maeherposition', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 9, y: 9 }];
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.addCurrentPoint();
  assert.strictEqual(t.state.activeMap.perimeter[1].x, 2);
  assert.strictEqual(t.state.activeMap.perimeter[1].y, 3);
  assert.strictEqual(t.state.activeMap.perimeter.length, 2, 'kein neuer Punkt');
  assert.strictEqual(t.state.selectedPoint, null, 'Auswahl wird danach aufgehoben');
});

test('Loeschwerkzeug entfernt genau den ausgewaehlten Punkt', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.deleteSelectedPoint();
  assert.strictEqual(t.state.activeMap.perimeter.length, 2);
  assert.deepStrictEqual(t.state.activeMap.perimeter.map((p) => p.x), [0, 2]);
  assert.strictEqual(t.state.selectedPoint, null);
});

test('Zoom bleibt zwischen Min und Max, die Karte kann nicht aus dem Bild geschoben werden', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  t.renderMap();
  t.beginCustomViewport();
  t.state.viewport.zoom = 999; t.clampViewport();
  assert.strictEqual(t.state.viewport.zoom, t.MAX_USER_ZOOM);
  t.state.viewport.zoom = 0.01; t.clampViewport();
  assert.strictEqual(t.state.viewport.zoom, t.MIN_USER_ZOOM);
  t.state.viewport.zoom = 1;
  t.state.viewport.dx = 99999; t.state.viewport.dy = -99999; t.clampViewport();
  assert.ok(t.state.viewport.dx <= 800 - 50 && t.state.viewport.dy >= 140 - 630);
  t.resetViewport({ render: false });
  assert.strictEqual(t.state.viewport.custom, false);
  assert.strictEqual(t.ui.fitViewBtn.hidden, true);
});

test('Joystick: Auslenkung bestimmt die Geschwindigkeit zwischen Min und Max', () => {
  const { t } = setup();
  t.state.view.driveSpeedMin = 0.10;
  t.state.view.driveSpeedMax = 0.30;
  const { min, max } = t.driveSpeedLimits();
  assert.strictEqual(min, 0.10);
  assert.strictEqual(max, 0.30);
  // Stub-Joystick: 300x300 px, Mitte (150,150), Radius 116.
  const full = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 - 116 });
  assert.ok(Math.abs(full.linear - max) < 1e-9, 'voller Ausschlag = Maximum');
  const half = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 - 58 });
  assert.ok(half.linear > min && half.linear < max, 'halber Ausschlag liegt dazwischen');
  const back = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 + 116 });
  assert.ok(Math.abs(back.linear + max) < 1e-9, 'rueckwaerts spiegelt die Kennlinie');
  const dead = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 });
  assert.ok(dead.linear === 0, 'Totzone liefert keinen Vortrieb');
  assert.ok(dead.angular === 0, 'Totzone liefert keine Drehung');
});

test('RTK-Badge zeigt Zustand und Satelliten als Mäher/Station', () => {
  const { t } = setup();
  t.updateRtkBadge();
  assert.strictEqual(t.ui.rtkText.textContent, 'Fix');
  assert.strictEqual(t.ui.rtkSats.textContent, '35/42');
  assert.ok(t.ui.rtkBadge.classList.contains('fix'));
  t.state.telemetry.solution = 1; t.updateRtkBadge();
  assert.strictEqual(t.ui.rtkText.textContent, 'Float');
  assert.ok(t.ui.rtkBadge.classList.contains('float'));
  t.state.telemetry.solution = 0; t.updateRtkBadge();
  assert.strictEqual(t.ui.rtkText.textContent, 'No Fix');
  assert.ok(t.ui.rtkBadge.classList.contains('nofix'));
  t.state.telemetry.receivedAt = 0; t.updateRtkBadge();
  assert.ok(t.ui.rtkBadge.classList.contains('no-data'));
  assert.strictEqual(t.ui.rtkSats.textContent, '–/–');
});

test('Menueseite ist eine eigene Vollbildseite und stoppt die Fahrt', () => {
  const { t } = setup();
  t.setMenuOpen(false);
  assert.strictEqual(t.ui.menuPage.hidden, true, 'Menue startet geschlossen');
  t.state.driveDirection = 'joystick';
  t.setMenuOpen(true);
  assert.strictEqual(t.ui.menuPage.hidden, false);
  assert.strictEqual(t.state.menuOpen, true);
  assert.strictEqual(t.state.driveDirection, null, 'Menue oeffnen stoppt die Fahrt');
  t.setMenuOpen(false);
  assert.strictEqual(t.ui.menuPage.hidden, true);
});

test('Gesperrte Karte blockiert Aufnahme und Loeschwerkzeug', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }];
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.addPointBtn.disabled, true);
  assert.strictEqual(t.ui.deletePointBtn.hidden, true);
});


test('init() laeuft ohne Fehler durch (Startpfad der App)', async () => {
  const { t, sandbox, clock } = setup();
  t.state.activeMap = null;
  t.state.maps = [];
  sandbox.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => request.onsuccess && request.onsuccess());
      request.result = fakeDb();
      return request;
    },
  };
  await t.init();
  await clock.flush();
  assert.strictEqual(t.state.mode, 'perimeter');
  assert.ok(t.ui.modeChipLabel.textContent, 'Modus-Chip ist beschriftet');
  assert.strictEqual(t.state.viewport.custom, false);
});

(async () => {
  let failed = 0;
  for (const c of cases) {
    try { await c.fn(); } catch (error) {
      failed += 1;
      console.error(`FAIL ${c.name}\n     ${error.message}`);
      if (process.env.UI_TEST_STACK) console.error(error.stack);
    }
  }
  if (failed) { console.error(`ui tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
  console.log(`ui tests: OK (${cases.length} Faelle)`);
})();
