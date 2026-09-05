'use strict';
// Tests fuer die Kartier-Oberflaeche (v17): Modus-Chip, Punktaufnahme, Auswahl per Tap,
// Verschieben/Loeschen, Zoom-Grenzen, Joystick-Kennlinie und RTK-Badge.
// Laeuft ohne Browser gegen die DOM-Stubs aus app-harness.js.

const assert = require('assert');
const { loadApp } = require('./app-harness.js');
const { createClock } = require('./virtual-clock.js');
const { createFakeBluetooth } = require('./fake-ble.js');
const fs = require('fs');
const path = require('path');

const EXPORTS = ['state', 'ui', 'setMode', 'modeLabel', 'CAPTURE_MODES', 'addCurrentPoint', 'undoPoint',
  'openModeDialog', 'closeModeDialog', 'requestModeChange', 'openContours', 'closeAllOpenContours',
  'deleteAction', 'deleteSelectedArea', 'selectedExclusion', 'createExclusion', 'validateActiveMap',
  'toggleAutoCapture', 'startAutoCapture', 'stopAutoCapture', 'refreshDeleteButton', 'bindAccordion',
  'setTheme', 'applyTheme', 'smoothedPosition', 'pointFromTelemetry', 'toMapCoords', 'handleLine',
  'askConfirm', 'confirmDialogRespond', 'showNotice', 'reportError',
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

test('Moduswahl laeuft ueber einen Dialog mit vier Optionen', async () => {
  const { t } = setup();
  assert.deepStrictEqual([...t.CAPTURE_MODES], ['perimeter', 'exclusion', 'waypoint', 'dock']);
  t.closeModeDialog();
  assert.strictEqual(t.ui.modeDialog.hidden, true);
  t.openModeDialog();
  assert.strictEqual(t.ui.modeDialog.hidden, false);
  await t.requestModeChange('waypoint');
  assert.strictEqual(t.ui.modeDialog.hidden, true, 'Dialog schliesst nach der Wahl');
  assert.strictEqual(t.state.mode, 'waypoint');
  assert.strictEqual(t.ui.modeChipLabel.textContent, 'Wegpunkte');
});

test('Moduswechsel fragt erst ab drei Punkten nach dem Schliessen der Kontur', async () => {
  const { t, sandbox } = setup();
  // 0-2 Punkte: keine Rueckfrage
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  sandbox.__lastConfirm = null;
  await t.requestModeChange('dock');
  assert.strictEqual(sandbox.__lastConfirm, null, 'bei zwei Punkten keine Frage');
  assert.strictEqual(t.state.mode, 'dock');

  // ab drei Punkten: Frage, und "Ja" schliesst den Perimeter
  await t.requestModeChange('perimeter');
  t.state.activeMap.perimeter.push({ x: 1, y: 1 });
  sandbox.__confirmAnswer = true;
  await t.requestModeChange('waypoint');
  assert.ok(sandbox.__lastConfirm && sandbox.__lastConfirm.includes('Perimeter'));
  assert.strictEqual(t.state.activeMap.perimeterClosed, true);
  assert.strictEqual(t.state.mode, 'waypoint');
});

test('Bei "Nein" bleibt die Kontur offen und der Wechsel findet trotzdem statt', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  sandbox.__confirmAnswer = false;
  await t.requestModeChange('dock');
  assert.strictEqual(t.state.activeMap.perimeterClosed, false, 'Kontur bleibt offen');
  assert.strictEqual(t.state.mode, 'dock', 'Wechsel passiert trotzdem');
  // Spaeter zurueck: es wird am letzten Punkt weitergearbeitet.
  await t.requestModeChange('perimeter');
  await t.addCurrentPoint();
  assert.strictEqual(t.state.activeMap.perimeter.length, 4);
});

test('Kartenpruefung erkennt offene Konturen und kann sie schliessen', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  await t.createExclusion();
  const exclusion = t.state.activeMap.exclusions[0];
  exclusion.points.push({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 });
  assert.strictEqual(exclusion.closed, false, 'neue Flaechen starten offen');
  assert.strictEqual(t.openContours().length, 2);
  t.validateActiveMap();
  assert.ok(t.state.validationResult.issues.some((i) => i.key === 'checkAreaOpen'));
  assert.strictEqual(t.ui.closeContoursBtn.hidden, false, 'Angebot zum Schliessen erscheint');
  sandbox.__confirmAnswer = true;
  await t.closeAllOpenContours();
  assert.strictEqual(t.state.activeMap.perimeterClosed, true);
  assert.strictEqual(exclusion.closed, true);
  assert.strictEqual(t.openContours().length, 0);
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
  assert.strictEqual(t.ui.deleteFabWrap.hidden, false, 'Loeschwerkzeug ist sichtbar');
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Punktauswahl löschen');
  assert.ok(t.ui.addPointBtn.classList.contains('move-mode'), 'Hauptbutton wechselt zu Verschieben');

  t.handleMapTap(tapAt(t, screen.x + 400, screen.y + 250));
  assert.strictEqual(t.state.selectedPoint, null);
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Letzten Punkt');
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

test('Loeschknopf: ohne Auswahl loescht er den zuletzt aufgenommenen Punkt', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
  t.refreshCaptureState();
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Letzten Punkt');
  await t.deleteAction();
  assert.deepStrictEqual(t.state.activeMap.perimeter.map((p) => p.x), [0, 1]);
  await t.deleteAction();
  assert.deepStrictEqual(t.state.activeMap.perimeter.map((p) => p.x), [0], 'mehrfach tippbar');
});

test('Loeschknopf: mit Punktauswahl loescht er genau diesen Punkt', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Punktauswahl löschen');
  assert.ok(t.ui.deletePointBtn.classList.contains('delete-point'));
  await t.deleteAction();
  assert.deepStrictEqual(t.state.activeMap.perimeter.map((p) => p.x), [0, 2]);
  assert.strictEqual(t.state.selectedPoint, null);
});

test('Tap in eine Ausschlussflaeche waehlt die ganze Flaeche aus und loescht sie nach Rueckfrage', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: -5, y: -5 }, { x: 9, y: -5 }, { x: 9, y: 9 }, { x: -5, y: 9 }];
  await t.createExclusion();
  const exclusion = t.state.activeMap.exclusions[0];
  exclusion.points.push({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 });
  t.renderMap();
  const inside = t.toScreen({ x: 2, y: 2 }, t.state.currentTransform);
  t.handleMapTap(tapAt(t, inside.x, inside.y));
  assert.strictEqual(t.state.selectedArea, exclusion.id, 'ganze Flaeche ausgewaehlt');
  assert.strictEqual(t.state.selectedPoint, null, 'kein Einzelpunkt');
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Fläche löschen');
  assert.ok(t.ui.deletePointBtn.classList.contains('delete-area'));

  sandbox.__confirmAnswer = false;
  await t.deleteAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'ohne Bestaetigung bleibt sie erhalten');
  sandbox.__confirmAnswer = true;
  await t.deleteAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 0);
  assert.strictEqual(t.state.selectedArea, null);
});

test('Tap in den Perimeter waehlt keine Flaeche aus', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }];
  t.renderMap();
  const inside = t.toScreen({ x: 4, y: 4 }, t.state.currentTransform);
  t.handleMapTap(tapAt(t, inside.x, inside.y));
  assert.strictEqual(t.state.selectedArea, null);
  assert.strictEqual(t.state.selectedPoint, null);
});

test('Automatik ersetzt den manuellen Knopf und blendet den Loeschknopf aus', async () => {
  const { t } = setup();
  t.setMode('waypoint');
  await t.toggleAutoCapture();
  assert.strictEqual(t.state.autoCaptureRunning, true);
  assert.strictEqual(t.ui.captureFabWrap.hidden, true, 'manueller Knopf samt Beschriftung verschwindet');
  assert.ok(t.ui.captureCluster.classList.contains('auto-active'));
  assert.strictEqual(t.ui.deleteFabWrap.hidden, true, 'kein Loeschen waehrend der Automatik');
  assert.strictEqual(t.state.activeMap.waypoints.length, 1, 'erster Punkt sofort');
  await t.toggleAutoCapture();
  assert.strictEqual(t.state.autoCaptureRunning, false);
  assert.strictEqual(t.ui.captureFabWrap.hidden, false);
  assert.strictEqual(t.ui.deleteFabWrap.hidden, false);
});

test('Automatik nimmt im eingestellten Intervall weitere Punkte auf', async () => {
  const { t, clock } = setup();
  t.setMode('waypoint');
  t.state.view.autoCaptureIntervalS = 5;
  await t.toggleAutoCapture();
  assert.strictEqual(t.state.activeMap.waypoints.length, 1);
  t.state.telemetry.receivedAt = clock.now();
  await clock.runFor(5100);
  t.state.telemetry.receivedAt = clock.now();
  await clock.runFor(5100);
  assert.strictEqual(t.state.activeMap.waypoints.length, 3, 'zwei weitere Punkte nach 2 Intervallen');
  t.stopAutoCapture();
  await clock.runFor(20000);
  assert.strictEqual(t.state.activeMap.waypoints.length, 3, 'nach dem Stoppen kommt nichts mehr dazu');
});

test('Positions-Glaettung mittelt die Fixes der letzten zwei Sekunden', () => {
  const { t, clock } = setup();
  assert.strictEqual(t.smoothedPosition(), null, 'ein einzelner Fix wird nicht gemittelt');
  t.state.fixHistory = [
    { x: 1.0, y: 2.0, at: clock.now() - 1500 },
    { x: 2.0, y: 3.0, at: clock.now() - 500 },
    { x: 3.0, y: 4.0, at: clock.now() },
  ];
  const smooth = t.smoothedPosition();
  assert.strictEqual(smooth.samples, 3);
  assert.strictEqual(smooth.x, 2);
  assert.strictEqual(smooth.y, 3);
  const point = t.pointFromTelemetry();
  assert.strictEqual(point.x, 2, 'der aufgenommene Punkt nutzt den Mittelwert');
  assert.strictEqual(point.smoothedFrom, 3);
  // Zu alte Fixes zaehlen nicht mit.
  t.state.fixHistory[0].at = clock.now() - 9000;
  assert.strictEqual(t.smoothedPosition().samples, 2);
});

test('Hell/Dunkel: System als Standard, manuelle Wahl gewinnt', () => {
  const { t, sandbox } = setup();
  assert.strictEqual(t.state.view.theme, 'system');
  t.applyTheme();
  assert.strictEqual(sandbox.document.documentElement.getAttribute('data-theme'), null, 'System setzt kein Attribut');
  t.setTheme('light');
  assert.strictEqual(sandbox.document.documentElement.getAttribute('data-theme'), 'light');
  t.setTheme('dark');
  assert.strictEqual(sandbox.document.documentElement.getAttribute('data-theme'), 'dark');
  t.setTheme('system');
  assert.strictEqual(sandbox.document.documentElement.getAttribute('data-theme'), null);
  t.setTheme('bogus');
  assert.strictEqual(t.state.view.theme, 'system', 'unbekannte Werte werden ignoriert');
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


test('Rueckfragen und Meldungen laufen ueber den eigenen Dialog, nicht ueber den Browser', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const confirms = source.match(/(?<![A-Za-z.])confirm\s*\(/g) || [];
  assert.deepStrictEqual(confirms, [], 'window.confirm() darf nicht mehr aufgerufen werden');
  const alerts = source.match(/(?<![A-Za-z.])alert\s*\(/g) || [];
  assert.deepStrictEqual(alerts, [], 'window.alert() darf nicht mehr aufgerufen werden');
  assert.ok(source.includes('function askConfirm('), 'askConfirm() ist die einzige Stelle fuer Rueckfragen');
  assert.ok(source.includes('function showNotice('), 'showNotice() ist die einzige Stelle fuer Meldungen');
});

test('Meldung zeigt nur einen Knopf und keine Abbrechen-Option', async () => {
  const { t, sandbox } = setup();
  delete sandbox.__confirmAdapter;
  const pending = t.showNotice({ title: 'Fehler', message: 'Karte konnte nicht gespeichert werden.', tone: 'danger' });
  assert.strictEqual(t.ui.confirmDialog.hidden, false);
  assert.strictEqual(t.ui.confirmDialogCancel.hidden, true, 'kein Abbrechen bei einer reinen Meldung');
  assert.ok(t.ui.confirmDialogActions.classList.contains('single'));
  assert.strictEqual(t.ui.confirmDialogAccept.textContent, 'Verstanden');
  assert.strictEqual(t.ui.confirmDialogText.textContent, 'Karte konnte nicht gespeichert werden.');
  t.confirmDialogRespond(true);
  await pending;
  assert.strictEqual(t.ui.confirmDialog.hidden, true);
});

test('reportError zeigt die Meldung und schreibt sie ins Diagnoseprotokoll', async () => {
  const { t, sandbox, elements } = setup();
  await t.reportError(new Error('Kartengrenze fehlt'));
  assert.strictEqual(sandbox.__lastConfirmRequest.message, 'Kartengrenze fehlt');
  assert.strictEqual(sandbox.__lastConfirmRequest.singleButton, true);
  assert.strictEqual(sandbox.__lastConfirmRequest.tone, 'danger');
  assert.ok(elements.get('debugLog').textContent.includes('Kartengrenze fehlt'), 'Fehler steht auch im Protokoll');
});

test('Bestaetigungsdialog: Titel, Text und Knopfbeschriftung, beide Antworten', async () => {
  const { t, sandbox } = setup();
  delete sandbox.__confirmAdapter; // echten Dialog statt Testautomatik pruefen
  const pending = t.askConfirm({ title: 'Fläche löschen', message: 'Wirklich?', confirmLabel: 'Löschen', tone: 'danger' });
  assert.strictEqual(t.ui.confirmDialog.hidden, false, 'Dialog wird sichtbar');
  assert.strictEqual(t.ui.confirmDialogTitle.textContent, 'Fläche löschen');
  assert.strictEqual(t.ui.confirmDialogText.textContent, 'Wirklich?');
  assert.strictEqual(t.ui.confirmDialogAccept.textContent, 'Löschen', 'aussagekraeftige Beschriftung statt OK');
  assert.strictEqual(t.ui.confirmDialogCancel.textContent, 'Abbrechen');
  assert.ok(t.ui.confirmDialogAccept.classList.contains('danger'), 'Loeschen wird als Warnfarbe gezeigt');
  t.confirmDialogRespond(true);
  assert.strictEqual(await pending, true);
  assert.strictEqual(t.ui.confirmDialog.hidden, true, 'Dialog schliesst nach der Antwort');

  const second = t.askConfirm({ title: 'Kontur schließen', message: 'Verbinden?', confirmLabel: 'Schließen' });
  assert.ok(t.ui.confirmDialogAccept.classList.contains('primary'));
  assert.ok(!t.ui.confirmDialogAccept.classList.contains('danger'));
  t.confirmDialogRespond(false);
  assert.strictEqual(await second, false, 'Abbrechen liefert false');
});

test('Eine zweite Rueckfrage laesst die erste nicht haengen', async () => {
  const { t, sandbox } = setup();
  delete sandbox.__confirmAdapter;
  const first = t.askConfirm({ title: 'A', message: 'a', confirmLabel: 'ok' });
  const second = t.askConfirm({ title: 'B', message: 'b', confirmLabel: 'ok' });
  assert.strictEqual(await first, false, 'die verdraengte Rueckfrage gilt als abgelehnt');
  assert.strictEqual(t.ui.confirmDialogTitle.textContent, 'B');
  t.confirmDialogRespond(true);
  assert.strictEqual(await second, true);
});

test('Loeschen einer Flaeche fragt mit eigener Beschriftung nach', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: -5, y: -5 }, { x: 9, y: -5 }, { x: 9, y: 9 }];
  await t.createExclusion();
  t.state.activeMap.exclusions[0].points.push({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 });
  t.state.selectedArea = t.state.activeMap.exclusions[0].id;
  sandbox.__confirmAnswer = false;
  await t.deleteAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'ohne Bestaetigung bleibt sie erhalten');
  assert.strictEqual(sandbox.__lastConfirmRequest.confirmLabel, 'Löschen');
  assert.strictEqual(sandbox.__lastConfirmRequest.tone, 'danger');
  assert.ok(sandbox.__lastConfirmRequest.title);
});

test('Akkordeon: das Oeffnen eines Abschnitts schliesst die anderen', () => {
  const { t, sandbox } = setup();
  const make = () => {
    const el = sandbox.document.createElement('details');
    el.tagName = 'DETAILS';
    el.open = false;
    el._handlers = [];
    el.addEventListener = (type, fn) => { if (type === 'toggle') el._handlers.push(fn); };
    el.fire = () => el._handlers.forEach((fn) => fn());
    return el;
  };
  const a = make(); const b = make(); const c = make();
  t.bindAccordion({ children: [a, b, c] });
  a.open = true; a.fire();
  assert.deepStrictEqual([a.open, b.open, c.open], [true, false, false]);
  b.open = true; b.fire();
  assert.deepStrictEqual([a.open, b.open, c.open], [false, true, false]);
  b.open = false; b.fire();
  assert.deepStrictEqual([a.open, b.open, c.open], [false, false, false], 'Schliessen oeffnet nichts');
});

test('Gesperrte Karte blockiert Aufnahme und Loeschwerkzeug', () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }];
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.addPointBtn.disabled, true);
  assert.strictEqual(t.ui.deleteFabWrap.hidden, true);
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
