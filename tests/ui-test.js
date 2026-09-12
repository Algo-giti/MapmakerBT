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
  'mapElements', 'renderElementList', 'deleteElement', 'activateElement',
  'pruneEmptyExclusions', 'localizedExclusionName', 'loadViewPreferences', 'applyHandedness',
  'insertPointAtSelection', 'capturePreconditionKey', 'insertNeighbourIndex', 'midpointBetween',
  'renderPositionMode', 'updatePositionModeFromUi', 'mapToGeoJson', 'setActiveMapById',
  'mapOriginInUse', 'originFromInputs', 'normalizeOrigin',
  'applyDriveControlMode', 'toggleDriveControl', 'beginCursorDrive', 'cursorDriveVector', 'cursorSpeedLimits',
  'updateCursorDriveFromPointer', 'cursorZoneFromPointer', 'cursorZoneSpeeds', 'DRIVE_ZONES',
  'cursorZoneLadder', 'refreshDriveZoneHint', 'turnKeyIncircle', 'refreshTurnKeyHint',
  'applyDriveZonePreferences',
  'renameMapById', 'duplicateMapById', 'uniqueCopyName', 'askText', 'localizedMapName', 'MAP_NAME_MAX',
  'stopDrive', 'saveViewPreferences',
  'log', 'renderDebugLog', 'onDebugLogScroll', 'scrollLogToEnd', 'clearDebugLog',
  'logExportText', 'logExportFileName', 'exportDebugLog', 'debugLogAtBottom',
  'LOG_ENTRY_LIMIT', 'LOG_EXPORT_LIMIT', 'LOG_BOTTOM_TOLERANCE_PX',
  'startExtension', 'cancelExtension', 'finishExtension', 'refreshExtendButton', 'refreshExtendPanel', 'I18N',
  'canStartExtension', 'extensionCut', 'reorderForExtension', 'appendCurrentPoint', 'undoLastAction',
  'setMode', 'refreshContourStatus', 'activeContour', 'refreshToolbarVisibility',
  'contourStatusChipText', 'selectedPointLabel', 'contourStateSuffix',
  'canCloseAndStartNew', 'closeAndStartNewExclusion', 'currentExclusion',
  'setTheme', 'applyTheme', 'applyDriveZonePreferences', 'applyViewPreferencesToUi', 'updateViewPreferencesFromUi', 'JOYSTICK_SCALES', 'smoothedPosition', 'pointFromTelemetry', 'toMapCoords', 'handleLine', 'lockIcon', 'toggleLanguage',
  'askConfirm', 'confirmDialogRespond', 'showNotice', 'reportError', 'reportBleError',
  'showUpdateBar', 'applyUpdate', 'offerToCloseContour',
  'deleteSelectedPoint', 'handleMapTap', 'applyPointSelection', 'clearPointSelection', 'refreshCaptureState',
  'renderMap', 'resetViewport', 'clampViewport', 'activeTransform', 'toScreen', 'svgMetrics', 'beginCustomViewport',
  'updateRtkBadge', 'setMenuOpen', 'onMapPointerDown', 'onMapPointerMove', 'onMapPointerUp', 'beginCaptureHold', 'cancelCaptureHold', 'movePointToMower', 'captureButtonTap', 'driveSpeedLimits', 'joystickVectorFromPointer', 'makeMap', 'normalizeMap',
  'undoLastAction', 'pushUndo', 'clearUndoStack', 'refreshUndoButton', 'UNDO_STACK_LIMIT',
  'autoCaptureTick', 'applyAutoCaptureModeToUi', 'updateViewPreferencesFromUi',
  'AUTO_CAPTURE_DISTANCE_MIN_CM', 'AUTO_CAPTURE_DISTANCE_MAX_CM', 'BLE_POLL_INTERVAL_MS',
  'mapExportFile', 'exportMapFile', 'exportCurrentMapJson', 'exportCurrentMapGeoJson',
  'shareCurrentMap', 'canShareMapFormat', 'refreshShareButtons',
  'refreshExportButtons', 'cassandraExportBlockKey', 'skippedAreas',
  'noticeCassandraExport', 'exportCurrentMapCassandra', 'renderCassandraReference',
  'loadCassandraReference', 'saveCassandraReference', 'storedCassandraReference',
  'defaultCassandraReference', 'CASSANDRA_REFERENCE_KEY',
  'updateCassandraReferenceFromUi', 'cassandraReferenceInUse', 'mapToCassandraGeoJson',
  'importMapFile', 'isCassandraGeoJson', 'noticeCassandraImport', 'clearImportNotice',
  'mapToSunrayApp', 'exportCurrentMapSunray', 'noticeSunrayExport', 'skippedAreas',
  'isSunrayAppFile', 'sunrayAppToMap', 'chooseSunrayMap', 'askChoice', 'sunrayAppMapLabel',
  'confirmDialogRespond', 'noticeSunrayImport',
  'MIN_USER_ZOOM', 'MAX_USER_ZOOM', 'init',
  'MAX_MAPS', 'createMapFromInput', 'renderMapControls', 'tr',
  'renderMapGallery', 'formatMapTimestamp',
  'fixScatter', 'rememberScatter', 'scatterMaxCm', 'gpsScatterText', 'refreshGpsScatter',
  'SCATTER_MAX_WINDOW_MS', 'capturePreconditionKey', 'telemetryHasFix',
  'EXTEND_STEPS', 'extensionStep', 'handleExtensionTap', 'toggleGpsPanel', 'loadViewPreferences',
  'UNDO_STACK_BYTE_BUDGET', 'trimUndoStack', 'mapWithoutUndo', 'geometrySnapshot', 'loadMaps',
  'setActiveMapById', 'deleteActiveMap', 'saveActiveMap', 'duplicateMapById'];

/** Minimaler IndexedDB-Ersatz, damit saveActiveMap() im Test durchlaeuft. */
function fakeDb() {
  const rows = new Map();
  const request = (result) => { const r = { result }; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r; };
  // Wie IndexedDB **Kopien** ablegen, nicht die lebenden Objekte: sonst sieht ein Test einen
  // Datensatz, der in Wahrheit noch dasselbe Objekt im Speicher ist.
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const store = {
    put(value) { rows.set(value.id, clone(value)); return request(value); },
    delete(id) { rows.delete(id); return request(undefined); },
    getAll() { return request([...rows.values()].map(clone)); },
  };
  return { transaction: () => ({ objectStore: () => store }), rows };
}

function setup({ missingIds = [] } = {}) {
  const clock = createClock();
  const fake = createFakeBluetooth({ clock });
  const { t, elements, sandbox } = loadApp({ clock, bleAdapter: fake.adapter, exportNames: EXPORTS, missingIds });
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
  assert.strictEqual(t.ui.autoFabWrap.hidden, true, 'beim Verschieben keine Automatik anbieten');
  assert.ok(t.ui.addPointBtn.classList.contains('move-mode'), 'Hauptbutton wechselt zu Verschieben');

  t.handleMapTap(tapAt(t, screen.x + 400, screen.y + 250));
  assert.strictEqual(t.state.selectedPoint, null);
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Letzten Punkt');
  assert.strictEqual(t.ui.autoFabWrap.hidden, false, 'ohne Auswahl ist die Automatik wieder da');
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
  // Der sichtbare Punkt ist bewusst klein — die Trefferflaeche haengt nicht daran.
  const dot = t.ui.shapeLayer.children.find((c) => (c.attributes?.class || '').includes('map-point')
    && !(c.attributes?.class || '').includes('map-point-hit'));
  assert.ok(Number(dot.attributes.r) <= 6, `sichtbarer Punktradius ${dot.attributes.r} soll klein bleiben`);
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
  assert.strictEqual(t.ui.captureFabWrap.hidden, true, 'bei Flaechenauswahl kein Aufnahmeknopf');
  assert.strictEqual(t.ui.autoFabWrap.hidden, true, 'und keine Automatik');
  assert.strictEqual(t.ui.deleteFabWrap.hidden, false, 'nur der Papierkorb bleibt');

  sandbox.__confirmAnswer = false;
  await t.deleteAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'ohne Bestaetigung bleibt sie erhalten');
  sandbox.__confirmAnswer = true;
  await t.deleteAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 0);
  assert.strictEqual(t.state.selectedArea, null);
  assert.strictEqual(t.ui.captureFabWrap.hidden, false, 'danach ist der Aufnahmeknopf zurueck');
  assert.strictEqual(t.ui.autoFabWrap.hidden, false);
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
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatik läuft (5s)', 'Intervall steht im Label');
  assert.strictEqual(t.ui.captureFabWrap.hidden, true, 'manueller Knopf samt Beschriftung verschwindet');
  assert.ok(t.ui.captureCluster.classList.contains('auto-active'));
  assert.strictEqual(t.ui.autoFabWrap.hidden, false, 'laufende Automatik bleibt bedienbar');
  assert.strictEqual(t.ui.deleteFabWrap.hidden, true, 'kein Loeschen waehrend der Automatik');
  assert.strictEqual(t.state.activeMap.waypoints.length, 1, 'erster Punkt sofort');
  // Anderes Intervall -> anderes Label (die Einstellung selbst ist nur bei gestoppter
  // Automatik erreichbar, weil das Menue sie beendet).
  t.state.view.autoCaptureIntervalS = 12;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatik läuft (12s)');

  await t.toggleAutoCapture();
  assert.strictEqual(t.state.autoCaptureRunning, false);
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto-Aufnahme (12s)', 'auch gestoppt mit Intervall');
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

test('Streuung: Radius der Punktwolke im 2-s-Fenster, in cm', () => {
  const { t, clock } = setup();
  assert.strictEqual(t.fixScatter().cm, null, 'ohne Fixes gibt es keine Streuung');
  assert.strictEqual(t.fixScatter().samples, 0);

  // Ein einzelner Fix ergibt noch keinen Radius, wird aber gezaehlt.
  t.state.fixHistory = [{ x: 0, y: 0, at: clock.now() }];
  assert.strictEqual(t.fixScatter().cm, null, 'ein Fix spannt keine Wolke auf');
  assert.strictEqual(t.fixScatter().samples, 1);

  // Vier Fixes auf einem Quadrat der Kantenlaenge 0,06 m: Mittelpunkt in der Mitte,
  // groesster Abstand ist die halbe Diagonale = 0,03 * sqrt(2) m = 4,2426 cm.
  t.state.fixHistory = [
    { x: 0, y: 0, at: clock.now() - 1500 },
    { x: 0.06, y: 0, at: clock.now() - 1000 },
    { x: 0.06, y: 0.06, at: clock.now() - 500 },
    { x: 0, y: 0.06, at: clock.now() },
  ];
  const scatter = t.fixScatter();
  assert.strictEqual(scatter.samples, 4);
  assert.strictEqual(scatter.cm.toFixed(4), '4.2426', `gemessen: ${scatter.cm}`);

  // **Genau dasselbe Fenster wie die Glaettung** — knapp dahinter geprueft, nicht weit dahinter:
  // ein zu grosszuegiges Fenster faellt sonst gar nicht auf.
  t.state.fixHistory[0].at = clock.now() - 2100;
  assert.strictEqual(t.fixScatter().samples, 3, '2,1 s alt ist draussen');
  assert.strictEqual(t.smoothedPosition().samples, 3, 'und zwar fuer beide gleich');
  t.state.fixHistory[0].at = clock.now() - 1900;
  assert.strictEqual(t.fixScatter().samples, 4, '1,9 s alt zaehlt noch mit');
  assert.strictEqual(t.smoothedPosition().samples, 4, 'auch hier gleich');
});

test('Der 30-s-Hoechstwert haelt einen Ausreisser fest und laeuft danach ab', async () => {
  const { t, clock } = setup();
  const feed = (dx) => {
    t.state.fixHistory = [{ x: 0, y: 0, at: clock.now() }, { x: dx, y: 0, at: clock.now() }];
    t.rememberScatter();
  };
  feed(0.02);                                    // ruhig: Radius 1 cm
  assert.strictEqual(Math.round(t.scatterMaxCm()), 1);
  await clock.runFor(1000);
  feed(0.22);                                    // Ausreisser: Radius 11 cm
  assert.strictEqual(Math.round(t.scatterMaxCm()), 11, 'der Ausreisser steht im Maximum');

  // Er bleibt die vollen 30 s stehen …
  await clock.runFor(25000);
  feed(0.02);
  assert.strictEqual(Math.round(t.scatterMaxCm()), 11, 'nach 25 s noch da');
  // … und faellt danach heraus.
  await clock.runFor(6000);
  feed(0.02);
  assert.strictEqual(Math.round(t.scatterMaxCm()), 1, 'nach mehr als 30 s wieder ruhig');
  assert.strictEqual(t.SCATTER_MAX_WINDOW_MS, 30000);
});

test('Das GPS-Abzeichen schaltet die Einblendung, die Wahl ueberlebt den Neustart', () => {
  const { t, clock, sandbox } = setup();
  t.state.telemetry = { x: 1, y: 2, solution: 2, accuracy: 0.021, receivedAt: clock.now() };
  t.state.fixHistory = [{ x: 0, y: 0, at: clock.now() }, { x: 0.06, y: 0, at: clock.now() }];
  t.rememberScatter();

  // Aus: die Einblendung liegt nicht auf der Karte.
  t.refreshGpsScatter();
  assert.strictEqual(t.ui.gpsPanel.hidden, true, 'standardmaessig aus');

  // Ein Tipp auf das Abzeichen blendet sie ein — mit allen fuenf Angaben.
  t.toggleGpsPanel();
  assert.strictEqual(t.ui.gpsPanel.hidden, false);
  assert.strictEqual(t.ui.gpsPanelFix.textContent, t.tr('rtkFix'), 'Fix-Status, wie im Abzeichen');
  const de = t.ui.gpsPanelScatter.textContent;
  assert.ok(/Streuung 3 cm/.test(de), de);
  assert.ok(/max 30 s: 3 cm/.test(de), de);
  assert.ok(/2 Fixes/.test(de), `die Zahl der Fixes macht Funkluecken erkennbar: ${de}`);
  assert.ok(/±2\.1 cm/.test(t.ui.gpsPanelAccuracy.textContent), t.ui.gpsPanelAccuracy.textContent);
  assert.ok(!/\{/.test(de + t.ui.gpsPanelAccuracy.textContent), 'kein Platzhalterrest');

  // In der Werkzeugleiste steht sie dafuer nicht mehr.
  assert.strictEqual(t.ui.gpsScatter, undefined, 'kein Feld mehr in der Leiste');
  const markup = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!markup.includes('id="gpsScatter"'), 'auch nicht im Markup');

  // Englisch.
  t.toggleLanguage();
  t.refreshGpsScatter();
  assert.ok(/Scatter 3 cm/.test(t.ui.gpsPanelScatter.textContent), t.ui.gpsPanelScatter.textContent);
  assert.ok(/2 fixes/.test(t.ui.gpsPanelScatter.textContent));
  assert.ok(/Accuracy/.test(t.ui.gpsPanelAccuracy.textContent), t.ui.gpsPanelAccuracy.textContent);

  // Funkluecke: nur ein Fix — die Zahl steht trotzdem da.
  t.toggleLanguage();
  t.state.fixHistory = [{ x: 0, y: 0, at: clock.now() }];
  t.refreshGpsScatter();
  assert.ok(/Streuung – · 1 Fixes/.test(t.ui.gpsPanelScatter.textContent), t.ui.gpsPanelScatter.textContent);

  // Gemerkt: der gespeicherte Zustand kommt beim naechsten Laden zurueck.
  assert.ok(JSON.parse(sandbox.localStorage.getItem('mapcreator-ardumower-view-prefs-v1')).gpsPanel,
    'die Wahl liegt in den Ansichtseinstellungen');
  t.state.view.gpsPanel = false;
  t.loadViewPreferences();
  assert.strictEqual(t.state.view.gpsPanel, true, 'und wird beim Laden wiederhergestellt');

  // Und wieder aus.
  t.toggleGpsPanel();
  assert.strictEqual(t.ui.gpsPanel.hidden, true);
  assert.strictEqual(JSON.parse(sandbox.localStorage.getItem('mapcreator-ardumower-view-prefs-v1')).gpsPanel, false);
});

test('Die Streuung ist reine Anzeige: Aufnahme und Automatik bleiben unberuehrt', async () => {
  const { t, clock } = setup();
  // Eine absichtlich wilde Wolke — sie darf nichts sperren und nichts verschieben.
  t.state.telemetry = { x: 5, y: 5, solution: 2, receivedAt: clock.now() };
  t.state.fixHistory = [
    { x: 4.0, y: 5, at: clock.now() - 1000 },
    { x: 6.0, y: 5, at: clock.now() },
  ];
  t.rememberScatter();
  t.state.view.gpsPanel = true;
  t.refreshGpsScatter();
  assert.ok(/100 cm/.test(t.ui.gpsPanelScatter.textContent), t.ui.gpsPanelScatter.textContent);

  assert.strictEqual(t.capturePreconditionKey(), null, 'die Vorbedingung kennt die Streuung nicht');
  const point = await t.appendCurrentPoint();
  assert.ok(point, 'der Punkt entsteht trotz grosser Streuung');
  assert.strictEqual(point.x, 5, 'und liegt unveraendert auf dem Mittelwert der Fixes');
  assert.strictEqual(point.smoothedFrom, 2);

  // Auch die Automatik laeuft weiter.
  t.setMode('waypoint');
  await t.startAutoCapture();
  const count = t.state.activeMap.waypoints.length;
  t.state.telemetry.receivedAt = clock.now();
  await clock.runFor(5100);
  assert.ok(t.state.activeMap.waypoints.length > count, 'die Automatik nimmt weiter auf');
  t.stopAutoCapture();

  // Und im Quelltext haengt an der Streuung keine Entscheidung: die Rechenfunktionen werden
  // ausschliesslich von der Anzeige gelesen.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const callers = [...src.matchAll(/function ([A-Za-z0-9_]+)\([^)]*\)\s*\{([\s\S]*?)\n\}/g)]
    .filter(([, , body]) => /fixScatter\(|scatterMaxCm\(/.test(body))
    .map(([, name]) => name)
    .sort();
  assert.deepStrictEqual(callers, ['gpsScatterText', 'rememberScatter'],
    `nur Anzeige und Verlauf lesen die Streuung, gefunden: ${callers.join(', ')}`);
});

test('Die Undo-Historie gehoert der Karte und ueberlebt den Kartenwechsel', async () => {
  const { t } = setup();
  const a = t.state.activeMap;
  a.perimeter = [];
  t.pushUndo();                                  // Stand: leer
  a.perimeter.push({ x: 0, y: 0 });
  t.pushUndo();                                  // Stand: ein Punkt
  a.perimeter.push({ x: 1, y: 0 });
  assert.strictEqual(t.state.undoStack.length, 2);
  // Der Stapel ist **dieselbe** Instanz wie das Feld der Karte, nicht eine Kopie daneben.
  assert.strictEqual(t.state.undoStack, a.undoStack, 'eine Ablage, keine Spiegelung');

  // Zweite Karte: eigene, leere Historie.
  const b = t.normalizeMap(t.makeMap('Zweite'));
  t.state.maps.push(b);
  t.setActiveMapById(b.id);
  assert.strictEqual(t.state.undoStack.length, 0, 'die neue Karte beginnt ohne Historie');
  b.perimeter = [{ x: 5, y: 5 }];
  t.pushUndo();
  assert.strictEqual(t.state.undoStack.length, 1);

  // Zurueck zur ersten: ihre beiden Schritte stehen wieder bereit.
  t.setActiveMapById(a.id);
  assert.strictEqual(t.state.undoStack.length, 2, 'die Historie der ersten Karte ist wieder da');
  assert.strictEqual(t.ui.undoBtn.disabled, false, 'und der Knopf ist bedienbar');

  // Und ein Undo greift wirklich auf den gespeicherten Stand zurueck.
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 1, 'der zweite Punkt ist weg');
});

test('Die Historie wird mit der Karte gespeichert und wieder geladen', async () => {
  const { t } = setup();
  const map = t.state.activeMap;
  map.perimeter = [{ x: 0, y: 0 }];
  t.pushUndo();
  map.perimeter.push({ x: 2, y: 2 });
  await t.saveActiveMap();

  // Das, was in der Datenbank steht, traegt die Historie mit.
  const stored = t.state.db.rows.get(map.id);
  assert.strictEqual(stored.undoStack.length, 1, 'die Historie liegt im Datensatz');
  assert.strictEqual(stored.undoStack[0].perimeter.length, 1, 'mit dem Stand von vorher');

  // Neu geladen — wie nach dem Schliessen und Wiederoeffnen der App.
  t.state.activeMap = null;
  await t.loadMaps();
  assert.strictEqual(t.state.undoStack.length, 1, 'nach dem Laden steht sie wieder bereit');
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 1, 'und der Rueckschritt greift');
});

test('Je Karte hoechstens 20 Schritte — und hoechstens das Groessenbudget', () => {
  const { t } = setup();
  const map = t.state.activeMap;
  for (let i = 0; i < 26; i += 1) {
    map.perimeter.push({ x: i, y: 0 });
    t.pushUndo();
  }
  assert.strictEqual(t.state.undoStack.length, 20, 'aeltere Schritte fallen vorn weg');
  assert.strictEqual(map.undoStack.length, 20, 'und zwar im Datensatz selbst');

  // Grosse Karte: das Budget greift vor der Stueckzahl. Gemessen wird am neuesten Schnappschuss.
  const fat = (i) => ({
    x: i, y: i, smoothedFrom: 4, capturedAt: '2026-09-12T10:00:00.000Z',
    gps: { solution: 2, delta: 1.2345, age: 0.12, accuracy: 0.021, visibleSatellites: 28, visibleSatellitesDgps: 24 },
  });
  map.perimeter = Array.from({ length: 320 }, (_, i) => fat(i));
  const bytes = JSON.stringify(t.geometrySnapshot()).length;
  assert.ok(bytes > 40000, `ein Schritt dieser Karte misst ${(bytes / 1024).toFixed(1)} KiB`);
  for (let i = 0; i < 20; i += 1) { map.perimeter.push(fat(1000 + i)); t.pushUndo(); }
  const erwartet = Math.max(1, Math.min(20, Math.floor(t.UNDO_STACK_BYTE_BUDGET / bytes)));
  assert.ok(erwartet < 20, 'bei dieser Groesse greift das Budget vor der 20');
  assert.strictEqual(t.state.undoStack.length, erwartet,
    `${erwartet} Schritte passen ins Budget von ${(t.UNDO_STACK_BYTE_BUDGET / 1024).toFixed(0)} KiB`);
});

test('Export, Kopie und Import tragen keine fremde Historie mit', async () => {
  const { t } = setup();
  const map = t.state.activeMap;
  map.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  t.pushUndo();
  assert.strictEqual(t.state.undoStack.length, 1);

  // JSON-Backup: die Historie waere das Zwanzigfache der Datei und gehoert nicht dazu.
  const file = t.mapExportFile('json');
  const parsed = JSON.parse(file.text);
  assert.strictEqual(parsed.undoStack, undefined, 'kein undoStack in der Datei');
  assert.strictEqual(parsed.perimeter.length, 3, 'die Geometrie ist vollstaendig da');
  assert.strictEqual(map.undoStack.length, 1, 'und die Karte selbst behaelt ihre Historie');

  // Kopie: eigene Kennung, also waere eine geerbte Historie ohnehin wertlos.
  await t.duplicateMapById(map.id);
  const copy = t.state.maps.find((m) => m.id !== map.id);
  assert.strictEqual(copy.undoStack.length, 0, 'die Kopie beginnt ohne Historie');
  assert.strictEqual(copy.perimeter.length, 3, 'aber mit der Geometrie');

  // Import: eine untergeschobene Historie wird nicht uebernommen.
  const smuggled = JSON.stringify({ ...parsed, id: undefined, name: 'Geschmuggelt',
    undoStack: [{ mapId: 'fremd', perimeter: [], perimeterClosed: false, exclusions: [], waypoints: [], dockPoints: [] }] });
  await t.importMapFile({ name: 'x.json', text: async () => smuggled });
  assert.strictEqual(t.state.activeMap.undoStack.length, 0, 'importiert wird ohne Historie');
});

test('Mit der Karte verschwindet auch ihre Historie', async () => {
  const { t, sandbox } = setup();
  sandbox.__confirmAnswer = true;
  const map = t.state.activeMap;
  map.perimeter = [{ x: 0, y: 0 }];
  t.pushUndo();
  const id = map.id;
  await t.saveActiveMap();
  assert.strictEqual(t.state.db.rows.get(id).undoStack.length, 1, 'die Historie liegt im Datensatz');

  await t.deleteActiveMap();
  assert.strictEqual(t.state.db.rows.get(id), undefined,
    'der Datensatz ist weg — und mit ihm die Historie, sie liegt nirgends sonst');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.strictEqual((src.match(/createObjectStore/g) || []).length, 1,
    'es gibt nur einen Speicher, also keine zweite Ablage, die zurueckbliebe');
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

test('Die Ansicht bleibt stehen, wenn der Hinweisstreifen die Kartenflaeche verkleinert', () => {
  // Der gemeldete Fehler: beim Erweitern sprang die Ansicht dreimal zurueck (Punktauswahl,
  // zweiter Tipp, „Fertig“). Ursache war nicht die Erweiterung, sondern jede Aenderung der
  // gemessenen SVG-Hoehe — `#extendPanel` ist ein Geschwister der Zeichenflaeche.
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  t.renderMap();
  t.beginCustomViewport();                       // ab hier hat der Nutzer die Ansicht selbst gesetzt
  t.state.viewport.zoom = 8; t.state.viewport.dx = -40; t.state.viewport.dy = 25;
  t.renderMap();
  const before = t.toScreen({ x: 10, y: 10 }, t.state.currentTransform);
  const baseBefore = t.state.viewport.base;

  // Der Hinweisstreifen erscheint und nimmt der Karte Hoehe.
  t.ui.mapSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 240 });
  t.renderMap();
  assert.strictEqual(t.state.viewport.zoom, 8, 'der Zoom bleibt');
  assert.strictEqual(t.state.viewport.base, baseBefore, 'die eingefrorene Basis ueberlebt');
  const after = t.toScreen({ x: 10, y: 10 }, t.state.currentTransform);
  assert.strictEqual(`${after.x},${after.y}`, `${before.x},${before.y}`, 'und der Punkt steht still');

  // Und wieder zurueck, wenn der Streifen verschwindet.
  t.ui.mapSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300 });
  t.renderMap();
  const back = t.toScreen({ x: 10, y: 10 }, t.state.currentTransform);
  assert.strictEqual(`${back.x},${back.y}`, `${before.x},${before.y}`, 'auch beim Ausblenden');

  // Ohne eigene Geste gilt weiter der Auto-Fit — daran aendert sich ausdruecklich nichts.
  t.resetViewport({ render: false });
  t.renderMap();
  const fitted = t.toScreen({ x: 10, y: 10 }, t.state.currentTransform);
  t.ui.mapSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 240 });
  t.renderMap();
  assert.notStrictEqual(`${t.toScreen({ x: 10, y: 10 }, t.state.currentTransform).y}`, `${fitted.y}`,
    'der Auto-Fit folgt der Flaeche wie bisher');
});

test('Der ganze Erweitern-Ablauf laesst Zoom und Ausschnitt unberuehrt', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.renderMap();
  t.beginCustomViewport();
  t.state.viewport.zoom = 6; t.state.viewport.dx = -30; t.state.viewport.dy = 12;
  t.renderMap();
  const shot = () => {
    const p = t.toScreen({ x: 10, y: 10 }, t.state.currentTransform);
    return `${t.state.viewport.zoom}|${p.x},${p.y}`;
  };
  const before = shot();
  const points = t.state.activeMap.perimeter;

  // Jeder Schritt aendert die Hoehe des Hinweisstreifens — im Test nachgestellt, weil der
  // Stub keine echte Textumbruchhoehe kennt.
  const strip = (h) => { t.ui.mapSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: h }); };
  t.startExtension();  strip(250); t.renderMap();
  assert.strictEqual(shot(), before, 'Start der Auswahl');
  tapPoint(t, points, 1);  strip(240); t.renderMap();
  assert.strictEqual(shot(), before, 'erster Punkt');
  tapPoint(t, points, 2);  strip(230); t.renderMap();
  assert.strictEqual(shot(), before, 'zweiter Punkt (Ankuendigung)');
  tapPoint(t, points, 2);  await flush(); strip(240); t.renderMap();
  assert.strictEqual(shot(), before, 'Auftrennen');
  await t.finishExtension();  strip(300); t.renderMap();
  assert.strictEqual(shot(), before, '„Fertig“ — auch der Abschluss laesst die Ansicht stehen');
});

test('Die Erweitern-Hinweise sind kurz und nennen von Anfang an das offene Ende', () => {
  const { t } = setup();
  const KEYS = ['extendPickFirst', 'extendPickSecond', 'extendConfirmEdge',
    'extendConfirmCut', 'extendConfirmCutOne', 'extendWrongContour',
    'extendOpened', 'extendOpenedCut', 'extendOpenedCutOne'];
  for (const lang of ['de', 'en']) {
    const texts = t.I18N[lang];
    // Schritt 1 muss die Regel schon tragen, sonst waehlt man den falschen Punkt zuerst.
    const first = texts.extendPickFirst;
    assert.ok(/weitergebaut|building continues/.test(first), `${lang}: ${first}`);
    // Kurz bleiben — und zwar **mit** der Schrittnummer davor, so steht es auf dem Schirm.
    const prefix = texts.extendStep.replace('{step}', '4').replace('{total}', '4');
    for (const key of KEYS) {
      const line = `${prefix} ${texts[key].replace('{n}', '12').replace('{b}', '12').replace('{count}', '12')}`;
      assert.ok(line.length <= 80, `${lang}/${key} ist ${line.length} Zeichen: ${line}`);
    }
  }
  // Einzahl und Mehrzahl stehen grammatisch richtig da.
  assert.ok(/[Ee]in Punkt/.test(t.tr('extendConfirmCutOne', { b: 3 })), t.tr('extendConfirmCutOne', { b: 3 }));
  assert.ok(!/\{count\}/.test(t.tr('extendConfirmCut', { b: 3, count: 4 })), 'kein Platzhalterrest');
  assert.ok(t.tr('extendConfirmCut', { b: 3, count: 4 }).includes('4 Punkte'), 'Mehrzahl mit Zahl');
});

test('Jeder Erweitern-Schritt ist nummeriert, die Gesamtzahl kommt aus dem Ablauf', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  const total = t.EXTEND_STEPS.length;
  assert.ok(total >= 3, `der Ablauf hat ${total} Schritte`);
  const line = () => t.ui.extendPanelText.textContent;

  t.startExtension();
  assert.strictEqual(t.extensionStep(), 1);
  assert.ok(line().startsWith(`Schritt 1 von ${total}:`), line());

  const points = t.state.activeMap.perimeter;
  tapPoint(t, points, 1);
  assert.strictEqual(t.extensionStep(), 2);
  assert.ok(line().startsWith(`Schritt 2 von ${total}:`), line());

  tapPoint(t, points, 3);                        // zweiter Punkt: Ankuendigung
  assert.strictEqual(t.extensionStep(), 3);
  assert.ok(line().startsWith(`Schritt 3 von ${total}:`), line());

  tapPoint(t, points, 3);
  await flush();
  assert.strictEqual(t.extensionStep(), 4);
  assert.ok(line().startsWith(`Schritt 4 von ${total}:`), line());

  // Auch der Fehlgriff bleibt im laufenden Schritt, statt die Zaehlung zu verlieren.
  const u = setup();
  seedClosedPerimeter(u.t);
  u.t.startExtension();
  await u.t.handleExtensionTap({ role: 'waypoint', index: 0, exclusionId: null });
  assert.ok(u.t.ui.extendPanelText.textContent.startsWith(`Schritt 1 von ${total}:`),
    u.t.ui.extendPanelText.textContent);

  // Die Gesamtzahl wird nirgends von Hand in einen Text geschrieben.
  for (const lang of ['de', 'en']) {
    for (const [key, value] of Object.entries(t.I18N[lang])) {
      if (!key.startsWith('extend')) continue;
      assert.ok(!/\b(von|of)\s+\d/.test(value), `${lang}/${key} tippt die Schrittzahl ein: ${value}`);
    }
  }
  const v = setup();
  seedClosedPerimeter(v.t);
  v.t.toggleLanguage();
  v.t.startExtension();
  assert.ok(v.t.ui.extendPanelText.textContent.startsWith(`Step 1 of ${total}:`),
    v.t.ui.extendPanelText.textContent);
});

test('Der Zoom reicht deutlich weiter als bis v64 — Minimum und Kennlinie unveraendert', () => {
  const { t } = setup();
  // Gemessen wird die Wirkung, nicht die Konstante: 30-fach war vorher (Grenze 14) nicht
  // erreichbar und wurde stillschweigend gekappt.
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  t.renderMap();
  t.beginCustomViewport();
  t.state.viewport.zoom = 120; t.clampViewport();
  assert.strictEqual(t.state.viewport.zoom, 120, 'die 120-fache Vergroesserung bleibt stehen');
  assert.ok(t.MAX_USER_ZOOM >= 200, `Obergrenze deutlich angehoben: ${t.MAX_USER_ZOOM}`);
  assert.strictEqual(t.MIN_USER_ZOOM, 0.6, 'das Minimum bleibt unveraendert');

  // Bei voller Vergroesserung liegen zwei 20 cm entfernte Punkte wirklich auseinander — genau
  // dafuer ist die Grenze angehoben worden.
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }];
  t.state.viewport.zoom = t.MAX_USER_ZOOM; t.clampViewport();
  t.renderMap();
  const a = t.toScreen({ x: 0, y: 0 }, t.state.currentTransform);
  const b = t.toScreen({ x: 0.2, y: 0 }, t.state.currentTransform);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 44,
    `20 cm sind bei voller Vergroesserung ein eigenes Ziel: ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} px`);
});

test('Die Kartenuebersicht nennt Datum und Uhrzeit der letzten Aenderung', () => {
  const { t } = setup();
  // Nur das Datum reichte nicht: zwei Staende desselben Nachmittags sahen gleich aus.
  const stamp = t.formatMapTimestamp('2026-09-12T14:37:00');
  const expectedDate = new Date('2026-09-12T14:37:00').toLocaleDateString('de-DE');
  const expectedTime = new Date('2026-09-12T14:37:00').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  assert.ok(stamp.includes(expectedDate), `Datum steht darin: ${stamp}`);
  assert.ok(stamp.includes(expectedTime), `Uhrzeit steht darin: ${stamp}`);
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(stamp), `ohne Sekunden: ${stamp}`);

  // Und die Zeile der Karte traegt genau diesen Text.
  t.state.maps = [{ ...t.state.activeMap, updatedAt: '2026-09-12T14:37:00' }];
  t.state.activeMap.updatedAt = '2026-09-12T14:37:00';
  t.renderMapGallery();
  const texts = [];
  const walk = (node) => { texts.push(node.textContent || ''); (node.children || []).forEach(walk); };
  (t.ui.mapGallery.children || []).forEach(walk);
  assert.ok(texts.some((x) => x.includes(expectedDate) && x.includes(expectedTime)),
    `die Karte zeigt Datum und Uhrzeit: ${texts.filter(Boolean).join(' | ')}`);
});

test('Ein laengeres Stueck faellt in einem Schritt weg und kommt mit einem Undo zurueck', async () => {
  const { t } = setup();
  // Sechseck mit einer kurzen, dicht besetzten Seite unten (0..3) und einem weiten Bogen oben.
  t.state.activeMap.perimeter = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    { x: 20, y: 30 }, { x: -17, y: 30 },
  ];
  t.state.activeMap.perimeterClosed = true;
  t.setMode('perimeter');
  t.refreshCaptureState();
  const before = perimeterXY(t);
  const undoBefore = t.state.undoStack.length;

  t.startExtension();
  const points = t.state.activeMap.perimeter;
  cutAtPoints(t, points, 0, 3);                 // die kurze untere Seite: zwei Punkte dazwischen
  await flush();

  assert.strictEqual(t.state.extension.phase, 'adding');
  assert.strictEqual(t.state.activeMap.perimeterClosed, false, 'die Kontur ist offen');
  assert.strictEqual(perimeterXY(t), '3,0 | 20,30 | -17,30 | 0,0',
    'die beiden Zwischenpunkte der kurzen Seite sind weg, der Rest steht in Ringrichtung');
  assert.strictEqual(t.state.undoStack.length, undoBefore + 1,
    'das Oeffnen samt Loeschen ist genau ein Schritt');

  // Aufnehmen haengt unveraendert am zuerst getippten Punkt an.
  t.state.telemetry.x = 1.5; t.state.telemetry.y = -2; t.state.fixHistory = [];
  await t.appendCurrentPoint();
  assert.strictEqual(perimeterXY(t), '3,0 | 20,30 | -17,30 | 0,0 | 1.5,-2');

  await t.undoLastAction();
  await t.undoLastAction();
  assert.strictEqual(perimeterXY(t), before, 'ein Undo bringt alle geloeschten Punkte zurueck');
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'und die Kontur ist wieder geschlossen');
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

/**
 * Faehrt AT+M,linear,angular im selben Einrad-/Differentialmodell nach, das Sunray benutzt,
 * und meldet zurueck, wo der Maeher landet. Der Roboter blickt anfangs nach +x; +y ist links
 * von ihm, -y rechts. Damit wird die *tatsaechliche Fahrtrichtung* geprueft und nicht nur ein
 * Vorzeichen — genau hier lag der Fehler: die Vorzeichen waren fuer sich genommen plausibel.
 */
function driveOutcome({ linear, angular }, steps = 400, dt = 0.005) {
  let x = 0; let y = 0; let th = 0;
  for (let i = 0; i < steps; i += 1) {
    x += linear * Math.cos(th) * dt;
    y += linear * Math.sin(th) * dt;
    th += angular * dt;
  }
  return {
    laengs: x > 0.01 ? 'vorwaerts' : x < -0.01 ? 'rueckwaerts' : 'steht',
    quer: y > 0.01 ? 'links' : y < -0.01 ? 'rechts' : 'geradeaus',
    th,
  };
}

test('Joystick: alle vier Quadranten fahren in die ausgelenkte Richtung', () => {
  const { t } = setup();
  t.state.view.driveSpeedMin = 0.10;
  t.state.view.driveSpeedMax = 0.30;
  // Stub-Joystick: 300x300 px, Mitte (150,150), Radius 116. 82 px ergeben eine volle Diagonale.
  const d = 82;
  const stick = (dx, dy) => t.joystickVectorFromPointer({ clientX: 150 + dx, clientY: 150 + dy });

  const cases = [
    ['vorne-links', -d, -d, 'vorwaerts', 'links'],
    ['vorne-rechts', d, -d, 'vorwaerts', 'rechts'],
    ['hinten-links', -d, d, 'rueckwaerts', 'links'],
    ['hinten-rechts', d, d, 'rueckwaerts', 'rechts'],
  ];
  for (const [name, dx, dy, laengs, quer] of cases) {
    const vector = stick(dx, dy);
    const out = driveOutcome(vector);
    assert.strictEqual(out.laengs, laengs, `${name}: Laengsrichtung`);
    assert.strictEqual(out.quer, quer,
      `${name}: der Maeher muss nach ${quer} ausweichen, tut es aber nach ${out.quer} `
      + `(linear=${vector.linear.toFixed(2)}, angular=${vector.angular.toFixed(2)})`);
  }

  // Die Vorwaertsfaelle duerfen sich durch die Spiegelung nicht veraendert haben.
  assert.ok(stick(-d, -d).angular > 0, 'vorne-links dreht weiterhin linksherum');
  assert.ok(stick(d, -d).angular < 0, 'vorne-rechts dreht weiterhin rechtsherum');
  // Rueckwaerts ist die Drehrate gegenueber vorwaerts gespiegelt.
  assert.ok(stick(-d, d).angular < 0, 'hinten-links braucht die entgegengesetzte Drehrate');
  assert.ok(stick(d, d).angular > 0, 'hinten-rechts braucht die entgegengesetzte Drehrate');
});

test('Joystick: Drehen auf der Stelle folgt der Vorwaertskonvention', () => {
  const { t } = setup();
  // Reine Seitwaertsauslenkung: kein Vortrieb, nur Drehung — hier gibt es keine Fahrtrichtung,
  // die man spiegeln koennte, also muss die Stickrichtung direkt gelten.
  const left = t.joystickVectorFromPointer({ clientX: 150 - 116, clientY: 150 });
  const right = t.joystickVectorFromPointer({ clientX: 150 + 116, clientY: 150 });
  assert.ok(left.linear === 0, 'kein Vortrieb');
  assert.ok(right.linear === 0, 'kein Vortrieb');
  assert.ok(left.angular > 0, 'nach links = linksherum');
  assert.ok(right.angular < 0, 'nach rechts = rechtsherum');
});

// === Allgemeines Rueckgaengig ==============================================
test('Rueckgaengig nimmt Schritte in umgekehrter Reihenfolge zurueck', async () => {
  const { t } = setup();
  await t.addCurrentPoint();
  t.state.telemetry.x = 9;
  await t.addCurrentPoint();
  assert.strictEqual(t.state.activeMap.perimeter.length, 2);
  assert.strictEqual(t.state.undoStack.length, 2, 'jede Aufnahme ist ein Schritt');

  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 1, 'der zuletzt gesetzte Punkt geht zuerst');
  assert.strictEqual(t.state.activeMap.perimeter[0].x, 2, 'und zwar der richtige');
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 0, 'mehrfaches Tippen arbeitet den Stapel ab');
  assert.strictEqual(t.state.undoStack.length, 0);
});

test('Rueckgaengig deckt auch Verschieben, Loeschen und Konturschluss ab', async () => {
  const { t } = setup();
  for (const x of [1, 2, 3]) { t.state.telemetry.x = x; await t.addCurrentPoint(); }

  // Verschieben
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.state.telemetry.x = 42;
  await t.addCurrentPoint(); // mit Auswahl = verschieben
  assert.strictEqual(t.state.activeMap.perimeter[0].x, 42);
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter[0].x, 1, 'das Verschieben ist zurueckgenommen');

  // Einzelnen Punkt loeschen
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.deleteSelectedPoint();
  assert.strictEqual(t.state.activeMap.perimeter.length, 2);
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 3, 'der geloeschte Punkt ist wieder da');

  // Kontur schliessen
  t.setMode('exclusion');
  await t.createExclusion();
  for (const x of [5, 6, 7]) { t.state.telemetry.x = x; await t.addCurrentPoint(); }
  const exclusion = t.currentExclusion();
  assert.strictEqual(exclusion.closed, false);
  await t.closeAllOpenContours();
  assert.strictEqual(t.currentExclusion().closed, true);
  await t.undoLastAction();
  assert.strictEqual(t.currentExclusion().closed, false, 'der Konturschluss ist zurueckgenommen');
});

test('Rueckgaengig nimmt eine ganze geloeschte Flaeche zurueck', async () => {
  const { t, sandbox } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  for (const x of [1, 2, 3]) { t.state.telemetry.x = x; await t.addCurrentPoint(); }
  const id = t.currentExclusion().id;
  t.state.selectedArea = id;
  sandbox.__confirmAnswer = true;
  await t.deleteSelectedArea();
  assert.strictEqual(t.state.activeMap.exclusions.length, 0);
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'die Flaeche ist zurueck');
  assert.strictEqual(t.state.activeMap.exclusions[0].points.length, 3, 'mitsamt ihren Punkten');
});

test('„Schliessen & neu“ ist genau ein Rueckgaengig-Schritt', async () => {
  const { t } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  for (const x of [1, 2, 3]) { t.state.telemetry.x = x; await t.addCurrentPoint(); }
  const before = t.state.undoStack.length;
  await t.closeAndStartNewExclusion();
  assert.strictEqual(t.state.activeMap.exclusions.length, 2, 'geschlossen und neu angelegt');
  assert.strictEqual(t.state.undoStack.length, before + 1,
    'die zusammengesetzte Aktion darf nur einen Schritt kosten');
  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'ein Tipp nimmt beides zurueck');
  assert.strictEqual(t.state.activeMap.exclusions[0].closed, false);
});

test('Der Rueckgaengig-Stapel ist auf 20 Schritte begrenzt', async () => {
  const { t } = setup();
  assert.strictEqual(t.UNDO_STACK_LIMIT, 20);
  for (let i = 0; i < 25; i += 1) { t.state.telemetry.x = i; await t.addCurrentPoint(); }
  assert.strictEqual(t.state.activeMap.perimeter.length, 25);
  assert.strictEqual(t.state.undoStack.length, 20, 'aeltere Schritte fallen hinten raus');
  // Der aelteste vorgehaltene Schritt gehoert zum 6. Punkt: 25 - 20 = 5 Punkte bleiben stehen.
  for (let i = 0; i < 20; i += 1) await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 5, 'weiter zurueck reicht der Verlauf nicht');
  assert.strictEqual(t.state.undoStack.length, 0);
});

test('Leerer Verlauf legt den Rueckgaengig-Knopf still', async () => {
  const { t } = setup();
  t.refreshCaptureState();
  assert.strictEqual(t.ui.undoBtn.disabled, true, 'ohne Schritte ausgegraut');
  await t.undoLastAction(); // darf nichts tun und nicht werfen
  assert.strictEqual(t.state.activeMap.perimeter.length, 0);

  await t.addCurrentPoint();
  assert.strictEqual(t.ui.undoBtn.disabled, false, 'mit Verlauf bedienbar');
  await t.undoLastAction();
  assert.strictEqual(t.ui.undoBtn.disabled, true, 'nach dem letzten Schritt wieder ausgegraut');
});

test('Der Rueckgaengig-Knopf verschwindet waehrend der Automatik und bei gesperrter Karte', async () => {
  const { t } = setup();
  await t.addCurrentPoint();
  t.refreshCaptureState();
  assert.strictEqual(t.ui.undoFabWrap.hidden, false);

  t.state.autoCaptureRunning = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.undoFabWrap.hidden, true, 'gleiche Regel wie beim Papierkorb');
  assert.strictEqual(t.ui.deleteFabWrap.hidden, true);
  t.state.autoCaptureRunning = false;

  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.undoFabWrap.hidden, true, 'in einer gesperrten Karte gibt es nichts zurueckzunehmen');
});

// === Distanzbasierte Automatik =============================================
/** Setzt die Live-Position und laesst die Automatik einmal pruefen. */
async function moveTo(t, x, y = 3) {
  t.state.telemetry.x = x;
  t.state.telemetry.y = y;
  t.state.telemetry.receivedAt = Date.now();
  t.state.fixHistory = []; // ohne Glaettung rechnet pointFromTelemetry mit dem rohen Wert
  await t.autoCaptureTick();
}

test('Distanzmodus setzt Punkte nach gefahrener Strecke, nicht nach Zeit', async () => {
  const { t } = setup();
  t.state.view.autoCaptureMode = 'distance';
  t.state.view.autoCaptureDistanceCm = 50;
  await t.startAutoCapture();
  assert.strictEqual(t.state.activeMap.perimeter.length, 1, 'der Start setzt den Bezugspunkt');
  const start = t.state.activeMap.perimeter[0];

  // 30 cm reichen nicht.
  await moveTo(t, start.x + 0.30);
  assert.strictEqual(t.state.activeMap.perimeter.length, 1, 'unter dem Schwellwert passiert nichts');
  // 49 cm auch nicht — knapp darunter darf nicht ausloesen.
  await moveTo(t, start.x + 0.49);
  assert.strictEqual(t.state.activeMap.perimeter.length, 1);
  // 50 cm loesen aus.
  await moveTo(t, start.x + 0.50);
  assert.strictEqual(t.state.activeMap.perimeter.length, 2, 'ab dem Schwellwert entsteht ein Punkt');

  // Gemessen wird ab dem zuletzt gesetzten Punkt, nicht ab dem Start.
  await moveTo(t, start.x + 0.80);
  assert.strictEqual(t.state.activeMap.perimeter.length, 2, '30 cm nach dem letzten Punkt reichen nicht');
  await moveTo(t, start.x + 1.00);
  assert.strictEqual(t.state.activeMap.perimeter.length, 3);

  // Auch quer zur Fahrtrichtung zaehlt die echte Strecke, nicht nur x.
  const last = t.state.activeMap.perimeter[2];
  await moveTo(t, last.x, last.y + 0.60);
  assert.strictEqual(t.state.activeMap.perimeter.length, 4, 'Strecke ist zweidimensional');
});

test('Zeitmodus bleibt vom Distanzschwellwert unberuehrt', async () => {
  const { t } = setup();
  assert.strictEqual(t.state.view.autoCaptureMode, 'time', 'Zeitbasiert bleibt Standard');
  await t.startAutoCapture();
  assert.strictEqual(t.state.activeMap.perimeter.length, 1);
  // Ohne jede Bewegung entsteht im Zeitmodus trotzdem der naechste Punkt.
  await t.autoCaptureTick();
  assert.strictEqual(t.state.activeMap.perimeter.length, 2, 'Zeitmodus fragt nicht nach Strecke');
});

test('Das Label traegt die Einheit des gewaehlten Modus', () => {
  const { t } = setup();
  t.state.view.autoCaptureIntervalS = 5;
  t.state.view.autoCaptureDistanceCm = 40;

  t.state.view.autoCaptureMode = 'time';
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto-Aufnahme (5s)');
  t.state.autoCaptureRunning = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatik läuft (5s)');

  t.state.view.autoCaptureMode = 'distance';
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatik läuft (40cm)');
  t.state.autoCaptureRunning = false;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto-Aufnahme (40cm)');
  assert.ok(!t.ui.autoCaptureLabel.textContent.includes('{'), 'kein unersetzter Platzhalter');

  t.toggleLanguage();
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto capture (40cm)', 'auch auf Englisch');
});

test('„Nur bei RTK FIX“ gilt in beiden Automatik-Modi', async () => {
  for (const mode of ['time', 'distance']) {
    const { t } = setup();
    t.state.view.autoCaptureMode = mode;
    t.state.view.autoCaptureDistanceCm = 10;
    t.ui.fixOnly.checked = true;
    t.state.telemetry.solution = 1; // Float, kein FIX

    await t.startAutoCapture();
    assert.strictEqual(t.state.autoCaptureRunning, false, `${mode}: ohne FIX startet die Automatik gar nicht`);
    assert.strictEqual(t.state.activeMap.perimeter.length, 0, `${mode}: und setzt keinen Punkt`);

    // Auch ein Verlust des FIX waehrend des Laufs darf keine Punkte mehr erzeugen.
    t.state.telemetry.solution = 2;
    await t.startAutoCapture();
    assert.strictEqual(t.state.activeMap.perimeter.length, 1, `${mode}: mit FIX laeuft es`);
    t.state.telemetry.solution = 1;
    t.state.telemetry.x = 99; // weit genug fuer den Distanzmodus
    await t.autoCaptureTick();
    assert.strictEqual(t.state.activeMap.perimeter.length, 1, `${mode}: ohne FIX kommt nichts dazu`);
  }
});

test('Distanzwert wird auf sinnvolle Grenzen gestutzt', () => {
  const { t } = setup();
  assert.strictEqual(t.AUTO_CAPTURE_DISTANCE_MIN_CM, 10, 'unter RTK-Rauschen waere sinnlos');
  assert.strictEqual(t.AUTO_CAPTURE_DISTANCE_MAX_CM, 1000);
  t.ui.autoCaptureModeSelect.value = 'distance';
  t.ui.autoCaptureDistanceInput.value = '2';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.autoCaptureDistanceCm, 10, 'zu klein wird angehoben');
  t.ui.autoCaptureDistanceInput.value = '5000';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.autoCaptureDistanceCm, 1000, 'zu gross wird gedeckelt');
});

test('Im Menue steht nur die Zeile des gewaehlten Modus', () => {
  const { t } = setup();
  t.state.view.autoCaptureMode = 'time';
  t.applyAutoCaptureModeToUi();
  assert.strictEqual(t.ui.autoCaptureIntervalRow.hidden, false);
  assert.strictEqual(t.ui.autoCaptureDistanceRow.hidden, true);
  t.state.view.autoCaptureMode = 'distance';
  t.applyAutoCaptureModeToUi();
  assert.strictEqual(t.ui.autoCaptureIntervalRow.hidden, true);
  assert.strictEqual(t.ui.autoCaptureDistanceRow.hidden, false);
});

test('Der Distanzmodus prueft im Takt der Positionsabfragen', async () => {
  const { t, clock } = setup();
  assert.strictEqual(t.BLE_POLL_INTERVAL_MS, 500, 'Grundlage der Distanzpruefung');
  t.state.view.autoCaptureMode = 'distance';
  // Das Zeitintervall darf im Distanzmodus keine Rolle spielen: mit 60 s waere nach einer
  // Sekunde noch kein einziger Takt gelaufen.
  t.state.view.autoCaptureIntervalS = 60;
  t.state.view.autoCaptureDistanceCm = 20;
  await t.startAutoCapture();
  const start = t.state.activeMap.perimeter[0];
  t.state.telemetry.x = start.x + 0.5;
  t.state.telemetry.receivedAt = clock.now();
  t.state.fixHistory = [];
  await clock.runFor(1200);
  assert.ok(t.state.activeMap.perimeter.length >= 2,
    `nach 1,2 s muss der eigene Takt gelaufen sein, Punkte: ${t.state.activeMap.perimeter.length}`);
});

// === Leere Ausschlussflaechen ==============================================
/** Legt Ausschlussflaechen mit den angegebenen Punktzahlen an und gibt ihre Ids zurueck. */
function seedExclusions(t, counts) {
  t.state.activeMap.exclusions = counts.map((count, i) => ({
    id: `ex${i + 1}`,
    name: `Ausschluss ${i + 1}`,
    closed: false,
    points: Array.from({ length: count }, (_, n) => ({ x: n, y: n })),
  }));
  return t.state.activeMap.exclusions.map((e) => e.id);
}

const exclusionLabels = (t) => t.mapElements().filter((i) => i.role === 'exclusion').map((i) => i.label).join(' | ');
const exclusionIds = (t) => t.state.activeMap.exclusions.map((e) => e.id).join(' | ');
const exclusionNames = (t) => t.state.activeMap.exclusions.map((e) => e.name).join(' | ');

test('Der Knopf „Neue Ausschlussfläche“ ist aus der Elementliste verschwunden', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!html.includes('newExclusionBtn'), 'der Knopf darf nicht mehr im Markup stehen');
  assert.ok(!src.includes('newExclusionBtn'), 'und auch nicht mehr verdrahtet sein');
  assert.ok(!src.includes("newExclusion:"), 'der tote Uebersetzungsschluessel ist entfernt');
  // Die Flaechen entstehen weiterhin von selbst beim ersten Punkt im Ausschluss-Modus.
  assert.ok(src.includes('await createExclusion();'), 'createExclusion() bleibt als Automatik erhalten');
});

test('Beim Verlassen des Ausschluss-Modus verschwindet die leere Kontur', async () => {
  const { t } = setup();
  seedExclusions(t, [3, 0]);
  t.setMode('exclusion');
  t.state.activeExclusionId = 'ex2';

  // Solange sie bearbeitet wird, bleibt sie stehen — sonst fiele man beim Moduswechsel
  // sofort wieder heraus.
  assert.strictEqual(t.pruneEmptyExclusions(), 0, 'die aktive Aufnahme ist geschuetzt');
  assert.strictEqual(t.state.activeMap.exclusions.length, 2);

  await t.requestModeChange('perimeter');
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'nach dem Verlassen ist sie weg');
  assert.strictEqual(t.state.activeMap.exclusions[0].id, 'ex1', 'die gefuellte bleibt');
  assert.strictEqual(t.state.activeExclusionId, 'ex1', 'das Aufnahmeziel wandert mit');
});

test('Eine leere, aber nicht aktive Flaeche wird auch im Ausschluss-Modus entfernt', () => {
  const { t } = setup();
  seedExclusions(t, [0, 0, 2]);
  t.setMode('exclusion');
  t.state.activeExclusionId = 'ex1'; // nur diese wird gerade bearbeitet
  assert.strictEqual(t.pruneEmptyExclusions(), 1, 'ex2 faellt weg, ex1 ist geschuetzt');
  assert.strictEqual(exclusionIds(t), 'ex1 | ex3');
});

test('Nach dem Aufraeumen sind die Flaechen lueckenlos von 1 an nummeriert', () => {
  const { t } = setup();
  seedExclusions(t, [2, 0, 3, 0, 4]);
  t.setMode('perimeter'); // kein Schutz aktiv
  assert.strictEqual(t.pruneEmptyExclusions(), 2);
  // Anzeige …
  assert.strictEqual(exclusionLabels(t), 'Ausschluss 1 | Ausschluss 2 | Ausschluss 3');
  // … und der gespeicherte Name, den der Export mitnimmt.
  assert.strictEqual(exclusionNames(t), 'Ausschluss 1 | Ausschluss 2 | Ausschluss 3');
  // Die Ids bleiben, was sie waren — die Nummer ist reine Beschriftung.
  assert.strictEqual(exclusionIds(t), 'ex1 | ex3 | ex5');
});

test('Eigene Namen ueberleben die Neunummerierung', () => {
  const { t } = setup();
  seedExclusions(t, [1, 0, 1]);
  t.state.activeMap.exclusions[2].name = 'Apfelbaum';
  t.setMode('perimeter');
  assert.strictEqual(t.pruneEmptyExclusions(), 1);
  assert.strictEqual(exclusionNames(t), 'Ausschluss 1 | Apfelbaum');
  assert.strictEqual(exclusionLabels(t), 'Ausschluss 1 | Apfelbaum');
});

test('Das Oeffnen des Menues raeumt Altlasten frueherer Sitzungen weg', () => {
  const { t } = setup();
  seedExclusions(t, [0, 4, 0, 0]);
  t.setMode('perimeter');
  t.setMenuOpen(true);
  assert.strictEqual(t.state.activeMap.exclusions.length, 1, 'nur die gefuellte bleibt uebrig');
  assert.strictEqual(exclusionLabels(t), 'Ausschluss 1');
  t.setMenuOpen(false);
});

test('Im Ausschluss-Modus ueberlebt die aktive Aufnahme auch das Oeffnen des Menues', () => {
  const { t } = setup();
  seedExclusions(t, [2, 0, 0]);
  t.setMode('exclusion');
  t.state.activeExclusionId = 'ex3';
  t.setMenuOpen(true);
  assert.strictEqual(exclusionIds(t), 'ex1 | ex3');
  assert.strictEqual(t.state.activeExclusionId, 'ex3', 'das Aufnahmeziel bleibt erhalten');
  t.setMenuOpen(false);
});

test('In einer gesperrten Karte wird nichts aufgeraeumt', () => {
  const { t } = setup();
  seedExclusions(t, [0, 1]);
  t.setMode('perimeter');
  t.state.activeMap.locked = true;
  assert.strictEqual(t.pruneEmptyExclusions(), 0);
  assert.strictEqual(t.state.activeMap.exclusions.length, 2, 'gesperrte Karten bleiben unangetastet');
});

test('Jeder Uebersetzungsschluessel existiert in beiden Sprachen und wird benutzt', () => {
  // Die Hilfe ist der groesste Block an i18n-Text und veraltet am leichtesten. Dieser Fall
  // faengt beide Richtungen ab: ein Schluessel, den nur eine Sprache kennt (die Oberflaeche
  // zeigte dann den rohen Schluessel), und ein Schluessel ohne Verwendung (Beschreibung einer
  // Funktion, die es nicht mehr gibt).
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const deStart = src.indexOf('  de: {');
  const enStart = src.indexOf('  en: {');
  const keysOf = (block) => new Set([...block.matchAll(/(?:^|[{,]\s*|\n\s{4})([A-Za-z][A-Za-z0-9_]*):\s/g)]
    .map((m) => m[1]));
  const de = keysOf(src.slice(deStart, enStart));
  const en = keysOf(src.slice(enStart, src.indexOf('\n};', enStart)));
  assert.ok(de.size > 100, 'die Schluessel muessen gefunden worden sein');

  const onlyDe = [...de].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !de.has(k));
  assert.strictEqual(onlyDe.join(','), '', 'diese Schluessel fehlen im Englischen');
  assert.strictEqual(onlyEn.join(','), '', 'diese Schluessel fehlen im Deutschen');

  const used = new Set([
    ...[...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/\btr\('([^']+)'/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((k) => !de.has(k) || !en.has(k));
  assert.strictEqual(missing.join(','), '', 'benutzte Schluessel ohne Uebersetzung');

  // Hilfetexte werden ausschliesslich ueber data-i18n eingesetzt — ein unbenutzter help*-
  // Schluessel beschreibt also eine Funktion, die aus der Oberflaeche verschwunden ist.
  const deadHelp = [...de].filter((k) => /^help[A-Z]/.test(k) && !used.has(k));
  assert.strictEqual(deadHelp.join(','), '', 'Hilfetexte ohne Verwendung');

  // Und die beiden ausdruecklich entfernten Themen duerfen nicht zurueckkommen.
  for (const gone of ['helpSmartAutoTitle', 'helpVersionsTitle']) {
    assert.ok(!de.has(gone), `${gone} beschreibt eine entfernte Funktion`);
  }
});

// === Punkt geometrisch davor/danach einfuegen ==============================
/** Legt eine Perimeter-Kontur mit den angegebenen x-Werten an (y = 0). */
function seedPerimeter(t, xs, { closed = false } = {}) {
  t.state.activeMap.perimeter = xs.map((x) => ({ x, y: 0, gps: { solution: 2, accuracy: 0.02 } }));
  t.state.activeMap.perimeterClosed = closed;
  t.setMode('perimeter');
}
const perimeterXs = (t) => t.state.activeMap.perimeter.map((p) => p.x).join(',');

test('„Punkt davor“ setzt den neuen Punkt auf die Mitte zum Vorgaenger', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20, 30]);          // A B C D
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null }); // B
  // Die Live-Position ist bewusst weit weg: sie darf keine Rolle spielen.
  t.state.telemetry.x = 999; t.state.fixHistory = [];

  await t.insertPointAtSelection(0);
  assert.strictEqual(perimeterXs(t), '0,5,10,20,30', 'A-[Mitte AB]-B-C-D');
});

test('„Punkt danach“ setzt den neuen Punkt auf die Mitte zum Nachfolger', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20, 30]);
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null }); // B
  t.state.telemetry.x = 999; t.state.fixHistory = [];

  await t.insertPointAtSelection(1);
  assert.strictEqual(perimeterXs(t), '0,10,15,20,30', 'A-B-[Mitte BC]-C-D');
});

test('Der Mittelpunkt wird in beiden Achsen gebildet', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 6 }];
  t.setMode('perimeter');
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.insertPointAtSelection(0);
  const mid = t.state.activeMap.perimeter[1];
  assert.strictEqual(mid.x, 2);
  assert.strictEqual(mid.y, 3);
  assert.strictEqual(mid.interpolated, true, 'der Punkt ist als konstruiert gekennzeichnet');
});

test('Die Live-Position spielt keine Rolle — auch ohne Verbindung geht es', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20]);
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  // Weder frische Telemetrie noch RTK FIX: rein geometrisch ist beides egal.
  t.ui.fixOnly.checked = true;
  t.state.telemetry.solution = 0;
  t.state.telemetry.receivedAt = 0;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeBtn.disabled, false, '„Nur bei RTK FIX“ greift hier nicht');

  await t.insertPointAtSelection(0);
  assert.strictEqual(perimeterXs(t), '0,5,10,20');
});

test('Am Rand einer offenen Kontur fehlt die Strecke', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20]);              // offen

  // Erster Punkt: „davor“ hat keinen Vorgaenger.
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeBtn.disabled, true, 'kein Vorgaenger, also gesperrt');
  assert.strictEqual(t.ui.insertAfterBtn.disabled, false, 'nach hinten geht es');
  assert.strictEqual(await t.insertPointAtSelection(0), null, 'und der Aufruf tut nichts');
  assert.strictEqual(perimeterXs(t), '0,10,20', 'die Punktfolge bleibt unveraendert');

  // Letzter Punkt: „danach“ hat keinen Nachfolger.
  t.applyPointSelection({ role: 'perimeter', index: 2, exclusionId: null });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertAfterBtn.disabled, true, 'kein Nachfolger, also gesperrt');
  assert.strictEqual(t.ui.insertBeforeBtn.disabled, false);
  assert.strictEqual(await t.insertPointAtSelection(1), null);
  assert.strictEqual(perimeterXs(t), '0,10,20');
});

test('In einer geschlossenen Kontur laeuft der Rand ueber die Schlussstrecke um', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20], { closed: true });

  // Erster Punkt, „davor“: Mitte der Schlussstrecke letzter→erster, also zwischen 20 und 0.
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeBtn.disabled, false, 'geschlossen: es gibt einen Nachbarn');
  await t.insertPointAtSelection(0);
  assert.strictEqual(perimeterXs(t), '10,0,10,20',
    'der neue Punkt (10) steht vorn, die Kontur schliesst von 20 auf ihn');

  // Letzter Punkt, „danach“: ebenfalls die Schlussstrecke.
  seedPerimeter(t, [0, 10, 20], { closed: true });
  t.applyPointSelection({ role: 'perimeter', index: 2, exclusionId: null });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertAfterBtn.disabled, false);
  await t.insertPointAtSelection(1);
  assert.strictEqual(perimeterXs(t), '0,10,20,10', 'der neue Punkt haengt hinten an');
});

test('Einfuegen gilt in jeder Elementart', async () => {
  const { t } = setup();
  // Wegpunkte sind ein offener Pfad mit fester Reihenfolge — „davor/danach“ ist dort eindeutig.
  t.state.activeMap.waypoints = [{ x: 0, y: 0 }, { x: 8, y: 0 }];
  t.setMode('waypoint');
  t.applyPointSelection({ role: 'waypoint', index: 0, exclusionId: null });
  await t.insertPointAtSelection(1);
  assert.strictEqual(t.state.activeMap.waypoints.map((p) => p.x).join(','), '0,4,8');

  // Dockpfad, ebenfalls offen.
  t.state.activeMap.dockPoints = [{ x: 0, y: 0 }, { x: 6, y: 0 }];
  t.setMode('dock');
  t.applyPointSelection({ role: 'dock', index: 1, exclusionId: null });
  await t.insertPointAtSelection(0);
  assert.strictEqual(t.state.activeMap.dockPoints.map((p) => p.x).join(','), '0,3,6');

  // Ausschlussflaeche, geschlossen: der Umlauf gilt auch hier.
  t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }];
  t.state.activeExclusionId = 'ex1';
  t.setMode('exclusion');
  t.applyPointSelection({ role: 'exclusion', index: 0, exclusionId: 'ex1' });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeBtn.disabled, false, 'geschlossene Flaeche laeuft um');
  await t.insertPointAtSelection(0);
  assert.strictEqual(t.state.activeMap.exclusions[0].points.map((p) => `${p.x}/${p.y}`).join(','),
    '5/5,0/0,10/0,10/10');
});

test('Ein eingefuegter Punkt erbt die schlechtere Guete seiner Nachbarn', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [
    { x: 0, y: 0, gps: { solution: 2, accuracy: 0.02 } },   // FIX
    { x: 10, y: 0, gps: { solution: 1, accuracy: 0.40 } },  // Float
  ];
  t.setMode('perimeter');
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.insertPointAtSelection(0);
  const mid = t.state.activeMap.perimeter[1];
  assert.strictEqual(mid.gps.solution, 1,
    'ein konstruierter Punkt ist hoechstens so gut wie die schlechtere Seite seiner Strecke');
  assert.strictEqual(mid.interpolated, true);
});

test('Nach dem Einfuegen faellt die Oberflaeche in den Normalzustand zurueck', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20, 30]);
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, false, 'mit Auswahl sichtbar');
  assert.strictEqual(t.ui.insertAfterWrap.hidden, false);
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Punktauswahl löschen');

  await t.insertPointAtSelection(1);

  assert.strictEqual(t.state.selectedPoint, null, 'die Auswahl ist aufgehoben');
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'ohne Auswahl wieder weg');
  assert.strictEqual(t.ui.insertAfterWrap.hidden, true);
  assert.strictEqual(t.ui.deleteBtnLabel.textContent, 'Letzten Punkt', 'der Papierkorb ist zurueck im Normalzustand');
  assert.ok(t.ui.pointStatus.textContent.includes('3'), 'die Meldung nennt die Einfuegeposition');
});

test('Die Einfuegen-Werkzeuge erscheinen nur bei ausgewaehltem Einzelpunkt', () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20]);
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'ohne Auswahl nicht vorhanden');
  assert.strictEqual(t.ui.insertAfterWrap.hidden, true);

  // Bei ausgewaehlter Flaeche gibt es keinen Punkt, zu dessen Nachbarn man messen koennte.
  t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }];
  t.state.activeExclusionId = 'ex1';
  t.state.selectedArea = 'ex1';
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'Flaechenauswahl ist kein Einzelpunkt');
  t.state.selectedArea = null;

  // Waehrend der Automatik bleiben sie weg — wie der Papierkorb.
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.state.autoCaptureRunning = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'gleiche Regel wie beim Papierkorb');
  assert.strictEqual(t.ui.deleteFabWrap.hidden, true);
  t.state.autoCaptureRunning = false;

  // Gesperrte Karte: nichts einzufuegen.
  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'gesperrte Karte laesst nichts einfuegen');
});

test('Rueckgaengig nimmt ein Einfuegen zurueck', async () => {
  const { t } = setup();
  seedPerimeter(t, [0, 10, 20]);
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  const before = t.state.undoStack.length;

  await t.insertPointAtSelection(0);
  assert.strictEqual(perimeterXs(t), '0,5,10,20');
  assert.strictEqual(t.state.undoStack.length, before + 1, 'genau ein Schritt');

  await t.undoLastAction();
  assert.strictEqual(perimeterXs(t), '0,10,20', 'das Einfuegen ist zurueckgenommen');
});

// === Positionsmodus in der Kartenverwaltung ================================
test('Der Positionsmodus ist relativ voreingestellt und blendet die Ursprungsfelder aus', () => {
  const { t } = setup();
  t.renderPositionMode();
  assert.strictEqual(t.ui.positionModeSelect.value, 'relative');
  assert.strictEqual(t.ui.originFields.hidden, true, 'ohne „Absolut“ kein Eingabefeld');
});

test('„Absolut“ zeigt die Ursprungsfelder und schreibt sie in die Karte', async () => {
  const { t } = setup();
  t.ui.positionModeSelect.value = 'absolute';
  t.ui.originLatInput.value = '48.5';
  t.ui.originLonInput.value = '9.25';
  await t.updatePositionModeFromUi();

  assert.strictEqual(t.state.activeMap.positionMode, 'absolute');
  assert.strictEqual(t.state.activeMap.origin.lat, 48.5);
  assert.strictEqual(t.state.activeMap.origin.lon, 9.25);
  assert.strictEqual(t.ui.originFields.hidden, false, 'die Felder sind sichtbar');

  // Zurueck auf relativ raeumt den Ursprung wieder ab.
  t.ui.positionModeSelect.value = 'relative';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.positionMode, 'relative');
  assert.strictEqual(t.state.activeMap.origin, null);
  assert.strictEqual(t.ui.originFields.hidden, true);
});

test('Ein unsinniger Ursprung erzeugt keine falschen Grad', async () => {
  const { t } = setup();
  t.ui.positionModeSelect.value = 'absolute';
  t.ui.originLatInput.value = '200';       // ausserhalb -90..90
  t.ui.originLonInput.value = '9.25';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.origin, null, 'der Wert wird verworfen');

  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  const g = t.mapToGeoJson(t.state.activeMap);
  assert.strictEqual(g.properties.coordinateSystem, 'sunray-local-xy-meters',
    'ohne gueltigen Ursprung bleibt der Export bei lokalen Metern');
});

test('Der Positionsmodus gehoert zur Karte, nicht zur App', async () => {
  const { t } = setup();
  // Zweite Karte anlegen und die erste auf absolut stellen.
  const second = t.normalizeMap(t.makeMap('Zweite'));
  t.state.maps.push(second);
  t.ui.positionModeSelect.value = 'absolute';
  t.ui.originLatInput.value = '48.5';
  t.ui.originLonInput.value = '9.25';
  await t.updatePositionModeFromUi();
  const firstId = t.state.activeMap.id;

  t.setActiveMapById(second.id);
  t.renderPositionMode();
  assert.strictEqual(t.state.activeMap.positionMode, 'relative',
    'die zweite Karte an einem anderen Ort bleibt unberuehrt');
  assert.strictEqual(t.ui.positionModeSelect.value, 'relative');
  assert.strictEqual(t.ui.originFields.hidden, true);

  t.setActiveMapById(firstId);
  t.renderPositionMode();
  assert.strictEqual(t.ui.positionModeSelect.value, 'absolute', 'und die erste behaelt ihren Modus');
  assert.strictEqual(t.ui.originLatInput.value, '48.5');
});

test('In einer gesperrten Karte laesst sich der Positionsmodus nicht aendern', async () => {
  const { t } = setup();
  t.state.activeMap.locked = true;
  t.ui.positionModeSelect.value = 'absolute';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.positionMode, 'relative', 'gesperrt heisst gesperrt');
  assert.strictEqual(t.ui.positionModeSelect.disabled, true);
});

// === Richtungstasten statt Joystick ========================================
/**
 * Versetzt die App in einen Zustand, in dem Fahrbefehle tatsaechlich rausgehen, und schneidet
 * mit, was gesendet wird. Der Fake-BLE-Stack wird hier nicht gebraucht — es geht nur um die
 * erzeugten Kommandos.
 */
function readyToDrive(t) {
  const chunks = [];
  t.state.connected = true;
  t.state.demo = false;
  t.state.sendBusy = false;
  t.state.encryptionEnabled = false;
  t.state.characteristic = {
    properties: { write: true },
    writeValueWithResponse: async (chunk) => { chunks.push(Buffer.from(chunk).toString('utf8')); },
  };
  return {
    drives: () => chunks.join('').split(/\r?\n/).filter((line) => line.startsWith('AT+M')),
    last: () => chunks.join('').split(/\r?\n/).filter((line) => line.startsWith('AT+M')).pop(),
  };
}

test('Der Umschalter tauscht Joystick und Richtungstasten', () => {
  const { t } = setup();
  assert.strictEqual(t.state.view.driveControl, 'joystick', 'Joystick bleibt der Standard');
  t.applyDriveControlMode();
  assert.strictEqual(t.ui.driveJoystick.hidden, false);
  assert.strictEqual(t.ui.driveButtons.hidden, true);
  // Der Knopf benennt das **Ziel** des Tippens, nicht den Ist-Zustand.
  assert.strictEqual(t.ui.driveModeLabel.textContent, 'Zu Richtungstasten wechseln',
    'im Joystick-Modus fuehrt der Knopf zu den Richtungstasten');
  assert.strictEqual(t.ui.cursorSpeedRow.hidden, true, 'ohne Tastenmodus keine Cursor-Geschwindigkeit');

  t.toggleDriveControl();
  assert.strictEqual(t.state.view.driveControl, 'buttons');
  assert.strictEqual(t.ui.driveJoystick.hidden, true);
  assert.strictEqual(t.ui.driveButtons.hidden, false);
  assert.strictEqual(t.ui.driveModeLabel.textContent, 'Zu Joystick wechseln',
    'und umgekehrt zurueck zum Joystick');
  assert.strictEqual(t.ui.cursorSpeedRow.hidden, false);

  t.toggleDriveControl();
  assert.strictEqual(t.state.view.driveControl, 'joystick', 'und wieder zurueck');
});

test('Die Wahl der Steuerung uebersteht einen Neustart', () => {
  const { t, sandbox } = setup();
  t.toggleDriveControl();                       // auf Tasten
  t.state.view.cursorSpeedCms = 9;
  t.saveViewPreferences();
  // Neu laden: die Einstellungen kommen aus dem localStorage zurueck.
  t.state.view.driveControl = 'joystick';
  t.state.view.cursorSpeedCms = 15;
  t.loadViewPreferences();
  assert.strictEqual(t.state.view.driveControl, 'buttons');
  assert.strictEqual(t.state.view.cursorSpeedCms, 9);
  void sandbox;
});

test('Jede Richtungstaste fahrt mit der eigenen Cursor-Geschwindigkeit', () => {
  const { t } = setup();
  t.state.view.driveSpeedMax = 0.30;   // Joystick-Maximum, darf hier keine Rolle spielen
  t.state.view.cursorSpeedCms = 12;    // 0,12 m/s
  t.state.view.mowerWidth = 0.40;      // halbe Spurweite 0,20 m

  const up = t.cursorDriveVector('up');
  assert.ok(Math.abs(up.linear - 0.12) < 1e-9, 'vorwaerts mit dem Cursor-Wert, nicht mit 0,30');
  assert.strictEqual(up.angular, 0, 'kein seitliches Lenken — genau darum geht es');

  const down = t.cursorDriveVector('down');
  assert.ok(Math.abs(down.linear + 0.12) < 1e-9);
  assert.strictEqual(down.angular, 0);

  // Links/rechts drehen auf der Stelle: linear 0, Drehrate aus v / halber Spurweite. **`v` ist
  // hier die Haelfte des Hoechstwerts, nicht die Tastengeschwindigkeit** — der Keil hat seit der
  // Sanduhrform keine Zonen, und der halbe Hoechstwert fuehrt keine neue Zahl ein.
  const left = t.cursorDriveVector('left');
  const right = t.cursorDriveVector('right');
  assert.strictEqual(left.linear, 0, 'Drehung auf der Stelle');
  assert.strictEqual(right.linear, 0);
  assert.ok(Math.abs(left.angular - 0.75) < 1e-9, '(0,30 / 2) / 0,20 = 0,75 rad/s');
  assert.ok(Math.abs(right.angular + 0.75) < 1e-9, 'rechts ist genau gespiegelt');
  // Und die Tastengeschwindigkeit bewegt daran nichts.
  t.state.view.cursorSpeedCms = 25;
  assert.ok(Math.abs(t.cursorDriveVector('left').angular - 0.75) < 1e-9,
    'das Drehen haengt am Hoechstwert, nicht am Tastenwert');
  t.state.view.cursorSpeedCms = 12;

  // Die eingestellte Hoechst-Drehrate bleibt die Obergrenze.
  t.state.view.driveTurnMax = 0.30;
  assert.ok(Math.abs(t.cursorDriveVector('left').angular - 0.30) < 1e-9, 'gedeckelt auf turnMax');
});

test('Halten fahert, Loslassen stoppt sofort', async () => {
  const { t, clock } = setup();
  const tx = readyToDrive(t);
  t.state.view.cursorSpeedCms = 20;
  t.toggleDriveControl();

  t.beginCursorDrive('up', { pointerId: 1, preventDefault() {} });
  await clock.runFor(50);
  assert.strictEqual(t.state.driveDirection, 'up');
  assert.ok(tx.last().startsWith('AT+M,0.20,0.00'), `vorwaerts mit 0,20 m/s, gesendet: ${tx.last()}`);

  // Der Totmann-Takt schickt denselben Vektor nach, solange gehalten wird.
  const before = tx.drives().length;
  await clock.runFor(1400);
  assert.ok(tx.drives().length > before, 'Sunray stoppt ohne Nachschub nach 1 s — der Takt muss laufen');

  t.stopDrive();
  await clock.runFor(50);
  assert.strictEqual(t.state.driveDirection, null);
  assert.ok(tx.last().startsWith('AT+M,0,0'), `Loslassen stoppt sofort, gesendet: ${tx.last()}`);
});

/** Ein Punkt auf dem Tastenkreuz, `share` als Anteil der Strecke Mitte -> Aussenkante. */
function padPoint(t, direction, share) {
  const rect = t.ui.driveButtons.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const away = share * (direction === 'left' || direction === 'right' ? rect.width : rect.height) / 2;
  if (direction === 'up') return { clientX: cx, clientY: cy - away };
  if (direction === 'down') return { clientX: cx, clientY: cy + away };
  if (direction === 'left') return { clientX: cx - away, clientY: cy };
  return { clientX: cx + away, clientY: cy };
}

/** Eine Richtungstaste an der Stelle `share` druecken — samt Tastenelement, wie beim echten Tipp. */
function pressKey(t, direction, share, pointerId = 1) {
  const key = { dataset: { direction }, closest: () => key };
  t.beginCursorDrive(direction, {
    pointerId, target: key, currentTarget: t.ui.driveButtons, preventDefault() {}, ...padPoint(t, direction, share),
  });
  return key;
}

/** Auslieferungswerte der Staffel: 8 / 15 / 25 cm/s, ohne eine einzige neue Zahl. */
function zonedSetup() {
  const { t, clock } = setup();
  const tx = readyToDrive(t);
  t.state.view.driveSpeedMin = 0.08;
  t.state.view.driveSpeedMax = 0.25;
  t.state.view.cursorSpeedCms = 15;
  t.state.view.driveZones = true;
  t.toggleDriveControl();
  return { t, clock, tx };
}

test('Die Zone haengt an der Fingerposition, nicht an der Taste allein', async () => {
  const { t, clock, tx } = zonedSetup();
  // Innen langsam, aussen schnell — gemessen am tatsaechlich gesendeten Befehl.
  for (const [share, speed] of [[0.10, '0.08'], [0.60, '0.15'], [0.90, '0.25']]) {
    pressKey(t, 'up', share);
    await clock.runFor(50);
    assert.ok(tx.last().startsWith(`AT+M,${speed},0.00`),
      `bei ${Math.round(share * 100)} % von der Mitte muss ${speed} m/s rausgehen, gesendet: ${tx.last()}`);
    t.stopDrive();
    await clock.runFor(50);
  }
  // Die Grenzen selbst gehoeren zur jeweils aeusseren Zone.
  const [inner, outer] = t.DRIVE_ZONES.map((zone) => zone.until);
  assert.strictEqual(t.cursorZoneFromPointer('up', padPoint(t, 'up', inner)), 'normal');
  assert.strictEqual(t.cursorZoneFromPointer('up', padPoint(t, 'up', outer)), 'fast');
  // Und wer ueber die Kante hinausschiebt, bleibt in der schnellsten Zone statt herauszufallen.
  assert.strictEqual(t.cursorZoneFromPointer('up', padPoint(t, 'up', 3)), 'fast');
});

test('Der Wechsel beim Schieben wirkt auf den gesendeten Befehl', async () => {
  const { t, clock, tx } = zonedSetup();
  const key = pressKey(t, 'up', 0.10);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.08'), `Start innen, gesendet: ${tx.last()}`);
  assert.strictEqual(key.dataset.zone, 'slow', 'die aktive Zone ist an der Taste markiert');

  // Nach aussen schieben, ohne loszulassen.
  t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'up', 0.90) });
  // **Zuerst der Vektor:** die Sendung kann an DRIVE_POINTER_MIN_INTERVAL_MS scheitern, der
  // 650-ms-Takt muss den neuen Wert trotzdem tragen.
  assert.strictEqual(t.state.driveVector.linear, 0.25, 'der Vektor folgt dem Finger sofort');
  assert.strictEqual(key.dataset.zone, 'fast', 'die Markierung wandert mit');
  await clock.runFor(900);
  assert.ok(tx.last().startsWith('AT+M,0.25'), `spaetestens der Takt traegt es, gesendet: ${tx.last()}`);

  t.stopDrive();
  await clock.runFor(50);
  assert.strictEqual(key.dataset.zone, undefined, 'nach dem Loslassen ist keine Zone mehr markiert');
});

test('Ohne Zoneneinteilung faehrt die Taste wie zuvor', async () => {
  const { t, clock, tx } = zonedSetup();
  t.state.view.driveZones = false;
  for (const share of [0.10, 0.50, 0.90]) {
    const key = pressKey(t, 'up', share);
    await clock.runFor(50);
    assert.ok(tx.last().startsWith('AT+M,0.15,0.00'),
      `ohne Zonen gilt ueberall der eingetragene Wert, bei ${share} gesendet: ${tx.last()}`);
    assert.strictEqual(key.dataset.zone, undefined, 'ohne Zonen wird auch nichts markiert');
    // Und das Schieben aendert daran nichts.
    t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'up', 0.95) });
    assert.strictEqual(t.state.driveVector.linear, 0.15, 'abgeschaltet heisst abgeschaltet');
    t.stopDrive();
    await clock.runFor(50);
  }
});

test('Drehen laeuft mit fester Geschwindigkeit, unabhaengig von Zone und Schalter', async () => {
  const { t, clock, tx } = zonedSetup();
  // Halbe Spurweite 0,25 m und ein hoher Deckel, damit die Drehrate unverfaelscht ablesbar ist:
  // die Haelfte des Hoechstwerts ist 0,125 m/s, geteilt durch 0,25 m ergibt 0,50 rad/s.
  t.state.view.mowerWidth = 0.50;
  t.state.view.driveTurnMax = 2.00;

  // (a) Innen wie aussen dasselbe — der Keil hat keine Zonen.
  for (const share of [0.10, 0.60, 0.95]) {
    const key = pressKey(t, 'left', share);
    await clock.runFor(50);
    assert.ok(tx.last().startsWith('AT+M,0.00,0.50'),
      `links dreht ueberall gleich, bei ${share} gesendet: ${tx.last()}`);
    assert.strictEqual(key.dataset.zone, undefined, 'und traegt nirgends eine Zonenmarkierung');
    // Auch das Schieben aendert nichts.
    t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'left', 0.95) });
    assert.strictEqual(t.state.driveVector.angular, 0.50, 'das Schieben aendert die Drehrate nicht');
    t.stopDrive();
    await clock.runFor(50);
  }

  // (b) Rechts ist dasselbe mit umgekehrtem Vorzeichen.
  pressKey(t, 'right', 0.90);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,-0.50'), `rechts dreht gegenlaeufig, gesendet: ${tx.last()}`);
  t.stopDrive();
  await clock.runFor(50);

  // (c) Der Zonenschalter fasst das Drehen nicht an — weder an noch aus.
  t.state.view.driveZones = false;
  pressKey(t, 'left', 0.90);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,0.50'),
    `ohne Zonen dreht es genauso, gesendet: ${tx.last()}`);
  t.stopDrive();
  await clock.runFor(50);
  t.state.view.driveZones = true;

  // (d) Es haengt am Hoechstwert, nicht an der Tastengeschwindigkeit: der Tastenwert wandert,
  // die Drehrate nicht; der Hoechstwert wandert, die Drehrate mit.
  t.state.view.cursorSpeedCms = 8;
  pressKey(t, 'left', 0.90);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,0.50'),
    `die Tastengeschwindigkeit darf das Drehen nicht bewegen, gesendet: ${tx.last()}`);
  t.stopDrive();
  await clock.runFor(50);
  t.state.view.driveSpeedMax = 0.40;
  pressKey(t, 'left', 0.90);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,0.80'),
    `die Haelfte von 0,40 m/s ergibt 0,80 rad/s, gesendet: ${tx.last()}`);
  t.stopDrive();
  await clock.runFor(50);

  // (e) Der Deckel greift weiterhin.
  t.state.view.driveTurnMax = 0.30;
  pressKey(t, 'left', 0.90);
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,0.30'),
    `driveTurnMax deckelt die feste Drehrate, gesendet: ${tx.last()}`);
  t.stopDrive();
});

test('Schieben startet keine Fahrt und haelt keine beendete am Leben', async () => {
  const { t, clock, tx } = zonedSetup();
  // (a) Es wurde nie gedrueckt.
  t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'up', 0.90) });
  await clock.runFor(1500);
  assert.strictEqual(t.state.driveDirection, null, 'ein Wisch ueber das Kreuz darf nichts starten');
  assert.deepStrictEqual(tx.drives(), [], 'und erst recht keinen Fahrbefehl senden');
  assert.strictEqual(t.state.driveTimer, null, 'auch keinen Takt anwerfen');

  // (b) Nach dem Loslassen.
  pressKey(t, 'up', 0.10);
  await clock.runFor(50);
  t.stopDrive();
  await clock.runFor(50);
  const afterStop = tx.drives().length;
  t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'up', 0.90) });
  await clock.runFor(1500);
  assert.strictEqual(t.state.driveDirection, null, 'eine beendete Fahrt bleibt beendet');
  assert.strictEqual(tx.drives().length, afterStop, 'nach dem Stopp geht nichts mehr raus');
  assert.strictEqual(t.state.driveTimer, null, 'und es laeuft kein Takt weiter');

  // (c) Ein fremder Zeiger waehrend einer laufenden Tastenfahrt aendert nichts.
  pressKey(t, 'up', 0.10, 1);
  await clock.runFor(50);
  t.updateCursorDriveFromPointer({ pointerId: 9, ...padPoint(t, 'up', 0.90) });
  assert.strictEqual(t.state.driveVector.linear, 0.08, 'ein zweiter Finger verstellt die Zone nicht');

  // (d) Waehrend der Joystick faehrt, ist das Tastenkreuz nicht zustaendig.
  t.stopDrive();
  t.state.driveDirection = 'joystick';
  t.state.driveVector = { linear: 0.11, angular: 0 };
  t.updateCursorDriveFromPointer({ pointerId: 1, ...padPoint(t, 'up', 0.90) });
  assert.strictEqual(t.state.driveVector.linear, 0.11, 'der Joystick fuehrt seinen Vektor selbst');
  t.stopDrive();
});

test('Der Schiebe-Pfad ist verdrahtet, und alle sechs Stoppwege stehen weiterhin', () => {
  // Klicks lassen sich im Harness nicht ausloesen (addEventListener ist ein No-Op), deshalb
  // wird die Verdrahtung im Quelltext festgehalten — dieselbe Bauart wie beim Verschieben-Knopf.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/ui\.driveButtons\.addEventListener\('pointermove',[\s\S]{0,90}?updateCursorDriveFromPointer\(/.test(src),
    'das Schieben muss am Tastenkreuz haengen');
  assert.ok(/\['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'\][\s\S]{0,120}?ui\.driveButtons[\s\S]{0,200}?stopDrive\(\)/.test(src),
    'alle vier Zeigerenden muessen weiterhin stoppen');
  assert.ok(/document\.hidden\)\s*\{\s*stopDrive\(\)/.test(src), 'verdeckte Seite stoppt');
  assert.ok(/window\.addEventListener\('blur',\s*\(\)\s*=>\s*\{\s*stopDrive\(\)/.test(src), 'Fokusverlust stoppt');

  // **Die harte Auflage aus dem Bericht, strukturell festgehalten:** der Schiebe-Pfad darf
  // nichts starten und nichts am Leben halten. Ein Aufruf von beginCursorDrive(),
  // startDriveHeartbeat() oder ein eigener Zeitgeber waere genau das.
  const start = src.indexOf('function updateCursorDriveFromPointer');
  assert.ok(start > 0, 'der Schiebe-Pfad muss eine eigene Funktion sein');
  const body = src.slice(start, src.indexOf('\n}', start));
  for (const verboten of ['beginCursorDrive', 'startDriveHeartbeat', 'setInterval', 'setTimeout', 'driveTimer']) {
    assert.ok(!body.includes(verboten),
      `der Schiebe-Pfad darf ${verboten} nicht anfassen — er veraendert eine Fahrt, er fuehrt sie nicht`);
  }
});

test('Eine absteigende Staffel wird benannt, nicht stillschweigend korrigiert', async () => {
  const { t, clock, tx } = zonedSetup();
  // Ueber die echten Eingabefelder, nicht ueber state.view: genau diesen Weg nimmt der Nutzer.
  t.applyViewPreferencesToUi();
  const setSpeeds = (min, max, cursor) => {
    t.ui.driveSpeedMinInput.value = min;
    t.ui.driveSpeedMaxInput.value = max;
    t.ui.cursorSpeedInput.value = cursor;
    t.updateViewPreferencesFromUi();
  };

  // Joystick-Minimum ueber der Tastengeschwindigkeit: 30 / 5 / 45 cm/s.
  setSpeeds('0.30', '0.45', '5');
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, false, 'die absteigende Staffel muss dastehen');
  const text = t.ui.driveZoneOrderHint.textContent;
  assert.ok(!text.includes('{'), `Platzhalterrest im Hinweis: ${text}`);
  const zahlen = [...text.matchAll(/\d+/g)].map((m) => m[0]);
  assert.deepStrictEqual(zahlen, ['30', '5', '45'],
    `der Hinweis muss die drei Werte in ihrer tatsaechlichen Reihenfolge nennen, steht da: ${text}`);

  // **Der Hinweis sperrt nichts:** die Zonen fahren weiterhin die eingetragenen Werte.
  for (const [share, speed] of [[0.10, '0.30'], [0.50, '0.05'], [0.90, '0.45']]) {
    pressKey(t, 'up', share);
    await clock.runFor(50);
    assert.ok(tx.last().startsWith(`AT+M,${speed},0.00`),
      `die Werte gelten wie eingetragen, bei ${share} gesendet: ${tx.last()}`);
    t.stopDrive();
    await clock.runFor(50);
  }
  // Und nichts davon ist unterwegs sortiert oder angehoben worden.
  assert.strictEqual(t.state.view.driveSpeedMin, 0.30);
  assert.strictEqual(t.state.view.cursorSpeedCms, 5);
  // Spread, weil das Array aus dem Sandkasten eine fremde Array.prototype traegt.
  assert.deepStrictEqual([...t.cursorZoneLadder().cms], [30, 5, 45]);

  // Den Hinweis gibt es auch auf Englisch, mit denselben Zahlen — ueber den echten Sprachwechsel,
  // damit auch die Nachfuehrung beim Umschalten mitgeprueft ist.
  t.toggleLanguage();
  assert.strictEqual(t.state.language, 'en');
  assert.deepStrictEqual([...t.ui.driveZoneOrderHint.textContent.matchAll(/\d+/g)].map((m) => m[0]),
    ['30', '5', '45'], 'auch die englische Fassung nennt die Staffel');
  assert.ok(!t.ui.driveZoneOrderHint.textContent.includes('{'), 'Platzhalterrest in der englischen Fassung');
  assert.notStrictEqual(t.ui.driveZoneOrderHint.textContent, text, 'und sie ist nicht der deutsche Satz');
  t.toggleLanguage();
  assert.strictEqual(t.ui.driveZoneOrderHint.textContent, text, 'zurueck auf Deutsch steht wieder der deutsche Satz');

  // Der Moduswechsel fuehrt die Zeile mit: im Joystick-Modus ist das betroffene Feld ausgeblendet.
  t.toggleDriveControl();
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, true, 'im Joystick-Modus hat die Staffel nichts zu sagen');
  t.toggleDriveControl();
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, false, 'zurueck im Tastenmodus steht sie wieder da');
  assert.deepStrictEqual([...t.ui.driveZoneOrderHint.textContent.matchAll(/\d+/g)].map((m) => m[0]),
    ['30', '5', '45'], 'und nennt nach dem Wechsel dieselben Zahlen');

  // Ohne Zonen wird nirgends langsamer — dann gaebe es nichts zu erklaeren.
  t.ui.driveZonesToggle.checked = false;
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, true, 'ohne Zonen ist die Reihenfolge belanglos');
  t.ui.driveZonesToggle.checked = true;

  // Aufsteigende Staffel: kein Hinweis, und der Text bleibt leer statt nur ausgeblendet.
  setSpeeds('0.08', '0.25', '15');
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, true, 'eine aufsteigende Staffel ist nicht erklaerungsbeduerftig');
  assert.strictEqual(t.ui.driveZoneOrderHint.textContent, '', 'und hinterlaesst keinen alten Text');
  assert.strictEqual(t.cursorZoneLadder().descends, false);

  // Zwei gleiche Werte sind kein Rueckschritt: es wird nichts langsamer.
  setSpeeds('0.15', '0.25', '15');
  assert.strictEqual(t.ui.driveZoneOrderHint.hidden, true, 'gleiche Werte machen das Schieben nirgends langsamer');

  for (const key of ['driveZoneOrderHint']) {
    const de = [...String(t.I18N.de[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const en = [...String(t.I18N.en[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.ok(de && en, `${key} fehlt in einer Sprache`);
    assert.strictEqual(en, de, `${key}: unterschiedliche Platzhalter`);
    assert.strictEqual(de, 'fast,normal,slow');
  }
});

test('Zu schmale Drehtasten werden benannt, nicht heimlich vergroessert', () => {
  const { t, sandbox } = setup();
  // Die Formgroessen stehen im Stylesheet und werden von dort gelesen. Hier gibt es kein Layout,
  // deshalb werden genau die Werte untergeschoben, die `styles.css` traegt — dass sie
  // uebereinstimmen, rechnet `tests/layout-test.js` nach.
  sandbox.__cssTokens = { '--drive-pad-gap': '4px', '--drive-pad-waist': '0.5', '--drive-pad-key-min': '44px' };
  const setzeFeld = (F) => { t.ui.driveButtons.getBoundingClientRect = () => ({ left: 0, top: 0, width: F, height: F }); };

  // Tastenmodus, kleinstes Feld: der groesste Kreis im Keil misst rund 29 px.
  setzeFeld(140);
  t.toggleDriveControl();
  assert.strictEqual(t.state.view.driveControl, 'buttons');
  assert.ok(t.turnKeyIncircle(140, 4, 0.5) < 44, 'bei 140px ist der Keil kein Daumenziel');
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, false, 'die Zeile muss bei 140px dastehen');
  const de = t.ui.driveTurnSizeHint.textContent;
  assert.ok(de.includes('44'), `die Zeile muss das Mass nennen, steht da: ${de}`);
  assert.ok(!de.includes('{'), `Platzhalterrest: ${de}`);

  // **Die Groesse wird nicht angetastet** — es wird nur benannt.
  const stufe = t.state.view.joystickScale;
  t.refreshTurnKeyHint();
  assert.strictEqual(t.state.view.joystickScale, stufe, 'der Hinweis darf die Groessenstufe nicht veraendern');

  // Gross genug: die Zeile verschwindet und hinterlaesst keinen alten Text.
  setzeFeld(204);
  t.refreshTurnKeyHint();
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, true, 'ab rund 204px ist der Keil ein Daumenziel');
  assert.strictEqual(t.ui.driveTurnSizeHint.textContent, '', 'und die Zeile bleibt nicht als Rest stehen');
  // Knapp darunter steht sie wieder da — die Schwelle wirkt, sie ist nicht nur gerechnet.
  setzeFeld(203);
  t.refreshTurnKeyHint();
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, false, 'knapp unter der Schwelle muss die Zeile stehen');

  // **Im Joystick-Modus nie** — dort gibt es keine Drehtasten, die zu schmal sein koennten.
  setzeFeld(140);
  t.toggleDriveControl();
  assert.strictEqual(t.state.view.driveControl, 'joystick');
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, true, 'im Joystick-Modus hat die Zeile nichts zu sagen');
  assert.strictEqual(t.ui.driveTurnSizeHint.textContent, '');
  t.toggleDriveControl();
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, false, 'zurueck im Tastenmodus steht sie wieder da');

  // Die Groessenstufe fuehrt sie nach: derselbe Weg, den der Nutzer im Menue nimmt.
  setzeFeld(230);
  t.applyDriveZonePreferences();
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, true, 'nach der Groessenaenderung muss sie weg sein');

  // Ohne lesbare Formgroessen wird nichts behauptet, statt eine Zahl zu raten.
  setzeFeld(140);
  sandbox.__cssTokens = {};
  t.refreshTurnKeyHint();
  assert.strictEqual(t.ui.driveTurnSizeHint.hidden, true, 'ohne Tokenwerte darf nichts behauptet werden');
  sandbox.__cssTokens = { '--drive-pad-gap': '4px', '--drive-pad-waist': '0.5', '--drive-pad-key-min': '44px' };
  t.refreshTurnKeyHint();

  // Beide Sprachen, ueber den echten Sprachwechsel.
  t.toggleLanguage();
  assert.strictEqual(t.state.language, 'en');
  const en = t.ui.driveTurnSizeHint.textContent;
  assert.notStrictEqual(en, de, 'die englische Fassung ist nicht der deutsche Satz');
  assert.ok(en.includes('44'), `auch die englische Fassung nennt das Mass: ${en}`);
  t.toggleLanguage();
  assert.strictEqual(t.ui.driveTurnSizeHint.textContent, de);
  for (const key of ['driveTurnSizeHint']) {
    assert.ok(t.I18N.de[key] && t.I18N.en[key], `${key} fehlt in einer Sprache`);
  }
});

test('Links dreht auf der Stelle, ohne Vortrieb', async () => {
  const { t, clock } = setup();
  const tx = readyToDrive(t);
  t.state.view.cursorSpeedCms = 10;
  t.state.view.driveSpeedMax = 0.20;
  t.state.view.mowerWidth = 0.40;
  t.toggleDriveControl();

  t.beginCursorDrive('left', { pointerId: 1, preventDefault() {} });
  await clock.runFor(50);
  assert.ok(tx.last().startsWith('AT+M,0.00,0.50'),
    `linear 0, Drehrate (0,20/2)/0,20, gesendet: ${tx.last()}`);
  t.stopDrive();
});

test('Die Cursor-Geschwindigkeit wird gegen die Hoechstgeschwindigkeit geprueft', () => {
  const { t } = setup();
  t.state.view.driveSpeedMax = 0.25;            // = 25 cm/s
  t.applyViewPreferencesToUi();                 // die Eingabefelder tragen jetzt die Werte
  t.ui.driveControlSelect.value = 'buttons';

  t.ui.cursorSpeedInput.value = '0';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.cursorSpeedCms, 2, 'null waere kein Fahren — Untergrenze 2 cm/s');

  t.ui.cursorSpeedInput.value = '99';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.cursorSpeedCms, 25, 'nie schneller als der Joystick');
  assert.strictEqual(t.cursorSpeedLimits().max, 25, 'die Obergrenze folgt der Einstellung');

  t.ui.cursorSpeedInput.value = '15';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.cursorSpeedCms, 15);
});

test('Der Joystick bleibt vom Tastenmodus unberuehrt', () => {
  const { t } = setup();
  t.state.view.driveSpeedMin = 0.10;
  t.state.view.driveSpeedMax = 0.30;
  t.state.view.cursorSpeedCms = 5;   // darf die Joystick-Kennlinie nicht beeinflussen
  const full = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 - 116 });
  assert.ok(Math.abs(full.linear - 0.30) < 1e-9, 'voller Ausschlag bleibt das Joystick-Maximum');
  const half = t.joystickVectorFromPointer({ clientX: 150, clientY: 150 - 58 });
  assert.ok(half.linear > 0.10 && half.linear < 0.30, 'die Kennlinie ist unveraendert');
});

test('Der Konturstatus haengt an der Bezeichnung der Kontur, nicht an fester Stelle', async () => {
  // Der Fehler: „geschlossen“ stand als freistehendes Wort an fester Stelle der Karteninfo,
  // ohne erkennbaren Bezug — bei mehreren Ausschlussflaechen war nicht ablesbar, welche gemeint
  // ist. Jetzt traegt das Feld immer Name **und** Zustand als eine Einheit.
  const { t, elements } = setup();
  const chip = elements.get('contourStatus');
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.state.activeMap.perimeterClosed = false;
  t.setMode('perimeter');
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, 'Perimeter · offen');
  t.state.activeMap.perimeterClosed = true;
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, 'Perimeter · geschlossen');
  for (const mode of ['waypoint', 'dock']) {
    t.setMode(mode);
    t.refreshContourStatus();
    assert.strictEqual(chip.textContent, '', `${mode} kennt kein offen/geschlossen`);
  }
});

test('Bei mehreren Ausschlussflaechen nennt der Status genau die betroffene', async () => {
  // Zwei Flaechen mit **unterschiedlichem** Zustand gleichzeitig im Modell: der Status muss der
  // aktiven bzw. ausgewaehlten folgen und darf nicht die andere beschreiben.
  const { t, elements } = setup();
  const chip = elements.get('contourStatus');
  t.setMode('exclusion');
  await t.createExclusion();
  const first = t.currentExclusion();
  first.points = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
  first.closed = true;
  await t.createExclusion();
  const second = t.currentExclusion();
  second.points = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }];
  second.closed = false;
  // Aktiv ist die zuletzt angelegte.
  assert.strictEqual(t.currentExclusion().id, second.id);
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, 'Ausschluss 2 · offen');
  t.state.activeExclusionId = first.id;
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, 'Ausschluss 1 · geschlossen', 'die andere Flaeche, anderer Zustand');
  // Eine ausgewaehlte Flaeche schlaegt den Modus: ihre Auswahlmeldung ist nur voruebergehend,
  // das Feld muss den Namen deshalb selbst tragen.
  t.state.activeExclusionId = first.id;
  t.state.selectedArea = second.id;
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, 'Ausschluss 2 · offen', 'die ausgewaehlte Flaeche gewinnt');
});

test('Ein ausgewaehlter Punkt traegt den Zustand in seiner eigenen Bezeichnung', async () => {
  // Beispiel aus der Vorgabe: „Ausschluss 1 · Punkt 3 · offen“. Das Feld daneben bleibt dann
  // leer, sonst stuende der Name zweimal in derselben Zeile.
  const { t, elements } = setup();
  const chip = elements.get('contourStatus');
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.state.activeMap.perimeterClosed = true;
  t.setMode('perimeter');
  t.applyPointSelection({ role: 'perimeter', index: 2 });
  assert.strictEqual(t.selectedPointLabel(), 'Perimeter · Punkt 3 · geschlossen');
  t.refreshContourStatus();
  assert.strictEqual(chip.textContent, '', 'kein zweiter Name in derselben Zeile');

  t.setMode('exclusion');
  await t.createExclusion();
  const ex = t.currentExclusion();
  ex.points = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
  ex.closed = false;
  t.applyPointSelection({ role: 'exclusion', exclusionId: ex.id, index: 2 });
  assert.strictEqual(t.selectedPointLabel(), 'Ausschluss 1 · Punkt 3 · offen');
  // Wegpunkte und Dockpfad bleiben ohne Zustand, auch am ausgewaehlten Punkt.
  t.state.activeMap.waypoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  t.applyPointSelection({ role: 'waypoint', index: 1 });
  assert.strictEqual(t.selectedPointLabel(), 'Wegpunkte · Punkt 2');
});

test('Der Konturstatus steht genau einmal in der Karteninfo', () => {
  // Der Fehler: bei geschlossenem Perimeter schrieb refreshCaptureState() zusaetzlich
  // „Perimeter ist bereits geschlossen.“ in die sichtbare Statuszeile — derselbe Sachverhalt
  // ein zweites Mal, direkt neben „Perimeter · geschlossen“. Beide nahmen sich den Platz weg.
  const { t, elements } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.state.activeMap.perimeterClosed = true;
  t.setMode('perimeter');
  t.refreshCaptureState();
  // Sichtbar sind nur diese drei; die uebrigen Kinder der Karteninfo sind .sr-only.
  const visible = ['mapSummary', 'contourStatus', 'pointStatus']
    .map((id) => elements.get(id).textContent || '').join(' | ');
  const hits = (visible.match(/geschlossen/g) || []).length;
  assert.strictEqual(hits, 1, `der Zustand darf nur einmal dastehen, ist: „${visible}“`);
  assert.strictEqual(elements.get('contourStatus').textContent, 'Perimeter · geschlossen',
    'und zwar in der kompakten Fassung hinter der Konturbezeichnung');
  assert.ok(!/geschlossen/.test(elements.get('pointStatus').textContent || ''),
    'die Statuszeile wiederholt den Zustand nicht mehr');
  // Als Vorlesehilfe am Aufnahme-Knopf bleibt der ausgeschriebene Satz erhalten — er ist
  // .sr-only, steht also nicht sichtbar in der Zeile.
  assert.strictEqual(elements.get('captureButtonHint').textContent, 'Perimeter ist bereits geschlossen.');
  assert.strictEqual(elements.get('captureButtonTitle').textContent, 'Perimeter wieder öffnen',
    'was ein Tipp bewirkt, sagt der Knopf selbst');
  // Gegenprobe Englisch: dieselbe Aufteilung, nicht nur im deutschen Text.
  t.toggleLanguage();
  t.refreshCaptureState();
  const visibleEn = ['mapSummary', 'contourStatus', 'pointStatus']
    .map((id) => elements.get(id).textContent || '').join(' | ');
  assert.strictEqual((visibleEn.match(/closed/g) || []).length, 1, `EN: „${visibleEn}“`);
});

test('Der Konturstatus folgt jedem Neuzeichnen und jeder Zustandsauffrischung', () => {
  // Er darf nicht nur bei einem Moduswechsel stimmen: schliesst sich eine Kontur, muss die
  // Anzeige beim naechsten Render mitgehen, ohne dass jemand refreshContourStatus() ruft.
  const { t, elements } = setup();
  const chip = elements.get('contourStatus');
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.state.activeMap.perimeterClosed = false;
  t.setMode('perimeter');
  t.renderMap();
  assert.strictEqual(chip.textContent, 'Perimeter · offen');
  t.state.activeMap.perimeterClosed = true;
  t.renderMap();
  assert.strictEqual(chip.textContent, 'Perimeter · geschlossen', 'renderMap zieht den Status mit');
  t.state.activeMap.perimeterClosed = false;
  t.refreshCaptureState();
  assert.strictEqual(chip.textContent, 'Perimeter · offen', 'refreshCaptureState ebenfalls');
});

test('Die Werkzeugleiste verschwindet, wenn kein einziges Werkzeug sichtbar ist', () => {
  // Nach dem Umzug von Karteninfo, Rueckgaengig und Ansicht-Symbol traegt die Leiste nur noch
  // Werkzeuge. Waehrend der Automatik sind alle ausgeblendet — ein leerer Streifen samt
  // Trennlinie wuerde der Karte grundlos Hoehe nehmen.
  const { t, elements } = setup();
  const bar = elements.get('mapToolbar');
  t.refreshCaptureState();
  assert.strictEqual(bar.hidden, false, 'ohne Auswahl steht wenigstens der Papierkorb dort');
  for (const id of ['deleteFabWrap', 'insertBeforeWrap', 'insertAfterWrap', 'closeAndNewWrap', 'extendWrap']) {
    elements.get(id).hidden = true;
  }
  t.refreshToolbarVisibility();
  assert.strictEqual(bar.hidden, false, 'der Kartenname haelt die Leiste offen');
  // Auch die zweite Zeile allein haelt sie offen — sonst verschwaende die Karteninfo.
  elements.get('mapNameLabel').textContent = '';
  elements.get('mapSummary').textContent = '20 Punkte';
  t.refreshToolbarVisibility();
  assert.strictEqual(bar.hidden, false, 'die Angaben der zweiten Zeile halten sie offen');
  // Erst ohne Werkzeug **und** ohne jede Angabe ist wirklich nichts mehr darin.
  elements.get('mapSummary').textContent = '';
  elements.get('contourStatus').textContent = '';
  t.refreshToolbarVisibility();
  assert.strictEqual(bar.hidden, true, 'voellig leer klappt sie ein');
  elements.get('deleteFabWrap').hidden = false;
  t.refreshToolbarVisibility();
  assert.strictEqual(bar.hidden, false, 'ein einziges Werkzeug genuegt');
});

test('Die Linkshaender-Spiegelung gilt auch fuer das Tastenkreuz', () => {
  // Beide Steuerungsarten sitzen in derselben Gitterspalte — die Spiegelung betrifft die
  // Fahrtanzeige daneben und gilt damit unveraendert fuer Joystick wie Tasten.
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  // Groesse und Gitterplatz liegen seit dem Ecken-Umschalter auf dem gemeinsamen Feld; Joystick
  // und Kreuz fuellen es nur noch aus. Damit gilt die Spiegelung weiterhin fuer beide.
  const field = css.slice(css.indexOf('.drive-zone .drive-control {'));
  const body = field.slice(0, field.indexOf('}'));
  assert.ok(/grid-column:\s*2/.test(body), 'das Feld sitzt in der mittleren Spalte');
  assert.ok(/grid-row:\s*1/.test(body), 'und in derselben Zeile — sonst waechst die Zone');
  assert.ok(/--joystick-size/.test(body), 'es traegt die Groessenrechnung fuer beide Steuerungen');
  const pad = css.slice(css.indexOf('.drive-zone .drive-pad {'));
  assert.ok(/width:\s*100%/.test(pad.slice(0, pad.indexOf('}'))), 'das Kreuz fuellt dasselbe Feld');
});

// === Diagnoseprotokoll =====================================================
/** Stellt die Messwerte eines gescrollten Protokolls nach: Ansicht steht oben statt unten. */
function scrollLogUp(t, elements) {
  const el = elements.get('debugLog');
  el.scrollHeight = 2000;
  el.clientHeight = 300;
  el.scrollTop = 0;
  t.onDebugLogScroll();
  return el;
}

test('Das Protokoll haelt mindestens 100 Zeilen vor und waechst nicht unbegrenzt', () => {
  const { t, elements } = setup();
  assert.ok(t.LOG_ENTRY_LIMIT >= 100, `der Puffer muss mindestens 100 Zeilen fassen, ist ${t.LOG_ENTRY_LIMIT}`);
  assert.ok(t.LOG_EXPORT_LIMIT === 100, 'der Export nimmt die letzten 100 Zeilen');
  assert.ok(t.LOG_ENTRY_LIMIT >= t.LOG_EXPORT_LIMIT, 'sonst koennte der Export nie voll werden');
  t.clearDebugLog();
  for (let i = 1; i <= t.LOG_ENTRY_LIMIT + 50; i += 1) t.log('ZEILE', String(i));
  assert.strictEqual(t.state.logEntries.length, t.LOG_ENTRY_LIMIT, 'die Obergrenze haelt');
  // Die aeltesten fallen vorn weg, die neueste steht hinten.
  assert.ok(t.state.logEntries[0].includes(`ZEILE ${51}`), `vorn faellt das Aelteste weg: ${t.state.logEntries[0]}`);
  assert.ok(t.state.logEntries.at(-1).includes(`ZEILE ${t.LOG_ENTRY_LIMIT + 50}`));
  // Die Anzeige spiegelt genau den Puffer.
  const shown = elements.get('debugLog').textContent.split('\n').filter(Boolean);
  assert.strictEqual(shown.length, t.LOG_ENTRY_LIMIT);
});

test('Das Mitscrollen pausiert beim Hochscrollen und nimmt am Ende wieder auf', () => {
  const { t, elements } = setup();
  const hint = elements.get('logJumpBtn');
  t.clearDebugLog();
  t.log('START');
  assert.strictEqual(t.state.logAutoScroll, true, 'im Normalfall laeuft die Ansicht mit');
  assert.strictEqual(hint.hidden, true, 'ohne Pause kein Hinweis');

  // Nutzer scrollt nach oben: das Mitlaufen pausiert und der Hinweis erscheint.
  const el = scrollLogUp(t, elements);
  assert.strictEqual(t.state.logAutoScroll, false, 'hochgescrollt heisst pausiert');
  assert.strictEqual(hint.hidden, false, 'der Hinweis sagt, warum nichts nachrueckt');

  // Neue Zeilen kommen trotzdem an, die Ansicht springt aber nicht.
  const before = el.scrollTop;
  t.log('NEU', 'waehrend pausiert');
  assert.ok(el.textContent.includes('waehrend pausiert'), 'angehaengt wird weiterhin');
  assert.strictEqual(el.scrollTop, before, 'die Ansicht darf nicht springen');
  assert.strictEqual(hint.hidden, false, 'der Hinweis bleibt stehen');

  // Zurueck ans Ende gescrollt: es laeuft wieder mit.
  el.scrollTop = el.scrollHeight - el.clientHeight;
  t.onDebugLogScroll();
  assert.strictEqual(t.state.logAutoScroll, true, 'unten angekommen laeuft es wieder mit');
  assert.strictEqual(hint.hidden, true);
  t.log('WEITER');
  assert.strictEqual(el.scrollTop, el.scrollHeight, 'und die Ansicht folgt wieder');
});

test('Der Hinweis springt ans Ende und setzt das Mitscrollen fort', () => {
  const { t, elements } = setup();
  const hint = elements.get('logJumpBtn');
  t.clearDebugLog();
  t.log('A');
  const el = scrollLogUp(t, elements);
  assert.strictEqual(hint.hidden, false);
  // Genau das tut ein Tipp auf den Hinweis.
  t.scrollLogToEnd();
  assert.strictEqual(t.state.logAutoScroll, true);
  assert.strictEqual(hint.hidden, true);
  assert.strictEqual(el.scrollTop, el.scrollHeight, 'die Ansicht steht wieder ganz unten');
});

test('Knapp ueber dem Ende gilt noch als unten', () => {
  // Ohne Toleranz wuerde jedes Pixel Rundungsdifferenz das Mitlaufen abwuergen.
  const { t, elements } = setup();
  const el = elements.get('debugLog');
  el.scrollHeight = 2000;
  el.clientHeight = 300;
  el.scrollTop = 1700 - Math.floor(t.LOG_BOTTOM_TOLERANCE_PX / 2);
  t.onDebugLogScroll();
  assert.strictEqual(t.state.logAutoScroll, true, 'innerhalb der Toleranz laeuft es mit');
  el.scrollTop = 1700 - (t.LOG_BOTTOM_TOLERANCE_PX + 10);
  t.onDebugLogScroll();
  assert.strictEqual(t.state.logAutoScroll, false, 'deutlich darueber pausiert es');
});

test('Ohne gemessenes Layout laeuft die Ansicht mit', () => {
  // Im Test und vor dem ersten Zeichnen sind die Messwerte 0 bzw. fehlen. Der Normalfall ist
  // Mitlaufen — sonst stuende der Hinweis von Anfang an da, ohne dass jemand gescrollt hat.
  const { t, elements } = setup();
  const el = elements.get('debugLog');
  el.scrollHeight = 0; el.clientHeight = 0; el.scrollTop = 0;
  assert.strictEqual(t.debugLogAtBottom(), true);
  el.clientHeight = undefined;
  assert.strictEqual(t.debugLogAtBottom(), true, 'unbrauchbare Messwerte duerfen nicht pausieren');
});

test('Der Export enthaelt die letzten 100 Zeilen im Format der Anzeige', () => {
  const { t, elements } = setup();
  t.clearDebugLog();
  for (let i = 1; i <= 130; i += 1) t.log('EINTRAG', String(i));
  const lines = t.logExportText().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, t.LOG_EXPORT_LIMIT, 'genau die letzten 100');
  assert.ok(lines[0].includes('EINTRAG 31'), `beginnt bei 31: ${lines[0]}`);
  assert.ok(lines.at(-1).includes('EINTRAG 130'), 'und endet beim juengsten');
  // Format wie in der Anzeige, inklusive Zeitstempel in eckigen Klammern.
  assert.ok(/^\[\d{1,2}[:.]\d{2}[:.]\d{2}/.test(lines[0]), `Zeitstempel fehlt: ${lines[0]}`);
  const shown = elements.get('debugLog').textContent.split('\n').filter(Boolean);
  assert.deepStrictEqual(lines, shown.slice(-t.LOG_EXPORT_LIMIT), 'Export und Anzeige sind wortgleich');
});

test('Weniger als 100 Zeilen werden vollstaendig exportiert', () => {
  const { t } = setup();
  t.clearDebugLog();
  for (let i = 1; i <= 7; i += 1) t.log('KURZ', String(i));
  const lines = t.logExportText().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 7, 'alle vorhandenen, nicht auf 100 aufgefuellt');
});

test('Der Dateiname traegt Datum und Uhrzeit', () => {
  const { t } = setup();
  const name = t.logExportFileName(new Date(2026, 8, 8, 7, 5, 3));
  assert.strictEqual(name, 'mapcreator-log_2026-09-08_07-05-03.txt');
  // Zwei Exporte in derselben Minute duerfen sich nicht denselben Namen teilen.
  const later = t.logExportFileName(new Date(2026, 8, 8, 7, 5, 4));
  assert.notStrictEqual(name, later, 'die Sekunde unterscheidet aufeinanderfolgende Exporte');
  assert.ok(name.endsWith('.txt'), 'einfache Textdatei');
});

test('Ein leeres Protokoll wird nicht als Datei angeboten', () => {
  // Sonst laedt der Nutzer eine leere Datei herunter und haelt sie fuer kaputt.
  const { t, sandbox } = setup();
  let downloads = 0;
  const realBlob = sandbox.Blob;
  sandbox.Blob = function Spy(...args) { downloads += 1; return new realBlob(...args); };
  t.clearDebugLog();
  t.exportDebugLog();
  assert.strictEqual(downloads, 0, 'kein Download ohne Inhalt');
  assert.ok((sandbox.__lastConfirm || sandbox.__lastConfirmRequest), 'stattdessen eine Meldung');
  t.log('ETWAS');
  t.exportDebugLog();
  assert.strictEqual(downloads, 1, 'mit Inhalt wird die Datei erzeugt');
  sandbox.Blob = realBlob;
});

test('Log leeren raeumt Puffer und Anzeige und nimmt das Mitscrollen wieder auf', () => {
  const { t, elements } = setup();
  t.log('A'); t.log('B');
  scrollLogUp(t, elements);
  t.clearDebugLog();
  assert.strictEqual(t.state.logEntries.length, 0);
  assert.strictEqual(elements.get('debugLog').textContent, '');
  assert.strictEqual(t.state.logAutoScroll, true, 'nach dem Leeren laeuft es wieder mit');
  assert.strictEqual(elements.get('logJumpBtn').hidden, true);
});

test('Die Diagnose hat keine AT+V-/AT+S-Knoepfe mehr', () => {
  // Entfernt statt repariert: beide Kommandos gehen ohnehin automatisch raus (AT+V im
  // Handshake, AT+S alle 500 ms beim Polling) und stehen mit ihren Antworten im Protokoll.
  // Die Knoepfe waren zudem nur im verbundenen Zustand bedienbar — genau dann, wenn beide
  // Kommandos bereits laufen.
  const fs2 = require('fs');
  const html = fs2.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs2.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  for (const id of ['requestVersionBtn', 'requestStateBtn']) {
    assert.ok(!html.includes(id), `${id} darf nicht ins Markup zurueckkehren`);
    assert.ok(!app.includes(id), `${id} darf nicht in app.js zurueckkehren`);
  }
  for (const key of ['sendVersion', 'sendState']) {
    assert.ok(!app.includes(`${key}:`), `toter Uebersetzungsschluessel ${key}`);
  }
  // Die Ersatzbedienung steht dafuer im Markup.
  for (const id of ['exportLogBtn', 'logJumpBtn', 'clearLogBtn']) {
    assert.ok(html.includes(`id="${id}"`), `${id} fehlt in der Diagnose`);
  }
});

// === Karte umbenennen und duplizieren ======================================
/** Legt eine zweite Karte mit Inhalt an und gibt sie zurueck. */
function seedSecondMap(t, name = 'Vorgarten') {
  const map = t.normalizeMap(t.makeMap(name));
  map.perimeter = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
  map.exclusions.push({ id: 'ex1', name: 'Apfelbaum', closed: true, points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] });
  map.waypoints = [{ x: 7, y: 7 }];
  map.dockPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  map.positionMode = 'absolute';
  map.origin = { lat: 48.5, lon: 9.25 };
  t.state.maps.push(map);
  return map;
}
const mapNames = (t) => t.state.maps.map((m) => t.localizedMapName(m)).join(' | ');

test('Umbenennen aendert nur den Namen', async () => {
  const { t, sandbox } = setup();
  const map = seedSecondMap(t);
  const before = JSON.stringify({ p: map.perimeter, e: map.exclusions, o: map.origin, m: map.positionMode });

  sandbox.__promptAdapter = () => 'Neuer Name';
  await t.renameMapById(map.id);

  assert.strictEqual(map.name, 'Neuer Name');
  assert.strictEqual(JSON.stringify({ p: map.perimeter, e: map.exclusions, o: map.origin, m: map.positionMode }),
    before, 'Punkte, Ursprung und Positionsmodus bleiben unangetastet');
  assert.strictEqual(map.id, t.state.maps.find((m) => m.name === 'Neuer Name').id, 'die Kennung bleibt');
});

test('Umbenennen laeuft ueber den eigenen Dialog, nicht ueber window.prompt()', async () => {
  // Kommentare zuerst entfernen — der Erklaertext nennt window.prompt() absichtlich.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/(?:window|globalThis)\.prompt\s*\(/.test(src), 'window.prompt() darf nirgends benutzt werden');
  assert.ok(!/(?<![.\w])prompt\s*\(/.test(src), 'auch kein blankes prompt()');

  const { t, sandbox } = setup();
  delete sandbox.__promptAdapter;          // echter Dialogpfad
  const map = seedSecondMap(t);
  const pending = t.renameMapById(map.id);
  assert.strictEqual(t.ui.confirmDialog.hidden, false, 'der eigene Dialog ist offen');
  assert.strictEqual(t.ui.confirmDialogInput.hidden, false, 'mit Eingabefeld');
  assert.strictEqual(t.ui.confirmDialogInput.value, 'Vorgarten', 'vorbelegt mit dem alten Namen');
  assert.strictEqual(t.ui.confirmDialogInput.maxLength, t.MAP_NAME_MAX, 'Laenge begrenzt');
  t.ui.confirmDialogInput.value = 'Hinterhof';
  t.confirmDialogRespond(true);
  await pending;
  assert.strictEqual(map.name, 'Hinterhof');
  assert.strictEqual(t.ui.confirmDialogInput.hidden, true, 'das Feld verschwindet wieder');

  // Abbrechen laesst den Namen stehen.
  const second = t.renameMapById(map.id);
  t.ui.confirmDialogInput.value = 'Egal';
  t.confirmDialogRespond(false);
  await second;
  assert.strictEqual(map.name, 'Hinterhof', 'Abbrechen aendert nichts');
});

test('Leere und zu lange Namen werden abgefangen', async () => {
  const { t, sandbox } = setup();
  const map = seedSecondMap(t);

  sandbox.__promptAdapter = () => '   ';
  await t.renameMapById(map.id);
  assert.strictEqual(map.name, 'Vorgarten', 'ein leerer Name wird nicht uebernommen');

  sandbox.__promptAdapter = () => 'x'.repeat(200);
  await t.renameMapById(map.id);
  assert.strictEqual(map.name.length, t.MAP_NAME_MAX, 'zu lange Namen werden gekuerzt');
});

test('Eine gesperrte Karte laesst sich nicht umbenennen', async () => {
  const { t, sandbox } = setup();
  const map = seedSecondMap(t);
  map.locked = true;
  sandbox.__promptAdapter = () => 'Neuer Name';
  await t.renameMapById(map.id);
  assert.strictEqual(map.name, 'Vorgarten');
});

test('Duplizieren kopiert alles und bleibt unabhaengig', async () => {
  const { t } = setup();
  const source = seedSecondMap(t);
  const activeBefore = t.state.activeMap.id;

  const copy = await t.duplicateMapById(source.id);
  assert.ok(copy, 'die Kopie entsteht');
  assert.notStrictEqual(copy.id, source.id, 'eigene Kennung');
  assert.strictEqual(t.state.activeMap.id, activeBefore, 'die aktive Karte wechselt nicht');

  // Inhalt vollstaendig uebernommen …
  assert.strictEqual(copy.perimeter.map((p) => `${p.x},${p.y}`).join(' | '), '0,0 | 5,0 | 5,5');
  assert.strictEqual(copy.exclusions.length, 1);
  assert.strictEqual(copy.exclusions[0].name, 'Apfelbaum');
  assert.strictEqual(copy.exclusions[0].points.length, 3);
  assert.strictEqual(copy.waypoints.length, 1);
  assert.strictEqual(copy.dockPoints.length, 2);
  assert.strictEqual(copy.positionMode, 'absolute', 'Positionsmodus kommt mit');
  assert.strictEqual(copy.origin.lat, 48.5, 'samt Ursprung');
  // … aber die Ausschlussflaeche bekommt eine eigene Kennung, sonst kollidieren sie.
  assert.notStrictEqual(copy.exclusions[0].id, source.exclusions[0].id);

  // Unabhaengig: Aenderungen an der einen lassen die andere unberuehrt.
  copy.perimeter.push({ x: 9, y: 9 });
  copy.exclusions[0].points[0].x = 99;
  copy.origin.lat = 1;
  assert.strictEqual(source.perimeter.length, 3, 'das Original waechst nicht mit');
  assert.strictEqual(source.exclusions[0].points[0].x, 1, 'keine geteilten Punkt-Objekte');
  assert.strictEqual(source.origin.lat, 48.5, 'kein geteilter Ursprung');
});

test('Mehrfaches Duplizieren zaehlt weiter, ohne doppelte Namen', async () => {
  const { t } = setup();
  const source = seedSecondMap(t);
  await t.duplicateMapById(source.id);
  await t.duplicateMapById(source.id);
  await t.duplicateMapById(source.id);

  const names = mapNames(t);
  assert.ok(names.includes('Vorgarten (Kopie)'), names);
  assert.ok(names.includes('Vorgarten (Kopie 2)'), names);
  assert.ok(names.includes('Vorgarten (Kopie 3)'), names);
  const all = t.state.maps.map((m) => t.localizedMapName(m));
  assert.strictEqual(new Set(all).size, all.length, 'kein Name kommt doppelt vor');

  // Die Kopie einer Kopie haengt kein zweites „(Kopie)“ an.
  const copy = t.state.maps.find((m) => t.localizedMapName(m) === 'Vorgarten (Kopie)');
  const again = await t.duplicateMapById(copy.id);
  assert.ok(!t.localizedMapName(again).includes('(Kopie) (Kopie)'), t.localizedMapName(again));
  assert.strictEqual(t.localizedMapName(again), 'Vorgarten (Kopie 4)');
});

test('Ein sehr langer Name sprengt den Kopie-Namen nicht', () => {
  const { t } = setup();
  const long = 'W'.repeat(100);
  const name = t.uniqueCopyName(long);
  assert.ok(name.length <= t.MAP_NAME_MAX, `Kopie-Name ist ${name.length} Zeichen lang`);
  assert.ok(name.endsWith('(Kopie)'));
});

test('Ist die Kartengrenze erreicht, wird nicht dupliziert', async () => {
  const { t, sandbox } = setup();
  const source = seedSecondMap(t);
  // Bis an die Grenze auffuellen — die Zahl kommt aus der Konstante, nicht aus dem Test.
  while (t.state.maps.length < t.MAX_MAPS) t.state.maps.push(t.normalizeMap(t.makeMap(`Fueller ${t.state.maps.length}`)));
  sandbox.__confirmAnswer = true;
  const before = t.state.maps.length;
  await t.duplicateMapById(source.id);
  assert.strictEqual(t.state.maps.length, before, 'die Obergrenze gilt auch fuers Duplizieren');
});

// === Kontur nachtraeglich erweitern ========================================
/** Geschlossenes Quadrat als Perimeter: A(0,0) B(10,0) C(10,10) D(0,10). */
function seedClosedPerimeter(t) {
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  t.state.activeMap.perimeterClosed = true;
  t.setMode('perimeter');
  t.refreshCaptureState();
}
const perimeterXY = (t) => t.state.activeMap.perimeter.map((p) => `${p.x},${p.y}`).join(' | ');
/** Laesst die angestossene asynchrone Kette (Speichern, Neuzeichnen) auslaufen. */
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
/** Ein Tipp weit weg von jedem Punkt und ausserhalb jeder Flaeche. */
function tapEmpty(t) {
  t.renderMap();
  t.handleMapTap(tapAt(t, 5, 5));
}
/** Die Listenplaetze, die in der Zeichnung als aktives Ende markiert sind. */
function markedIndices(t) {
  t.renderMap();
  return t.ui.shapeLayer.children
    .filter((c) => (c.attributes?.class || '').includes('extend-pick-point'))
    .map((c) => Number(c.attributes['data-point-index']));
}
/** Tippt den Punkt mit dem angegebenen Index auf der Karte an — der echte Bedienweg. */
function tapPoint(t, points, index) {
  t.renderMap();
  const screen = t.toScreen(points[index], t.state.currentTransform);
  t.handleMapTap(tapAt(t, screen.x, screen.y));
}
/**
 * Der vollstaendige Bedienweg des Auftrennens: erster Punkt, zweiter Punkt — und der zweite
 * noch einmal, weil der zweite Tipp seit v65 nur ankuendigt, wie viele Punkte wegfallen.
 */
function cutAtPoints(t, points, first, second) {
  tapPoint(t, points, first);
  tapPoint(t, points, second);
  tapPoint(t, points, second);
}

test('Der Erweitern-Knopf erscheint nur bei geschlossener Perimeter-/Ausschlusskontur', () => {
  const { t } = setup();
  // Offene Kontur: nichts aufzutrennen, sie laesst sich ohnehin fortsetzen.
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  t.setMode('perimeter');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.extendWrap.hidden, true, 'offene Kontur braucht kein Erweitern');

  seedClosedPerimeter(t);
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'geschlossen: der Knopf steht bereit');
  assert.strictEqual(t.ui.extendBtnLabel.textContent, 'Erweitern', 'kurz genug fuer die Leiste');

  // Wegpunkte und Dockpfad sind offene Pfade — dort gibt es keine geschlossene Kontur.
  t.state.activeMap.waypoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  t.setMode('waypoint');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.extendWrap.hidden, true, 'bei Wegpunkten nicht sichtbar');
  t.setMode('dock');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.extendWrap.hidden, true, 'beim Dockpfad nicht sichtbar');

  // Geschlossene Ausschlussflaeche: eigene Beschriftung.
  t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
    points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] }];
  t.state.activeExclusionId = 'ex1';
  t.setMode('exclusion');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.extendWrap.hidden, false);
  assert.strictEqual(t.ui.extendBtnLabel.textContent, 'Erweitern');

  // Gesperrte Karte: keine Aenderung moeglich.
  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.extendWrap.hidden, true, 'gesperrte Karte laesst nichts erweitern');
});

test('Weg faellt die kuerzere Seite — gemessen in Metern, nicht in Punkten', () => {
  const { t } = setup();
  // Quadrat A(0,0) B(10,0) C(10,10) D(0,10): benachbarte Punkte verlieren nie etwas, weil die
  // direkte Kante nach der Dreiecksungleichung nie laenger sein kann als der Weg aussenherum.
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  for (const [a, b] of [[0, 1], [1, 0], [1, 2], [3, 0], [0, 3]]) {
    assert.strictEqual(t.extensionCut(square, a, b).removed, 0, `${a}->${b}: Nachbarn verlieren nichts`);
  }
  // Gegenueberliegende Ecken: beide Seiten sind gleich lang, es faellt je eine Ecke weg.
  assert.strictEqual(t.extensionCut(square, 0, 2).removed, 1, 'gegenueber: eine Ecke faellt weg');

  // Entscheidend: die Seite mit den **meisten** Punkten kann die kuerzere sein. Links ein
  // dichter, kurzer Bogen (4 Zwischenpunkte auf 0,4 m), rechts ein weiter Umweg (1 Punkt,
  // ueber 200 m). Nach Punktzahl fiele der Umweg weg, nach Weglaenge der dichte Bogen.
  const dense = [
    { x: 0, y: 0 },                                                   // 0 = erster Punkt
    { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 }, { x: 0.4, y: 0 },
    { x: 0.5, y: 0 },                                                 // 5 = zweiter Punkt
    { x: 100, y: 80 },
  ];
  const cut = t.extensionCut(dense, 0, 5);
  assert.strictEqual(cut.removed, 4, 'die kurze, dicht besetzte Seite faellt weg');
  assert.strictEqual(cut.forward, true, 'und zwar die in Listenrichtung');
  // Umgekehrte Reihenfolge der Auswahl aendert daran nichts — die Seite haengt an der Geometrie.
  assert.strictEqual(t.extensionCut(dense, 5, 0).removed, 4, 'unabhaengig von der Tippreihenfolge');
});

test('Der zweite Tipp kuendigt nur an, wie viele Punkte wegfallen — er loescht nichts', async () => {
  const { t } = setup();
  // Fuenfeck, damit zwischen zwei Punkten wirklich etwas liegt: A(0,0) B(10,0) C(12,6) D(6,11) E(-1,6).
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 6 }, { x: 6, y: 11 }, { x: -1, y: 6 }];
  t.state.activeMap.perimeterClosed = true;
  t.setMode('perimeter');
  t.refreshCaptureState();
  const before = perimeterXY(t);
  t.startExtension();
  assert.strictEqual(t.state.extension.phase, 'picking');
  // Gefuehrt wird im Hinweisbereich, nicht in der schmalen Werkzeugleiste.
  assert.strictEqual(t.ui.extendPanel.hidden, false, 'der Hinweisbereich erscheint');
  assert.strictEqual(t.ui.extendWrap.hidden, true, 'der Startknopf tritt dafuer zurueck');
  assert.strictEqual(t.ui.extendCancelBtn.hidden, false, 'abbrechen geht, solange nichts geaendert ist');
  assert.strictEqual(t.ui.extendDoneBtn.hidden, true);

  const points = t.state.activeMap.perimeter;
  tapPoint(t, points, 0);                       // A
  assert.strictEqual(t.state.extension.firstIndex, 0);
  assert.ok(/bleibt das Ende/.test(t.ui.extendPanelText.textContent), t.ui.extendPanelText.textContent);

  tapPoint(t, points, 2);                       // C — zwei Kanten weiter
  assert.strictEqual(t.state.extension.secondIndex, 2, 'der zweite Punkt ist vorgemerkt');
  assert.ok(/Ein Punkt fällt weg/.test(t.ui.extendPanelText.textContent), t.ui.extendPanelText.textContent);
  assert.ok(t.ui.extendPanelText.textContent.includes('Punkt 3'), 'und er ist benannt');
  assert.strictEqual(perimeterXY(t), before, 'angekuendigt ist noch nicht geloescht');
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'sie bleibt bis dahin geschlossen');
  assert.strictEqual(t.state.extension.phase, 'picking', 'die Auswahl laeuft weiter');
  // Beide gewaehlten Punkte sind markiert, sonst waere nicht zu sehen, welche Strecke gemeint ist.
  assert.strictEqual(markedIndices(t).sort().join(','), '0,2', 'beide Enden der Strecke sind markiert');

  // Ein anderer Punkt verschiebt nur die Vorschau — auch das aendert nichts an der Kontur.
  tapPoint(t, points, 3);                       // D — drei Kanten weiter, kuerzere Seite ist die andere
  assert.strictEqual(t.state.extension.secondIndex, 3);
  assert.strictEqual(perimeterXY(t), before, 'auch der Wechsel aendert nichts');

  // Erst der zweite Tipp auf denselben Punkt fuehrt es aus.
  tapPoint(t, points, 3);
  await flush();
  assert.strictEqual(t.state.extension.phase, 'adding');
  assert.strictEqual(t.state.activeMap.perimeterClosed, false, 'jetzt ist die Kontur offen');
  assert.strictEqual(t.state.activeMap.perimeter.length, 4, 'ein Punkt ist weggefallen');
  assert.ok(/Ein Punkt weg/.test(t.ui.extendPanelText.textContent),
    `die Zahl steht auch hinterher noch da: ${t.ui.extendPanelText.textContent}`);
});

test('Zwei benachbarte Punkte trennen die Kante auf und ordnen die Folge neu', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  const points = t.state.activeMap.perimeter;

  cutAtPoints(t, points, 1, 2);                 // B zuerst -> neues Ende, dann C daneben
  await flush();

  assert.strictEqual(t.state.activeMap.perimeterClosed, false, 'die Kontur ist jetzt offen');
  assert.strictEqual(t.state.extension.phase, 'adding');
  // Ab dem zweiten Punkt (C) im Ring herum bis zum ersten (B): C, D, A, B.
  assert.strictEqual(perimeterXY(t), '10,10 | 0,10 | 0,0 | 10,0');
  assert.strictEqual(t.ui.extendDoneBtn.hidden, false, '„Fertig“ steht im Hinweisbereich');
  assert.strictEqual(t.ui.extendCancelBtn.hidden, true, 'abbrechen geht jetzt nicht mehr');
  assert.strictEqual(t.ui.extendPanel.hidden, false, 'die Anleitung bleibt waehrend des Aufnehmens sichtbar');
});

test('Die Richtung folgt der Reihenfolge der Auswahl', () => {
  const { t } = setup();
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const asText = (list) => list.map((p) => `${p.x},${p.y}`).join(' | ');
  // Erst B, dann C: die Folge endet auf B.
  assert.strictEqual(asText(t.reorderForExtension(square, 1, 2)), '10,10 | 0,10 | 0,0 | 10,0');
  // Erst C, dann B: dieselbe Kante, aber die Folge endet auf C.
  assert.strictEqual(asText(t.reorderForExtension(square, 2, 1)), '10,0 | 0,0 | 0,10 | 10,10');
  // Ueber die Schlussstrecke: erst D, dann A.
  assert.strictEqual(asText(t.reorderForExtension(square, 3, 0)), '0,0 | 10,0 | 10,10 | 0,10');
});

test('Neue Punkte landen zwischen den beiden gewaehlten und „Fertig“ schliesst wieder', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  const points = t.state.activeMap.perimeter;
  cutAtPoints(t, points, 1, 2);                 // B, dann C
  await flush();

  // Aufnehmen laeuft voellig unveraendert — dieselbe Funktion wie bei der Erstaufnahme.
  t.state.telemetry.x = 20; t.state.telemetry.y = 5; t.state.fixHistory = [];
  await t.appendCurrentPoint();
  assert.strictEqual(perimeterXY(t), '10,10 | 0,10 | 0,0 | 10,0 | 20,5',
    'der neue Punkt haengt am ersten gewaehlten Punkt (B) an');

  await t.finishExtension();
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'die Kontur ist wieder geschlossen');
  assert.strictEqual(t.state.extension, null);
  assert.strictEqual(t.ui.extendPanel.hidden, true, 'der Hinweisbereich verschwindet wieder');
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'geschlossen: erneutes Erweitern ist wieder moeglich');
  assert.strictEqual(t.ui.extendBtnLabel.textContent, 'Erweitern', 'kurz genug fuer die Leiste');
  // Im Ring liegt der neue Punkt genau zwischen B und C: … B, X, C …
  const ring = t.state.activeMap.perimeter.map((p) => `${p.x},${p.y}`);
  const at = ring.indexOf('20,5');
  const n = ring.length;
  assert.strictEqual(ring[(at - 1 + n) % n], '10,0', 'davor steht B');
  assert.strictEqual(ring[(at + 1) % n], '10,10', 'dahinter steht C');
});

test('Abbrechen waehrend der Auswahl aendert nichts', () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  const before = perimeterXY(t);
  t.startExtension();
  tapPoint(t, t.state.activeMap.perimeter, 0);
  t.cancelExtension();
  assert.strictEqual(t.state.extension, null);
  assert.strictEqual(perimeterXY(t), before);
  assert.strictEqual(t.state.activeMap.perimeterClosed, true);
});

test('Auftrennen und jeder neue Punkt sind einzeln rueckgaengig zu machen', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  const before = perimeterXY(t);
  const undoBefore = t.state.undoStack.length;
  t.startExtension();
  const points = t.state.activeMap.perimeter;
  cutAtPoints(t, points, 1, 2);
  await flush();
  assert.strictEqual(t.state.undoStack.length, undoBefore + 1, 'das Auftrennen ist ein Schritt');

  t.state.telemetry.x = 20; t.state.fixHistory = [];
  await t.appendCurrentPoint();
  t.state.telemetry.x = 21; t.state.fixHistory = [];
  await t.appendCurrentPoint();
  assert.strictEqual(t.state.undoStack.length, undoBefore + 3, 'jeder Punkt ist ein eigener Schritt');

  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 5, 'nur der letzte Punkt faellt weg');
  assert.ok(t.state.extension, 'die Erweiterung laeuft weiter');

  await t.undoLastAction();
  assert.strictEqual(t.state.activeMap.perimeter.length, 4);
  await t.undoLastAction();
  assert.strictEqual(perimeterXY(t), before, 'auch das Auftrennen laesst sich zuruecknehmen');
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'die Kontur ist wieder geschlossen');
  assert.strictEqual(t.state.extension, null, 'damit endet auch die Erweiterung');
});

test('In der Auswahlphase sind Einfuegen und Flaechenauswahl abgeschaltet', async () => {
  const { t } = setup();
  t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
  t.state.activeExclusionId = 'ex1';
  t.setMode('exclusion');
  const points = t.state.activeMap.exclusions[0].points;

  // Ohne Erweiterung greift die Flaechenauswahl beim Tipp in die Innenflaeche.
  t.renderMap();
  const inside = t.toScreen({ x: 5, y: 5 }, t.state.currentTransform);
  t.handleMapTap(tapAt(t, inside.x, inside.y));
  assert.strictEqual(t.state.selectedArea, 'ex1', 'normal waehlt der Tipp die Flaeche aus');
  t.clearPointSelection();

  t.startExtension();
  t.handleMapTap(tapAt(t, inside.x, inside.y));
  assert.strictEqual(t.state.selectedArea, null, 'waehrend der Erweiterung nicht');

  cutAtPoints(t, points, 0, 1);
  await flush();
  assert.strictEqual(t.state.extension.phase, 'adding');

  // Ein Punkt laesst sich zwar noch auswaehlen, die Einfuegen-Werkzeuge bleiben aber weg.
  t.applyPointSelection({ role: 'exclusion', index: 0, exclusionId: 'ex1' });
  assert.strictEqual(t.ui.insertBeforeWrap.hidden, true, 'kein Einfuegen waehrend der Erweiterung');
  assert.strictEqual(t.ui.insertAfterWrap.hidden, true);
});

test('Ein Tipp ins Leere hebt die Auswahl auch in Phase adding auf — Perimeter wie Flaeche', async () => {
  // Vorher blieb eine Auswahl dort haengen: der Tipp ins Leere lief in den frueheren Ausstieg
  // „waehrend der Erweiterung faengt kein Tipp die Flaeche ab“, der nicht nach der Phase fragte.
  // Der Hauptknopf stand damit dauerhaft auf „Verschieben“, obwohl der Hinweisstreifen zum
  // Aufnehmen aufforderte.
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  cutAtPoints(t, t.state.activeMap.perimeter, 0, 1);
  await flush();
  assert.strictEqual(t.state.extension.phase, 'adding');

  tapPoint(t, t.state.activeMap.perimeter, 2);
  assert.ok(t.state.selectedPoint, 'ein Punkttipp waehlt in dieser Phase aus');
  tapEmpty(t);
  assert.strictEqual(t.state.selectedPoint, null, 'und der Tipp ins Leere hebt das wieder auf');

  // Dieselbe Geste an einer Ausschlussflaeche.
  const u = setup();
  u.t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
    points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }];
  u.t.state.activeExclusionId = 'ex1';
  u.t.setMode('exclusion');
  const ex = u.t.state.activeMap.exclusions[0];
  u.t.startExtension();
  cutAtPoints(u.t, ex.points, 0, 1);
  await flush();
  assert.strictEqual(u.t.state.extension.phase, 'adding');
  tapPoint(u.t, ex.points, 2);
  assert.ok(u.t.state.selectedPoint, 'auch an der Flaeche waehlt der Tipp aus');
  tapEmpty(u.t);
  assert.strictEqual(u.t.state.selectedPoint, null, 'und laesst sich genauso wieder aufheben');
});

test('In der Auswahlphase aendert der Tipp ins Leere weiterhin nichts', () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  tapPoint(t, t.state.activeMap.perimeter, 0);
  assert.strictEqual(t.state.extension.firstIndex, 0, 'der erste Punkt der Kante ist gewaehlt');
  tapEmpty(t);
  assert.strictEqual(t.state.extension.firstIndex, 0, 'ein Fehlgriff daneben wirft ihn nicht weg');
  assert.strictEqual(t.state.selectedPoint, null, 'und erzeugt keine Punktauswahl');
  assert.strictEqual(t.state.selectedArea, null, 'auch keine Flaechenauswahl');
  assert.strictEqual(t.state.extension.phase, 'picking');
});

test('Der zuerst getippte Punkt ist das Ende, an dem weitergebaut wird', async () => {
  // Die Regel steckt allein in der Umordnung durch reorderForExtension(); ohne diesen Test
  // liesse sie sich still umdrehen, ohne dass ein anderer Fall anschlaegt.
  const appendAfterTaps = async (first, second) => {
    const { t } = setup();
    seedClosedPerimeter(t);                       // A(0,0) B(10,0) C(10,10) D(0,10)
    const before = t.state.activeMap.perimeter.map((p) => `${p.x},${p.y}`);
    t.startExtension();
    cutAtPoints(t, t.state.activeMap.perimeter, first, second);
    await flush();
    t.state.telemetry.x = 99; t.state.telemetry.y = 99; t.state.fixHistory = [];
    await t.appendCurrentPoint();
    const after = t.state.activeMap.perimeter;
    return { erwartet: before[first], vorletzter: `${after[after.length - 2].x},${after[after.length - 2].y}` };
  };

  const ab = await appendAfterTaps(0, 1);
  assert.strictEqual(ab.vorletzter, ab.erwartet, 'erst A getippt: der neue Punkt haengt an A');
  const ba = await appendAfterTaps(1, 0);
  assert.strictEqual(ba.vorletzter, ba.erwartet, 'erst B getippt: dann haengt er an B');
  assert.notStrictEqual(ab.erwartet, ba.erwartet, 'die Reihenfolge der Tipps entscheidet wirklich');
});

test('Markierung, Hinweiszeile und Vorschau nennen dasselbe Ende wie das Anhaengen', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  tapPoint(t, t.state.activeMap.perimeter, 1);                     // B zuerst
  assert.strictEqual(markedIndices(t).join(','), '1', 'schon in der Auswahlphase markiert');
  assert.ok(t.ui.extendPanelText.textContent.includes('Punkt 2'), t.ui.extendPanelText.textContent);
  assert.ok(/bleibt das Ende/.test(t.ui.extendPanelText.textContent), 'die Regel steht im Text');
  const guide = () => t.ui.robotLayer.children.filter((c) => (c.attributes?.class || '').includes('extend-guide-line'));
  t.renderMap();
  assert.strictEqual(guide().length, 0,
    'in der Auswahlphase noch keine Vorschau — es ist nichts aufgetrennt, es haengt nichts an');

  // Der zweite Punkt wird vorgemerkt und mitmarkiert; erst der Tipp darauf trennt auf.
  tapPoint(t, t.state.activeMap.perimeter, 2);
  assert.strictEqual(markedIndices(t).sort().join(','), '1,2', 'beide gewaehlten Punkte sind markiert');
  tapPoint(t, t.state.activeMap.perimeter, 2);
  await flush();
  const endOf = () => {
    const marked = markedIndices(t);
    assert.strictEqual(marked.length, 1, 'genau ein Ende ist markiert');
    return marked[0];
  };
  t.renderMap();
  let end = endOf();
  const pts = () => t.state.activeMap.perimeter;
  assert.strictEqual(`${pts()[end].x},${pts()[end].y}`, '10,0', 'markiert ist der zuerst getippte Punkt B');
  assert.ok(t.ui.extendPanelText.textContent.includes(`Punkt ${end + 1}`), t.ui.extendPanelText.textContent);
  // Die Vorschaulinie haengt am selben Punkt und endet an der Maeherposition.
  assert.strictEqual(guide().length, 1, 'nach dem Auftrennen wird sie gezeichnet');
  const anchor = t.toScreen(pts()[end], t.state.currentTransform);
  const mower = t.toScreen(t.state.telemetry, t.state.currentTransform);
  assert.strictEqual(guide()[0].attributes.x1, String(anchor.x), 'sie beginnt am markierten Ende');
  assert.strictEqual(guide()[0].attributes.y1, String(anchor.y));
  assert.strictEqual(guide()[0].attributes.x2, String(mower.x), 'und endet am Maeher');

  // Aufnehmen: der neue Punkt landet genau dort, und die Markierung wandert mit.
  t.state.telemetry.x = 77; t.state.telemetry.y = 77; t.state.fixHistory = [];
  const wasEnd = `${pts()[end].x},${pts()[end].y}`;
  await t.addCurrentPoint();   // der echte Knopfweg: er zeichnet und frischt die Leiste auf
  t.renderMap();
  assert.strictEqual(`${pts()[pts().length - 2].x},${pts()[pts().length - 2].y}`, wasEnd,
    'der neue Punkt haengt hinter dem markierten Ende');
  end = endOf();
  assert.strictEqual(end, pts().length - 1, 'markiert ist jetzt der neue Punkt');
  assert.ok(t.ui.extendPanelText.textContent.includes(`Punkt ${end + 1}`),
    'und die Hinweiszeile nennt dieselbe Nummer');

  // Mit ausgewaehltem Punkt haengt nichts an — dann darf die Vorschau das auch nicht behaupten.
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.renderMap();
  assert.strictEqual(guide().length, 0, 'bei Auswahl keine Vorschau');
  assert.strictEqual(
    t.ui.robotLayer.children.filter((c) => (c.attributes?.class || '').includes('edit-distance-line')).length, 1,
    'dort zeigt stattdessen die Auswahllinie — nie beide gleichzeitig');
});

/** Bringt eine geschlossene Kontur in Phase adding und waehlt danach einen Punkt aus. */
async function seedAddingWithSelection(t, { role = 'perimeter' } = {}) {
  if (role === 'exclusion') {
    t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
    t.state.activeExclusionId = 'ex1';
    t.setMode('exclusion');
  } else {
    seedClosedPerimeter(t);
  }
  const pts = () => (role === 'exclusion' ? t.state.activeMap.exclusions[0].points : t.state.activeMap.perimeter);
  t.startExtension();
  cutAtPoints(t, pts(), 0, 1);
  await flush();
  assert.strictEqual(t.state.extension.phase, 'adding');
  tapPoint(t, pts(), 1);                       // irgendeinen bestehenden Punkt auswaehlen
  assert.ok(t.state.selectedPoint, 'ein Punkt ist ausgewaehlt');
  return pts;
}
/** Der echte Bedienweg des Hauptknopfes: gedrueckt halten, bis die Aufnahme ausloest. */
async function holdCapture(t, clock) {
  t.beginCaptureHold({ pointerId: 1, preventDefault() {} });
  await clock.runFor(700);
  await flush();
}

test('In Phase adding haengt der Hauptknopf an, auch mit ausgewaehltem Punkt', async () => {
  // Vorher stand er auf „Verschieben“ und ueberschrieb eine bestehende Ecke der Kontur, die
  // gerade erweitert wurde — gemessen: Laenge blieb gleich, ein Punkt sprang auf die
  // Maeherposition.
  for (const role of ['perimeter', 'exclusion']) {
    const { t, clock } = setup();
    const pts = await seedAddingWithSelection(t, { role });
    const before = pts().map((p) => `${p.x},${p.y}`);

    t.state.telemetry.x = 55; t.state.telemetry.y = 55; t.state.fixHistory = [];
    t.refreshCaptureState();
    await holdCapture(t, clock);

    assert.strictEqual(pts().length, before.length + 1, `${role}: die Punktzahl waechst um 1`);
    assert.deepStrictEqual(pts().slice(0, before.length).map((p) => `${p.x},${p.y}`), before,
      `${role}: kein bestehender Punkt hat sich veraendert`);
    assert.strictEqual(`${pts()[pts().length - 1].x},${pts()[pts().length - 1].y}`, '55,55',
      `${role}: der neue Punkt liegt an der Maeherposition`);
  }
});

test('Der eigene Knopf verschiebt denselben Punkt, den der Hauptknopf frueher verschoben hat', async () => {
  for (const role of ['perimeter', 'exclusion']) {
    const { t } = setup();
    const pts = await seedAddingWithSelection(t, { role });
    const index = t.state.selectedPoint.index;
    const laenge = pts().length;
    const unbeteiligt = pts().filter((_, i) => i !== index).map((p) => `${p.x},${p.y}`);

    t.state.telemetry.x = 55; t.state.telemetry.y = 55; t.state.fixHistory = [];
    t.refreshCaptureState();
    assert.strictEqual(t.ui.movePointBtn.disabled, false, `${role}: der Knopf ist bedienbar`);
    await t.movePointToMower();
    await flush();

    assert.strictEqual(pts().length, laenge, `${role}: es kommt kein Punkt dazu`);
    assert.strictEqual(`${pts()[index].x},${pts()[index].y}`, '55,55',
      `${role}: genau der ausgewaehlte Punkt ist gewandert`);
    assert.deepStrictEqual(pts().filter((_, i) => i !== index).map((p) => `${p.x},${p.y}`), unbeteiligt,
      `${role}: die uebrigen Punkte bleiben unberuehrt`);
    assert.strictEqual(t.state.selectedPoint, null, `${role}: danach ist nichts mehr ausgewaehlt`);
  }
});

test('Beide Knoepfe stehen gleichzeitig da und sind beschriftet, wie sie wirken', async () => {
  const { t } = setup();
  await seedAddingWithSelection(t);
  t.refreshCaptureState();

  assert.strictEqual(t.ui.captureFabWrap.hidden, false, 'der Hauptknopf steht da');
  assert.strictEqual(t.ui.moveFabWrap.hidden, false, 'und daneben der Verschieben-Knopf');
  assert.strictEqual(t.ui.autoFabWrap.hidden, true, 'er nimmt den Platz des Automatik-Knopfes ein');
  assert.strictEqual(t.ui.captureButtonTitle.textContent, 'Punkt aufnehmen',
    'der Hauptknopf sagt, was er tut');
  assert.ok(!t.ui.addPointBtn.classList.contains('move-mode'),
    'und zeigt das Aufnahme- statt des Verschieben-Symbols');
  assert.strictEqual(t.ui.moveFabLabel.textContent, 'Verschieben');

  // Die Geste folgt derselben Entscheidung: Halten nimmt auf, ein Tap bewirkt nichts.
  const vorher = t.state.activeMap.perimeter.map((p) => `${p.x},${p.y}`).join('|');
  t.captureButtonTap();
  await flush();
  assert.strictEqual(t.state.activeMap.perimeter.map((p) => `${p.x},${p.y}`).join('|'), vorher,
    'ein Tap auf den Hauptknopf verschiebt hier nichts mehr');
  // Und ein laufendes Halten ueberlebt den naechsten Telemetrie-Takt.
  t.beginCaptureHold({ pointerId: 1, preventDefault() {} });
  assert.ok(t.state.captureHold, 'Halten laeuft trotz Auswahl');
  t.refreshCaptureState();
  assert.ok(t.state.captureHold, 'und wird vom Telemetrie-Takt nicht abgebrochen');
  t.cancelCaptureHold();
});

test('Ausserhalb von Phase adding bleibt der Hauptknopf der Verschieben-Knopf', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.setMode('perimeter');
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  assert.strictEqual(t.ui.captureButtonTitle.textContent, 'Verschieben');
  assert.ok(t.ui.addPointBtn.classList.contains('move-mode'));
  assert.strictEqual(t.ui.moveFabWrap.hidden, true, 'kein zweiter Knopf daneben');
  assert.strictEqual(t.ui.autoFabWrap.hidden, true, 'der Platz bleibt leer wie bisher');

  t.state.telemetry.x = 9; t.state.telemetry.y = 9; t.state.fixHistory = [];
  t.refreshCaptureState();
  t.captureButtonTap();
  await flush();
  assert.strictEqual(t.state.activeMap.perimeter.length, 3, 'es kommt kein Punkt dazu');
  assert.strictEqual(`${t.state.activeMap.perimeter[1].x},${t.state.activeMap.perimeter[1].y}`, '9,9',
    'der Tap verschiebt wie bisher');

  // Auch in der Auswahlphase einer Erweiterung aendert sich nichts.
  const u = setup();
  seedClosedPerimeter(u.t);
  u.t.startExtension();
  u.t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  assert.strictEqual(u.t.ui.moveFabWrap.hidden, true, 'in der Auswahlphase kein eigener Knopf');
  assert.ok(u.t.ui.addPointBtn.classList.contains('move-mode'), 'der Hauptknopf verschiebt dort');
});

test('Verschoben wird auf genau einem Weg, und der Knopf haengt daran', () => {
  // Der Harness stubbt addEventListener als No-Op, Klicks sind also nicht simulierbar — die
  // Verdrahtung wird deshalb im Quelltext geprueft, wie bei den uebrigen Knoepfen auch.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/ui\.movePointBtn\.addEventListener\('click',[\s\S]{0,60}?movePointToMower\(\)/.test(src),
    'der Verschieben-Knopf muss movePointToMower() rufen, nicht den Aufnahmepfad');
  // relearnSelectedPoint() ist der eigentliche Griff: genau ein Aufrufer, sonst gibt es zwei Wege.
  const rufer = [...src.matchAll(/relearnSelectedPoint\(\)/g)].length;
  assert.strictEqual(rufer, 2, `relearnSelectedPoint: 1 Definition + 1 Aufrufer erwartet, gefunden ${rufer}`);
  assert.ok(/async function movePointToMower\(\)[\s\S]{0,300}?relearnSelectedPoint\(\)/.test(src),
    'und dieser eine Aufrufer ist movePointToMower()');
});

test('Eine veraltete Auswahl macht den Hauptknopf nicht zum Verschieben-Knopf', () => {
  // state.selectedPoint kann auf einen Platz zeigen, den es nicht mehr gibt. Dann darf weder der
  // Hauptknopf Verschieben versprechen noch duerfen beide oberen Knoepfe zugleich verschwinden.
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  t.setMode('perimeter');
  t.state.selectedPoint = { role: 'perimeter', index: 7, exclusionId: null };
  t.refreshCaptureState();
  assert.strictEqual(t.ui.captureButtonTitle.textContent, 'Punkt aufnehmen',
    'ohne wirklichen Punkt gibt es nichts zu verschieben');
  assert.ok(!t.ui.addPointBtn.classList.contains('move-mode'));
  assert.strictEqual(t.ui.moveFabWrap.hidden, true, 'kein Verschieben-Knopf fuer einen Phantompunkt');
  assert.strictEqual(t.ui.autoFabWrap.hidden, false, 'der obere Platz bleibt der Automatik');
});

test('Die Texte der Erweiterung tragen in DE und EN dieselben Platzhalter', () => {
  const { t } = setup();
  const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of ['extendPickFirst', 'extendPickSecond', 'extendOpened']) {
    const de = t.I18N.de[key]; const en = t.I18N.en[key];
    assert.ok(de && en, `${key} fehlt in einer Sprache`);
    assert.strictEqual(placeholders(en), placeholders(de), `${key}: unterschiedliche Platzhalter`);
  }
  // Und die Nummer wird tatsaechlich eingesetzt, nicht als {n} stehengelassen.
  for (const lang of ['de', 'en']) {
    const u = setup();
    u.t.state.language = lang;
    seedClosedPerimeter(u.t);
    u.t.startExtension();
    tapPoint(u.t, u.t.state.activeMap.perimeter, 1);
    assert.ok(!u.t.ui.extendPanelText.textContent.includes('{n}'), `${lang}: Platzhalterrest im Hinweis`);
    assert.ok(/\b2\b/.test(u.t.ui.extendPanelText.textContent), `${lang}: die Punktnummer fehlt`);
  }
});

test('Ein Moduswechsel beendet die Erweiterung und laesst die Kontur offen', async () => {
  const { t } = setup();
  seedClosedPerimeter(t);
  t.startExtension();
  const points = t.state.activeMap.perimeter;
  cutAtPoints(t, points, 0, 1);
  await flush();
  assert.strictEqual(t.state.activeMap.perimeterClosed, false);

  t.setMode('waypoint');
  assert.strictEqual(t.state.extension, null, 'die Erweiterung endet');
  assert.strictEqual(t.state.activeMap.perimeterClosed, false,
    'die Kontur bleibt offen — dafuer gibt es die Rueckfrage beim Moduswechsel und die Kartenpruefung');
  // Und genau so findet die bestehende Logik sie wieder.
  assert.ok(t.openContours().some((c) => c.role === 'perimeter'), 'sie zaehlt als offene Kontur');
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

test('Fehlgeschlagener Funkbefehl: Kurzhinweis immer, Dialog nur gedrosselt', async () => {
  const { t, sandbox, clock, elements } = setup();
  await t.reportBleError('AT+M', new Error('GATT operation failed'));
  assert.ok(elements.get('pointStatus').textContent.includes('Senden fehlgeschlagen'), 'Kurzhinweis auf der Karte');
  assert.ok(elements.get('debugLog').textContent.includes('GATT operation failed'), 'und im Protokoll');
  assert.ok(sandbox.__lastConfirmRequest, 'erster Fehler wird gezeigt');
  assert.strictEqual(sandbox.__lastConfirmRequest.tone, 'danger');

  sandbox.__lastConfirmRequest = null;
  elements.get('pointStatus').textContent = '';
  await t.reportBleError('AT+M', new Error('zweiter Fehler'));
  assert.ok(elements.get('pointStatus').textContent.includes('zweiter Fehler'), 'Kurzhinweis kommt trotzdem');
  assert.strictEqual(sandbox.__lastConfirmRequest, null, 'kein zweiter Dialog innerhalb der Sperrzeit');

  // Not-Halt und Tastendruck erzwingen die Meldung sofort.
  await t.reportBleError('AT+M,0,0', new Error('Stopp kam nicht an'), { immediate: true });
  assert.ok(sandbox.__lastConfirmRequest.message.includes('Stopp kam nicht an'));

  // Nach der Sperrzeit wieder.
  sandbox.__lastConfirmRequest = null;
  await clock.runFor(21000);
  await t.reportBleError('AT+S', new Error('spaeter Fehler'));
  assert.ok(sandbox.__lastConfirmRequest, 'nach 20 s wird wieder gemeldet');
});

test('Gesperrte und offene Karten sind am Schloss klar unterscheidbar', () => {
  const { t } = setup();
  const closed = t.lockIcon(true);
  const open = t.lockIcon(false);
  // Der Buegel wird unterschiedlich gezeichnet, nicht nur eingefaerbt.
  // svgEl() setzt die Klasse als Attribut, nicht ueber classList.
  const shackle = (icon) => icon.children.find((c) => c.attributes?.class === 'lock-shackle')?.attributes?.d;
  assert.ok(shackle(closed), 'geschlossenes Schloss hat einen Buegel');
  assert.ok(shackle(open), 'offenes Schloss hat einen Buegel');
  assert.notStrictEqual(shackle(closed), shackle(open), 'die Form muss sich unterscheiden');
  const cls = (icon) => icon.attributes.class;
  assert.ok(cls(closed).includes('locked') && cls(open).includes('open'), 'Zustand steht auch in der Klasse');
  // Nur das geschlossene Schloss hat ein Schluesselloch.
  assert.strictEqual(closed.children.filter((c) => c.attributes?.class === 'lock-keyhole').length, 1);
  assert.strictEqual(open.children.filter((c) => c.attributes?.class === 'lock-keyhole').length, 0);
});

test('Update-Hinweis steht auf der Hauptseite und uebergibt an die wartende Fassung', () => {
  const { t } = setup();
  t.ui.updateBar.hidden = true; // im echten Markup steht hidden bereits am Element
  const messages = [];
  const registration = { waiting: { postMessage: (m) => messages.push(m) } };
  t.showUpdateBar(registration);
  assert.strictEqual(t.ui.updateBar.hidden, false);
  t.applyUpdate();
  assert.strictEqual(t.ui.updateBar.hidden, true, 'Leiste verschwindet nach dem Tippen');
  assert.strictEqual(messages.length, 1, 'genau eine Nachricht an die wartende Fassung');
  assert.strictEqual(messages[0].type, 'skipWaiting');
});

test('Die Kontur-Rueckfrage sagt in den Knoepfen, was passiert', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  sandbox.__confirmAnswer = false;
  await t.offerToCloseContour('perimeter');
  assert.strictEqual(sandbox.__lastConfirmRequest.confirmLabel, 'Kontur automatisch schließen');
  assert.strictEqual(sandbox.__lastConfirmRequest.cancelLabel, 'Kontur NOCH NICHT schließen');
  assert.strictEqual(t.state.activeMap.perimeterClosed, false, '"noch nicht" laesst sie offen');
});

test('Die Elementliste zeigt alle Bestandteile der Karte mit Punktzahl', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  t.state.activeMap.waypoints = [{ x: 2, y: 2 }];
  t.state.activeMap.dockPoints = [{ x: 3, y: 3 }, { x: 4, y: 4 }];
  await t.createExclusion();
  t.state.activeMap.exclusions[0].points.push({ x: 5, y: 5 });
  const items = t.mapElements();
  assert.strictEqual(items.map((i) => i.role).join(','), 'perimeter,exclusion,waypoint,dock');
  assert.strictEqual(items.map((i) => i.points.length).join(','), '3,1,1,2');
});

test('Jedes Element laesst sich einzeln loeschen', async () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  t.state.activeMap.perimeterClosed = true;
  t.state.activeMap.dockPoints = [{ x: 3, y: 3 }];
  await t.createExclusion();
  const exclusionId = t.state.activeMap.exclusions[0].id;
  t.state.activeMap.exclusions[0].points.push({ x: 5, y: 5 });

  sandbox.__confirmAnswer = false;
  await t.deleteElement('perimeter', null);
  assert.strictEqual(t.state.activeMap.perimeter.length, 3, 'ohne Bestaetigung bleibt alles stehen');

  sandbox.__confirmAnswer = true;
  await t.deleteElement('perimeter', null);
  assert.strictEqual(t.state.activeMap.perimeter.length, 0);
  assert.strictEqual(t.state.activeMap.perimeterClosed, false, 'geleerter Perimeter ist wieder offen');

  await t.deleteElement('exclusion', exclusionId);
  assert.strictEqual(t.state.activeMap.exclusions.length, 0, 'Ausschlussflaeche verschwindet ganz');

  await t.deleteElement('dock', null);
  assert.strictEqual(t.state.activeMap.dockPoints.length, 0);
});

test('Tippen auf eine Zeile macht das Element zum Aufnahmeziel', async () => {
  const { t } = setup();
  await t.createExclusion();
  const exclusionId = t.state.activeMap.exclusions[0].id;
  t.activateElement('dock', null);
  assert.strictEqual(t.state.mode, 'dock');
  t.activateElement('exclusion', exclusionId);
  assert.strictEqual(t.state.mode, 'exclusion');
  assert.strictEqual(t.state.activeExclusionId, exclusionId);
});

test('Schnellzugriff „schließen & neue“ erscheint erst ab drei Punkten', async () => {
  const { t } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  const exclusion = t.currentExclusion();
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'ohne Punkte kein Schnellzugriff');

  exclusion.points.push({ x: 0, y: 0 }, { x: 1, y: 0 });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'bei zwei Punkten noch nicht');

  exclusion.points.push({ x: 1, y: 1 });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, false, 'ab drei Punkten sichtbar');
  assert.strictEqual(t.canCloseAndStartNew(), true);
});

test('Schnellzugriff schließt die Fläche und beginnt ohne Rückfrage eine neue', async () => {
  const { t, sandbox } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  const first = t.currentExclusion();
  first.points.push({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 });
  t.refreshCaptureState();

  sandbox.__lastConfirmRequest = null;
  await t.closeAndStartNewExclusion();
  assert.strictEqual(sandbox.__lastConfirmRequest, null, 'bewusste Aktion, keine Rueckfrage');
  assert.strictEqual(first.closed, true, 'die alte Flaeche ist geschlossen');
  assert.strictEqual(t.state.activeMap.exclusions.length, 2, 'eine neue Flaeche kam dazu');
  const second = t.currentExclusion();
  assert.notStrictEqual(second.id, first.id, 'die neue ist jetzt aktiv');
  assert.strictEqual(second.points.length, 0, 'und leer');
  assert.strictEqual(second.closed, false);
  assert.strictEqual(t.state.mode, 'exclusion', 'der Modus bleibt');
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'Knopf verschwindet nach dem Zuruecksetzen');

  // Erst die naechsten drei Punkte bringen ihn zurueck.
  second.points.push({ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, false);
});

test('Schnellzugriff verschwindet bei Auswahl und bei bereits geschlossener Kontur', async () => {
  const { t } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  const exclusion = t.currentExclusion();
  exclusion.points.push({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, false);

  // Punktauswahl ueber den echten Weg: Tippen auf den Punkt in der Karte.
  t.renderMap();
  const metrics = t.svgMetrics();
  const screen = t.toScreen(exclusion.points[1], t.state.currentTransform);
  t.handleMapTap({ clientX: screen.x * metrics.scale + metrics.offX, clientY: screen.y * metrics.scale + metrics.offY });
  assert.ok(t.state.selectedPoint, 'der Tap muss den Punkt treffen');
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'bei ausgewaehltem Punkt verborgen');
  // Auch der naechste Telemetrie-Takt darf ihn nicht zurueckholen.
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'bleibt verborgen');
  t.clearPointSelection();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, false, 'ohne Auswahl wieder da');

  // Flaechenauswahl ebenso.
  t.state.selectedArea = exclusion.id;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'bei ausgewaehlter Flaeche verborgen');
  t.state.selectedArea = null;

  // Schon geschlossen: es gibt nichts mehr zu schliessen.
  exclusion.closed = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'geschlossene Kontur braucht den Knopf nicht');
  assert.strictEqual(t.canCloseAndStartNew(), false);
});

test('Schnellzugriff bleibt in anderen Modi und bei gesperrter Karte verborgen', async () => {
  const { t } = setup();
  t.setMode('exclusion');
  await t.createExclusion();
  t.currentExclusion().points.push({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 });
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, false);

  t.setMode('perimeter');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'nur im Ausschluss-Modus');

  t.setMode('exclusion');
  t.state.activeMap.locked = true;
  t.refreshCaptureState();
  assert.strictEqual(t.ui.closeAndNewWrap.hidden, true, 'gesperrte Karte laesst nichts schliessen');
});

test('Das Automatik-Label traegt das Intervall in beiden Sprachen und ohne Platzhalterrest', async () => {
  const { t } = setup();
  t.state.view.autoCaptureIntervalS = 7;
  t.setMode('waypoint');
  t.refreshCaptureState();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto-Aufnahme (7s)');

  await t.toggleAutoCapture();
  assert.strictEqual(t.state.autoCaptureRunning, true, 'ohne laufende Automatik sagt das Label nichts aus');
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatik läuft (7s)');

  t.toggleLanguage();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Automatic running (7s)');
  // Der haeufigste stille Rueckfall: tr() ersetzt den Platzhalter nicht mehr.
  assert.ok(!t.ui.autoCaptureLabel.textContent.includes('{'), 'kein unersetzter Platzhalter');
  t.toggleLanguage();
  t.stopAutoCapture();
  assert.strictEqual(t.ui.autoCaptureLabel.textContent, 'Auto-Aufnahme (7s)');
});


test('Das Aufnahmesymbol im Automatik-Knopf ist ein abgerundetes Quadrat', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const icon = html.slice(html.indexOf('class="auto-fab-icon icon-play"'), html.indexOf('icon-pause'));
  assert.ok(icon.includes('<rect'), 'Kassettenrekorder-Aufnahme ist eckig, kein Punkt');
  assert.ok(/rx="[\d.]+"/.test(icon), 'mit abgerundeten Ecken');
  assert.ok(!icon.includes('<circle'), 'der gefuellte Kreis ist ersetzt');
});

test('Ein Schalter spiegelt die gesamte Bedienung', () => {
  const { t, sandbox } = setup();
  const handed = () => sandbox.document.documentElement.getAttribute('data-handed');
  // Standard ist Rechtshaender — unveraendert gegenueber vorher.
  assert.strictEqual(t.state.view.handed, 'right');
  t.applyDriveZonePreferences();
  assert.strictEqual(handed(), 'right');

  t.ui.handedSelect.value = 'left';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.handed, 'left');
  assert.strictEqual(handed(), 'left', 'ein einziges Attribut am <html> schaltet alles um');

  t.ui.handedSelect.value = 'bogus';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.handed, 'right', 'unbekannte Werte fallen auf Rechtshaender zurueck');
  assert.strictEqual(handed(), 'right');

  // Es darf keine zweite, parallele Umschaltung mehr geben.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!src.includes('dataset.labelSide'), 'die alte Umschaltung an der Fahrzone ist entfernt');
  assert.strictEqual((src.match(/setAttribute\('data-handed'/g) || []).length, 1,
    'das Attribut wird an genau einer Stelle gesetzt');
});

test('Die alte Einstellung driveLabelSide wird auf die Haendigkeit uebernommen', () => {
  const { t, sandbox } = setup();
  // Alter Stand aus dem localStorage: driveLabelSide 'right' hiess Linkshaender.
  sandbox.localStorage.setItem('mapcreator-ardumower-view-prefs-v1', JSON.stringify({ driveLabelSide: 'right' }));
  t.loadViewPreferences();
  assert.strictEqual(t.state.view.handed, 'left', 'Anzeige rechts hiess Linkshaender');

  sandbox.localStorage.setItem('mapcreator-ardumower-view-prefs-v1', JSON.stringify({ driveLabelSide: 'left' }));
  t.loadViewPreferences();
  assert.strictEqual(t.state.view.handed, 'right');
});

test('Nur der Kartenname steht in der Leiste, die Punktzahl bleibt auf der Karte', () => {
  // Aufgeteilt: der Name gewinnt oben Platz, auf der Karte wird der Streifen dadurch kuerzer.
  // Doppelt darf der Name nirgends stehen.
  const { t } = setup();
  t.state.activeMap.name = 'Testwiese';
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  t.renderMap();
  assert.strictEqual(t.ui.mapNameLabel.textContent, 'Testwiese', 'der Name steht in der Leiste');
  assert.strictEqual(t.ui.mapSummary.textContent, '2 Punkte', 'auf der Karte nur noch die Punktzahl');
  assert.ok(!t.ui.mapSummary.textContent.includes('Testwiese'), 'und der Name dort kein zweites Mal');
  // Die Statuszeile ist dieselbe wie zuvor, nur an anderer Stelle.
  t.ui.pointStatus.textContent = '';
  t.refreshCaptureState();
  assert.ok(t.ui.pointStatus.textContent.length > 0, 'die Statuszeile wird weiterhin beschrieben');
});

test('Joystick-Groesse ist einstellbar und wirkt ueber die CSS-Variable', () => {
  const { t, sandbox } = setup();
  const scaleVar = () => sandbox.document.documentElement.style.getPropertyValue('--joystick-scale');
  assert.strictEqual(t.state.view.joystickScale, '1', 'Standard bleibt die bisherige Groesse');
  t.applyDriveZonePreferences();
  assert.strictEqual(scaleVar(), '1');

  for (const step of ['0.75', '1.25', '1.5']) {
    t.ui.joystickSizeSelect.value = step;
    t.updateViewPreferencesFromUi();
    assert.strictEqual(t.state.view.joystickScale, step);
    assert.strictEqual(scaleVar(), step, `Stufe ${step} muss ankommen`);
  }
  assert.strictEqual([...t.JOYSTICK_SCALES].join(','), '0.75,1,1.25,1.5');

  t.ui.joystickSizeSelect.value = '99';
  t.updateViewPreferencesFromUi();
  assert.strictEqual(t.state.view.joystickScale, '1', 'unbekannte Stufen fallen auf Standard zurueck');
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


test('Ein fehlendes Bedienelement legt die Karten nicht lahm', async () => {
  // Halb aktualisierter Cache: app.js ist neu, index.html noch alt. Frueher warf bindEvents(),
  // init() brach vor dem Oeffnen der Datenbank ab — und alle Karten schienen verschwunden.
  const { t, sandbox, clock } = setup({ missingIds: ['clearLogBtn', 'updateBar'] });
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
  assert.ok(t.state.db, 'die Datenbank wird trotzdem geoeffnet');
  assert.ok(t.state.activeMap, 'und eine Karte steht bereit');
  const logText = sandbox.document.getElementById('debugLog').textContent;
  assert.ok(logText.includes('clearLogBtn') && logText.includes('updateBar'),
    'die fehlenden Elemente stehen im Diagnoseprotokoll');
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


// --- Teilen ueber die Web Share API -----------------------------------------------------

/**
 * Faengt ab, was `downloadTextFile()` ausliefern wuerde: den Inhalt aus dem Blob, den Namen
 * aus dem erzeugten Anker. Anders kommt man im Harness nicht an die Datei des normalen
 * Exports heran — und genau die muss das Teilen wiederverwenden.
 */
function captureDownload(sandbox, run) {
  const realBlob = sandbox.Blob;
  const parts = [];
  sandbox.Blob = function BlobSpy(chunks, options) {
    parts.push({ text: chunks.join(''), type: options && options.type });
    return new realBlob(chunks, options);
  };
  const before = sandbox.document.body.children.length;
  try { run(); } finally { sandbox.Blob = realBlob; }
  const anchor = sandbox.document.body.children[before];
  assert.ok(parts.length === 1 && parts[0].text, 'der Export hat eine nicht leere Datei erzeugt');
  assert.ok(anchor && anchor.download, 'der Export haengt einen Download-Anker mit Dateinamen ein');
  return { text: parts[0].text, type: parts[0].type, fileName: anchor.download };
}

/** Haengt einen `navigator.share`/`canShare`-Ersatz ein und protokolliert die Aufrufe. */
function stubShare(sandbox, { canShare = () => true, onShare = null } = {}) {
  const shared = [];
  sandbox.navigator.canShare = (data) => Boolean(canShare(data));
  sandbox.navigator.share = async (data) => {
    shared.push(data);
    if (onShare) return onShare(data);
    return undefined;
  };
  sandbox.__lastConfirm = undefined;
  sandbox.__lastConfirmRequest = undefined;
  return shared;
}

for (const format of ['json', 'geojson']) {
  test(`Geteilt wird dieselbe Datei wie beim Export (${format})`, async () => {
    const { t, sandbox } = setup();
    t.state.activeMap.name = 'Hintergarten';
    t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }];
    const exported = captureDownload(sandbox, () => t.exportMapFile(format));
    const shared = stubShare(sandbox);
    await t.shareCurrentMap(format);
    assert.strictEqual(shared.length, 1, 'genau ein Teilen-Vorgang');
    const file = shared[0].files[0];
    assert.strictEqual(await file.text(), exported.text, 'derselbe Inhalt wie im Export');
    assert.strictEqual(file.name, exported.fileName, 'derselbe Dateiname wie im Export');
    assert.strictEqual(file.type, exported.type, 'derselbe MIME-Typ wie im Export');
    assert.ok(file.name.includes('Hintergarten'), 'der Kartenname steht im Dateinamen');
  });
}

test('Export und Teilen holen ihre Datei aus derselben Funktion', () => {
  // Sonst driften Inhalt oder Dateiname zwischen beiden Wegen auseinander.
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const share = source.slice(source.indexOf('async function shareCurrentMap'));
  assert.ok(share.slice(0, share.indexOf('\n}')).includes('mapExportFile('),
    'shareCurrentMap() baut die Datei nicht selbst, sondern nimmt mapExportFile()');
  assert.strictEqual((source.match(/JSON\.stringify\(mapToGeoJson\(/g) || []).length, 1,
    'die GeoJSON-Erzeugung steht genau einmal im Code');
  assert.strictEqual((source.match(/\.mapcreator-ardumower\.json/g) || []).length, 1,
    'die JSON-Endung steht genau einmal im Code');
});

test('Die Teilen-Knoepfe erscheinen nur, wenn das Geraet Dateien teilen kann', () => {
  const { t, elements, sandbox } = setup();
  stubShare(sandbox);
  t.refreshShareButtons();
  assert.strictEqual(elements.get('shareJsonBtn').hidden, false, 'mit Unterstuetzung sichtbar');
  assert.strictEqual(elements.get('shareGeoJsonBtn').hidden, false);
  delete sandbox.navigator.share;
  delete sandbox.navigator.canShare;
  t.refreshShareButtons();
  assert.strictEqual(elements.get('shareJsonBtn').hidden, true, 'ohne Unterstuetzung ausgeblendet');
  assert.strictEqual(elements.get('shareGeoJsonBtn').hidden, true);
});

test('canShare entscheidet je Dateityp, nicht pauschal', () => {
  // Chrome laesst nicht jeden MIME-Typ durch; GeoJSON kann abgelehnt werden, JSON durchgehen.
  const { t, elements, sandbox } = setup();
  stubShare(sandbox, { canShare: (data) => data.files.every((f) => f.type === 'application/json') });
  t.refreshShareButtons();
  assert.strictEqual(t.canShareMapFormat('json'), true);
  assert.strictEqual(t.canShareMapFormat('geojson'), false);
  assert.strictEqual(elements.get('shareJsonBtn').hidden, false);
  assert.strictEqual(elements.get('shareGeoJsonBtn').hidden, true, 'nur das abgelehnte Format verschwindet');
});

test('Ein Abbruch durch den Nutzer ist kein Fehler', async () => {
  const { t, sandbox } = setup();
  const abort = new Error('Share canceled');
  abort.name = 'AbortError';
  stubShare(sandbox, { onShare: () => Promise.reject(abort) });
  t.clearDebugLog();
  await t.shareCurrentMap('json');
  assert.strictEqual(sandbox.__lastConfirm, undefined, 'keine Meldung nach dem Schliessen des Teilen-Dialogs');
  assert.ok(!t.state.logEntries.join('\n').includes('FEHLER'), 'auch kein Fehler im Protokoll');
});

test('Ein echter Fehler beim Teilen wird gemeldet', async () => {
  const { t, sandbox } = setup();
  stubShare(sandbox, { onShare: () => Promise.reject(new Error('Freigabe fehlgeschlagen')) });
  t.clearDebugLog();
  await t.shareCurrentMap('json');
  assert.ok(String(sandbox.__lastConfirm).includes('Freigabe fehlgeschlagen'), 'der Fehler steht sichtbar in einer Meldung');
  assert.ok(t.state.logEntries.join('\n').includes('Freigabe fehlgeschlagen'), 'und im Diagnoseprotokoll');
});

test('Ohne Unterstuetzung wird nicht geteilt, sondern auf den Export verwiesen', async () => {
  const { t, sandbox } = setup();
  const shared = stubShare(sandbox);
  delete sandbox.navigator.share;
  delete sandbox.navigator.canShare;
  await t.shareCurrentMap('json');
  assert.strictEqual(shared.length, 0, 'es wird nichts geteilt');
  assert.ok(sandbox.__lastConfirmRequest, 'stattdessen kommt eine Meldung');
  assert.ok(typeof sandbox.__lastConfirm === 'string' && sandbox.__lastConfirm.includes('speichern'),
    'die Meldung verweist auf den normalen Export');
  assert.strictEqual(t.canShareMapFormat('json'), false);
});

test('Die Teilen-Knoepfe stehen bei den Export-Knoepfen und sind verdrahtet', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // Seit die Knoepfe nach Zweck gegliedert sind (Sunray / CaSSAndRA / Sicherung), gibt es
  // mehrere `export-grid`-Gruppen. Jeder Teilen-Knopf muss in derselben Gruppe stehen wie sein
  // eigener Speichern-Knopf — das ist die Wirkung, um die es geht.
  const gruppen = markup.split('class="export-grid"').slice(1)
    .map((teil) => teil.slice(0, teil.indexOf('</div>')));
  const gruppeMit = (id) => gruppen.find((g) => g.includes(`id="${id}"`));
  for (const [speichern, teilen] of [
    ['exportSunrayBtn', 'shareSunrayBtn'],
    ['exportCassandraBtn', 'shareCassandraBtn'],
    ['exportJsonBtn', 'shareJsonBtn'],
    ['exportGeoJsonBtn', 'shareGeoJsonBtn'],
  ]) {
    const g = gruppeMit(speichern);
    assert.ok(g, `${speichern} steht in keiner export-grid-Gruppe`);
    assert.ok(g.includes(`id="${teilen}"`), `${teilen} steht nicht bei ${speichern}`);
  }
  // Verborgen starten: erst die bestandene Faehigkeitspruefung blendet sie ein, sonst blitzt
  // auf Geraeten ohne Datei-Freigabe kurz ein Knopf auf, der nichts kann.
  for (const id of ['shareSunrayBtn', 'shareCassandraBtn', 'shareJsonBtn', 'shareGeoJsonBtn']) {
    const g = gruppeMit(id);
    const tag = g.slice(g.indexOf(`id="${id}"`) - 120, g.indexOf(`id="${id}"`));
    assert.ok(tag.includes('hidden'), `${id} ist im Markup zunaechst ausgeblendet`);
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/ui\.shareJsonBtn\.addEventListener\('click'/.test(source), 'JSON-Teilen ist verdrahtet');
  assert.ok(/ui\.shareGeoJsonBtn\.addEventListener\('click'/.test(source), 'GeoJSON-Teilen ist verdrahtet');
  assert.ok(source.includes('refreshShareButtons();'), 'die Verfuegbarkeit wird beim Start geprueft');
});

test('Leere Ursprungsfelder ergeben keinen Ursprung, nicht 0/0', async () => {
  // `Number('')` ist 0, und 0 liegt im gueltigen Bereich — ohne Vorpruefung waere ein geleertes
  // Feld die Nullinsel im Golf von Guinea, und der Nutzer koennte den Ursprung nie zuruecknehmen.
  const { t, elements } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  elements.get('positionModeSelect').value = 'absolute';
  elements.get('originLatInput').value = '52.26742967';
  elements.get('originLonInput').value = '8.60921633';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.origin.lat, 52.26742967, 'erst einmal gesetzt');
  assert.ok(t.mapOriginInUse(t.state.activeMap), 'und in Gebrauch');

  // Jetzt beide Felder leeren.
  elements.get('originLatInput').value = '';
  elements.get('originLonInput').value = '';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.origin, null, 'kein Ursprung — und ausdruecklich nicht 0/0');
  assert.strictEqual(t.state.activeMap.positionMode, 'absolute',
    'der Modus bleibt, ein geleertes Feld ist kein Widerruf der Moduswahl');
  assert.strictEqual(t.mapOriginInUse(t.state.activeMap), null);
  // Die Wirkung, auf die es ankommt: der Export bleibt bei lokalen Metern.
  const geo = t.mapToGeoJson(t.state.activeMap);
  assert.strictEqual(geo.properties.coordinateSystem, 'sunray-local-xy-meters');
  assert.strictEqual(geo.properties.units, 'm');
  assert.strictEqual(geo.properties.origin, null);
  assert.strictEqual(geo.features[0].geometry.coordinates[0][0].join(','), '0,0',
    'lokale Meter, keine Grad in der Naehe von 0/0');
  // Und der Zustand bleibt sichtbar: Auswahlfeld auf „absolut“, Felder offen und leer.
  assert.strictEqual(elements.get('positionModeSelect').value, 'absolute');
  assert.strictEqual(elements.get('originFields').hidden, false);
  assert.strictEqual(elements.get('originLatInput').value, '');

  // Ein einzeln geleertes Feld zaehlt genauso — ein halber Ursprung ist keiner.
  elements.get('originLatInput').value = '52.26742967';
  elements.get('originLonInput').value = '';
  await t.updatePositionModeFromUi();
  assert.strictEqual(t.state.activeMap.origin, null, 'auch ein halb gefuelltes Paar ergibt keinen Ursprung');
});

test('Beide Felderpaare lesen den Leerfall ueber dieselbe Funktion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.strictEqual((source.match(/function originFromInputs\(/g) || []).length, 1,
    'originFromInputs() steht genau einmal im Code');
  for (const fn of ['updatePositionModeFromUi', 'updateCassandraReferenceFromUi']) {
    const body = source.slice(source.indexOf(`function ${fn}(`));
    assert.ok(body.slice(0, body.indexOf('\n}')).includes('originFromInputs('),
      `${fn}() liest die Felder ueber originFromInputs()`);
  }
  // Und keiner der beiden greift daneben direkt auf normalizeOrigin mit Feldwerten zu.
  assert.strictEqual((source.match(/normalizeOrigin\(\{\s*lat: ui\./g) || []).length, 0,
    'kein Eingabefeld geht mehr unmittelbar in normalizeOrigin()');
});

test('Der CaSSAndRA-Export ist gesperrt, solange ein Bezugspunkt fehlt', () => {
  const { t, elements } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  t.state.cassandraReference = null;
  t.refreshExportButtons();
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, true, 'ausgegraut');
  assert.strictEqual(elements.get('exportCassandraBtn').hidden, false,
    'ausgegraut, NICHT ausgeblendet — der Nutzer soll sehen, dass es das Format gibt');
  assert.strictEqual(elements.get('shareCassandraBtn').disabled, true);
  const hint = elements.get('cassandraMissingHint');
  assert.strictEqual(hint.hidden, false, 'der Hinweis steht dabei');
  assert.ok(hint.textContent.includes('Bezugspunkt'), `der Hinweis nennt den Grund: ${hint.textContent}`);
  // Und es entsteht auch keine Datei — kein Weg fuehrt an der Sperre vorbei.
  assert.strictEqual(t.mapExportFile('cassandra'), null);
  assert.ok(t.mapExportFile('json'), 'die anderen Formate bleiben unberuehrt');
  assert.ok(t.mapExportFile('geojson'));
});

test('Die Sperre haengt nicht am Positionsmodus der Karte', () => {
  // Eine relativ gefuehrte Karte ist fuer dieses Format vollkommen brauchbar.
  const { t, elements } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  t.state.activeMap.positionMode = 'relative';
  t.state.activeMap.origin = null;
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.refreshExportButtons();
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, false);
  assert.strictEqual(elements.get('cassandraMissingHint').hidden, true);
  assert.ok(t.mapExportFile('cassandra'), 'die Datei entsteht trotz relativer Karte');
});

test('Ein Perimeter unter drei Punkten sperrt denselben Weg, mit dem Wortlaut der Kartenpruefung', () => {
  const { t, elements } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0}];
  t.refreshExportButtons();
  assert.strictEqual(t.cassandraExportBlockKey(t.state.activeMap), 'checkPerimeterTooFew',
    'derselbe Schluessel, den auch die Kartenpruefung meldet');
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, true);
  assert.strictEqual(elements.get('shareCassandraBtn').disabled, true);
  const hint = elements.get('cassandraMissingHint');
  assert.strictEqual(hint.hidden, false);
  assert.ok(hint.textContent.includes('weniger als 3 Punkte'),
    `der Hinweis uebernimmt den Wortlaut der Kartenpruefung: ${hint.textContent}`);
  assert.strictEqual(t.mapExportFile('cassandra'), null, 'und es entsteht keine Datei');
  // Dieselbe Lage meldet die Kartenpruefung, ohne dass dafuer zweimal gezaehlt wird.
  t.validateActiveMap();
  assert.ok(t.state.validationResult.issues.some((i) => i.key === 'checkPerimeterTooFew'));
  // Behoben: die Sperre faellt.
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  t.refreshExportButtons();
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, false);
  assert.strictEqual(elements.get('cassandraMissingHint').hidden, true);
});

test('Es gibt genau einen Sperrmechanismus, nicht zwei nebeneinander', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // Knopfzustand und Dateierzeugung fragen dieselbe Funktion.
  const refresh = source.slice(source.indexOf('function refreshExportButtons'));
  assert.ok(refresh.slice(0, refresh.indexOf('\n}')).includes('cassandraExportBlockKey('),
    'refreshExportButtons() fragt den gemeinsamen Sperrgrund');
  const exportFile = source.slice(source.indexOf('function mapExportFile'));
  assert.ok(exportFile.slice(0, exportFile.indexOf('\n}')).includes('spec.blockKey('),
    'mapExportFile() fragt denselben Weg');
  // Und die Bedingung „taugt als Flaeche“ ist genau eine Zaehlung.
  assert.strictEqual((source.match(/perimeter\.length\s*<\s*3/g) || []).length, 0,
    'keine zweite, handgeschriebene Zaehlung des Perimeters neben hasUsablePolygon()');
});

// Wo im Code darf ueberhaupt noch von Hand gegen 3 gezaehlt werden?
//
// Abgrenzung: eine Textsuche kann die Absicht nicht lesen — `points.length >= 3` steht im Code
// fuer mehrere verschiedene Fragen. Deshalb ist die Grenze **funktionsweise** gezogen und hier
// ausgeschrieben: jede Funktion, die von Hand zaehlen darf, steht mit Grund und erwarteter
// Anzahl in dieser Liste. Ein Vorkommen in einer nicht gelisteten Funktion schlaegt an, und ein
// zusaetzliches in einer gelisteten ebenfalls — beides erzwingt eine bewusste Entscheidung,
// statt eine zweite Zaehlung durchrutschen zu lassen.
//
// Nicht gelistet und damit verboten sind ausdruecklich die Stellen, die dieselbe Frage stellen
// wie `hasUsablePolygon()` — „taugt diese Kontur als Flaeche, darf sie gemeldet oder exportiert
// werden“: `validateActiveMap()` (zu wenige Punkte), `closePerimeter()`,
// `cassandraExportBlockKey()`, `skippedAreas()` und `mapToCassandraGeoJson()`.
const HANDZAEHLUNG_ERLAUBT = {
  hasUsablePolygon: { anzahl: 1, grund: 'die Definition selbst' },
  // (1) Geometrie-Primitive: sichern ihre eigene Rechnung auf einem lokalen Parameter ab und
  //     kennen weder Karte noch Kontur.
  pointInPolygon: { anzahl: 1, grund: 'Primitiv: unter 3 Ecken gibt es kein Innen' },
  polygonsIntersect: { anzahl: 2, grund: 'Primitiv: zwei Polygone, je eine Zaehlung' },
  polygonArea: { anzahl: 1, grund: 'Primitiv: unter 3 Ecken ist die Flaeche 0' },
  pathLength: { anzahl: 1, grund: 'Primitiv: zaehlt die Schlussstrecke mit' },
  pathSpacingIssues: { anzahl: 1, grund: 'Primitiv: Anzahl der zu pruefenden Strecken' },
  // (2) Zeichnen und Geometrie bauen: entscheiden eine Form, nicht die Tauglichkeit.
  drawThumbnailPath: { anzahl: 1, grund: 'Darstellung: Polygon oder Polylinie' },
  drawPolyline: { anzahl: 1, grund: 'Darstellung: Polygon oder Polylinie' },
  nearestBoundaryPoint: { anzahl: 1, grund: 'Darstellung: Anzahl der Kanten' },
  closeRing: { anzahl: 1, grund: 'Geometrie: ab wann ein Ring geschlossen wird' },
  geometryForArea: { anzahl: 1, grund: 'Geometrie: Polygon, LineString oder Point' },
  // (3) „Ist die Kontur offen?“ — steht immer zusammen mit `closed`/`perimeterClosed` und ist
  //     damit eine andere Frage als „taugt sie als Flaeche“.
  openContours: { anzahl: 2, grund: 'offene Konturen: Perimeter und Flaechen' },
  canStartExtension: { anzahl: 1, grund: 'offene Kontur: erweitern nur bei geschlossener' },
  finishExtension: { anzahl: 1, grund: 'offene Kontur: schliessen nach dem Erweitern' },
  canCloseAndStartNew: { anzahl: 1, grund: 'offene Kontur: schliessen und neu beginnen' },
  // (4) Andere Merkmale derselben Punktliste.
  mapToGeoJson: { anzahl: 2, grund: 'Feld `completePolygon` unseres eigenen Formats' },
  handleMapTap: { anzahl: 1, grund: 'Trefferflaeche: nur echte Flaechen sind antippbar' },
  validateActiveMap: { anzahl: 6, grund: 'offene Konturen (2), Innenlage (2) und Ueberlappung (2)' },
};

test('Es gibt keine zweite handgeschriebene Zaehlung von Flaechen neben hasUsablePolygon()', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const declaration = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;
  const gefunden = new Map();
  const verstoesse = [];
  let aktuell = '(Dateiebene)';
  source.split('\n').forEach((line, index) => {
    const decl = line.match(declaration);
    if (decl) aktuell = decl[1];
    const treffer = line.match(/\.length\s*(?:>=|<)\s*3\b/g);
    if (!treffer) return;
    gefunden.set(aktuell, (gefunden.get(aktuell) || 0) + treffer.length);
    if (!HANDZAEHLUNG_ERLAUBT[aktuell]) {
      verstoesse.push(`app.js:${index + 1} in ${aktuell}() — ${line.trim()}`);
    }
  });

  assert.strictEqual(verstoesse.length, 0,
    `von Hand gegen 3 gezaehlt, wo hasUsablePolygon() zustaendig ist:\n     ${verstoesse.join('\n     ')}`);

  for (const [name, { anzahl, grund }] of Object.entries(HANDZAEHLUNG_ERLAUBT)) {
    assert.strictEqual(gefunden.get(name) || 0, anzahl,
      `${name}() zaehlt ${gefunden.get(name) || 0} mal von Hand, erlaubt sind ${anzahl} (${grund}) — `
      + 'entweder gehoert die neue Stelle nach hasUsablePolygon(), oder die Liste im Test braucht '
      + 'einen begruendeten Eintrag');
  }

  // Die Anzahl allein liesse sich aushebeln, indem jemand eine erlaubte Zaehlung durch eine
  // verbotene ersetzt. Fuer die beiden Meldungen in der Kartenpruefung wird deshalb zusaetzlich
  // die Zeile selbst geprueft.
  for (const key of ['checkPerimeterTooFew', 'checkAreaTooFew']) {
    const zeile = source.split('\n').find((l) => l.includes(`key:'${key}'`) || l.includes(`key: '${key}'`));
    assert.ok(zeile && zeile.includes('hasUsablePolygon('),
      `die Meldung ${key} entsteht aus hasUsablePolygon(), nicht aus einer eigenen Zaehlung`);
  }

  // Die Frage selbst wird an genau den Stellen gestellt, die sie stellen sollen.
  for (const fn of ['validateActiveMap', 'closePerimeter', 'cassandraExportBlockKey',
    'skippedAreas', 'mapToCassandraGeoJson']) {
    const koerper = source.slice(source.indexOf(`function ${fn}(`));
    assert.ok(koerper.slice(0, koerper.indexOf('\n}')).includes('hasUsablePolygon('),
      `${fn}() fragt hasUsablePolygon(), statt selbst zu zaehlen`);
  }
});

test('Ausgelassene Ausschlussflaechen werden beim Export benannt, der Export laeuft weiter', () => {
  const { t, sandbox, elements } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [
    { id:'a', name:'Ausschluss 1', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] },
    { id:'b', name:'Ausschluss 2', points:[{x:4,y:1},{x:4.5,y:1}] },
  ];
  sandbox.__lastConfirmRequest = null;
  const file = captureDownload(sandbox, () => t.exportCurrentMapCassandra());
  const request = sandbox.__lastConfirmRequest;
  assert.ok(request, 'es kommt eine Meldung — stilles Weglassen waere hier nicht zulaessig');
  assert.strictEqual(request.singleButton, true, 'eine Meldung, keine Rueckfrage');
  assert.ok(request.message.includes('Ausschluss 2'), `die Meldung nennt die Flaeche: ${request.message}`);
  assert.ok(request.message.includes('2 Punkte'), 'und wie viele Punkte verloren gehen');
  assert.ok(/\b1\b/.test(request.message), 'und die Anzahl der ausgelassenen Flaechen');
  assert.ok(!request.message.includes('Ausschluss 1'), 'die uebernommene Flaeche wird nicht genannt');
  // Der Export selbst laeuft weiter, und was gemeldet wurde, fehlt wirklich.
  const doc = JSON.parse(file.text);
  assert.strictEqual(doc.features.filter((f) => f.properties.name === 'exclusion').length, 1);
  assert.strictEqual(file.fileName.endsWith('.json'), true);
});

test('Auch ohne ausgelassene Flaechen wird der verwendete Bezugspunkt gemeldet', () => {
  // Seit die Vorgabe 0/0 ist, kann eine Datei ohne jedes Zutun entstehen — dann muss wenigstens
  // im Klartext dastehen, gegen welchen Wert gerechnet wurde.
  const { t, sandbox } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [{ id:'a', name:'Ausschluss 1', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] }];
  sandbox.__lastConfirmRequest = null;
  captureDownload(sandbox, () => t.exportCurrentMapCassandra());
  const request = sandbox.__lastConfirmRequest;
  assert.ok(request, 'es kommt eine Meldung');
  assert.strictEqual(request.singleButton, true, 'eine Meldung, keine Rueckfrage');
  assert.ok(request.message.includes('52.26742967'), `die Breite steht im Klartext: ${request.message}`);
  assert.ok(request.message.includes('8.60921633'), 'die Laenge ebenfalls');
  assert.ok(/CaSSAndRA/.test(request.message), 'und der Hinweis, wo derselbe Wert stehen muss');
  assert.ok(!request.message.includes('Ausschluss'), 'ohne Anlass steht nichts ueber Flaechen darin');
});

test('Die Vorgabe ist 0/0, solange nichts gespeichert ist', () => {
  const { t, elements, sandbox } = setup();
  assert.strictEqual(sandbox.localStorage.getItem(t.CASSANDRA_REFERENCE_KEY), null, 'leerer Speicher');
  t.loadCassandraReference();
  assert.strictEqual(`${t.state.cassandraReference.lat},${t.state.cassandraReference.lon}`, '0,0');
  // Und die Vorgabe wirkt: der Export ist nicht gesperrt.
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.renderCassandraReference();
  assert.strictEqual(elements.get('cassandraLatInput').value, '0');
  assert.strictEqual(elements.get('cassandraLonInput').value, '0');
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, false);
  assert.ok(t.mapExportFile('cassandra'), 'es entsteht eine Datei');
  // Die Vorgabe wird NICHT gespeichert — sonst waere die Vorbelegung aus dem Kartenursprung
  // schon nach dem ersten Zeichnen fuer immer unerreichbar.
  assert.strictEqual(sandbox.localStorage.getItem(t.CASSANDRA_REFERENCE_KEY), null,
    'die blosse Vorgabe legt nichts im Speicher ab');
});

test('Ein gespeicherter Wert gewinnt gegen Vorgabe und Kartenursprung', () => {
  const { t, elements, sandbox } = setup();
  sandbox.localStorage.setItem(t.CASSANDRA_REFERENCE_KEY, JSON.stringify({ lat: 52.26742967, lon: 8.60921633 }));
  // Eine absolut gefuehrte Karte mit eigenem Ursprung darf ihn nicht verdraengen.
  t.state.activeMap.positionMode = 'absolute';
  t.state.activeMap.origin = { lat: 40, lon: 9 };
  t.loadCassandraReference();
  t.renderCassandraReference();
  assert.strictEqual(elements.get('cassandraLatInput').value, '52.26742967');
  assert.strictEqual(elements.get('cassandraLonInput').value, '8.60921633');
  assert.strictEqual(t.cassandraReferenceInUse().lon, 8.60921633);
});

test('Ohne Gespeichertes gewinnt der Kartenursprung gegen die 0/0-Vorgabe', () => {
  // Die alte Vorbelegung bleibt erreichbar — aber nur, solange nichts gespeichert ist.
  const { t, elements } = setup();
  t.state.activeMap.positionMode = 'absolute';
  t.state.activeMap.origin = { lat: 40.5, lon: 9.25 };
  t.loadCassandraReference();
  t.renderCassandraReference();
  assert.strictEqual(elements.get('cassandraLatInput').value, '40.5');
  assert.strictEqual(elements.get('cassandraLonInput').value, '9.25');
  // Relativ gefuehrte Karte: kein brauchbarer Ursprung, also die Vorgabe.
  t.state.activeMap.positionMode = 'relative';
  t.state.activeMap.origin = null;
  t.renderCassandraReference();
  assert.strictEqual(elements.get('cassandraLatInput').value, '0');
  assert.strictEqual(elements.get('cassandraLonInput').value, '0');
});

test('Ein geleertes Feld sperrt weiterhin, auch ueber das naechste Zeichnen hinweg', () => {
  const { t, elements, sandbox } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  // Eine absolut gefuehrte Karte, damit die Vorbelegung ueberhaupt etwas anzubieten haette.
  t.state.activeMap.positionMode = 'absolute';
  t.state.activeMap.origin = { lat: 40, lon: 9 };
  elements.get('cassandraLatInput').value = '';
  elements.get('cassandraLonInput').value = '';
  t.updateCassandraReferenceFromUi();
  assert.strictEqual(t.cassandraReferenceInUse(), null);
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, true);
  assert.strictEqual(t.mapExportFile('cassandra'), null, 'kein Export aus einem leeren Feld');
  // Entscheidend: das naechste Zeichnen darf die Vorgabe NICHT wieder einsetzen.
  t.renderCassandraReference();
  assert.strictEqual(t.cassandraReferenceInUse(), null, 'geleert bleibt geleert');
  assert.strictEqual(elements.get('cassandraLatInput').value, '');
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, true);
  assert.strictEqual(t.mapExportFile('cassandra'), null);
  // Auch ein Neustart aendert daran nichts.
  assert.strictEqual(sandbox.localStorage.getItem(t.CASSANDRA_REFERENCE_KEY), 'null',
    'der Speicher unterscheidet „geleert“ von „nie festgelegt“');
  t.loadCassandraReference();
  assert.strictEqual(t.cassandraReferenceInUse(), null);
  // Und die Meldung erscheint dann auch nicht, weil gar nichts exportiert wird.
  sandbox.__lastConfirmRequest = null;
  t.exportCurrentMapCassandra();
  assert.strictEqual(sandbox.__lastConfirmRequest, null);
});

test('Bei gesperrtem Export kommt weder Datei noch Meldung ueber ausgelassene Flaechen', () => {
  const { t, sandbox } = setup();
  t.state.cassandraReference = null;
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [{ id:'b', name:'Ausschluss 1', points:[{x:4,y:1},{x:4.5,y:1}] }];
  sandbox.__lastConfirmRequest = null;
  const before = sandbox.document.body.children.length;
  t.exportCurrentMapCassandra();
  assert.strictEqual(sandbox.document.body.children.length, before, 'kein Download-Anker');
  assert.strictEqual(sandbox.__lastConfirmRequest, null,
    'und keine Meldung ueber Flaechen, die ohnehin nicht exportiert wurden');
});

test('Der Bezugspunkt wird gemerkt und ist nicht der Kartenursprung', () => {
  const { t, elements, sandbox } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  t.state.cassandraReference = null;
  elements.get('cassandraLatInput').value = '52.26742967';
  elements.get('cassandraLonInput').value = '8.60921633';
  t.updateCassandraReferenceFromUi();
  assert.strictEqual(t.cassandraReferenceInUse().lat, 52.26742967);
  assert.strictEqual(t.state.activeMap.origin, null, 'die Karte bleibt unangetastet');
  assert.strictEqual(t.state.activeMap.positionMode, 'relative');
  // Ueberdauert einen Neustart, und der Schluessel traegt ein eigenes Praefix: alle
  // GitHub-Pages-Projekte teilen sich einen Origin und damit einen localStorage.
  const stored = sandbox.localStorage.getItem('mapcreator-ardumower-cassandra-reference-v1');
  assert.strictEqual(JSON.parse(stored).lon, 8.60921633);
  // Unsinn wird abgelehnt, statt eine versetzte Karte zu erzeugen.
  elements.get('cassandraLatInput').value = '95';
  t.updateCassandraReferenceFromUi();
  assert.strictEqual(t.cassandraReferenceInUse(), null);
  assert.strictEqual(elements.get('exportCassandraBtn').disabled, true);
});

test('Ausgelassene Flaechen stehen schon vor dem Export neben den Knoepfen', () => {
  const { t, elements } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [{ id:'a', name:'Ausschluss 1', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] }];
  t.refreshExportButtons();
  const hint = elements.get('cassandraSkippedHint');
  assert.strictEqual(hint.hidden, true, 'ohne Anlass steht da nichts');

  t.state.activeMap.exclusions.push({ id:'b', name:'Ausschluss 2', points:[{x:4,y:1},{x:4.5,y:1}] });
  t.refreshExportButtons();
  assert.strictEqual(hint.hidden, false, 'die Auslassung ist sichtbar, bevor die Datei entsteht');
  assert.ok(hint.textContent.includes('Ausschluss 2'), `der Hinweis nennt die Flaeche: ${hint.textContent}`);
  assert.ok(hint.textContent.includes('2 Punkte'), 'und wie viele Punkte betroffen sind');
  assert.ok(!hint.textContent.includes('Ausschluss 1'), 'die uebernommene Flaeche steht nicht darin');

  // Behoben: der Hinweis verschwindet.
  t.state.activeMap.exclusions[1].points.push({x:4.5,y:1.5});
  t.refreshExportButtons();
  assert.strictEqual(hint.hidden, true);
  assert.strictEqual(hint.textContent, '');
});

test('Der Hinweis vor dem Export und die Meldung danach sagen dasselbe', () => {
  const { t, elements, sandbox } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [
    { id:'a', name:'Ausschluss 1', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] },
    { id:'b', name:'Ausschluss 2', points:[{x:4,y:1},{x:4.5,y:1}] },
  ];
  t.refreshExportButtons();
  const vorher = elements.get('cassandraSkippedHint').textContent;
  sandbox.__lastConfirmRequest = null;
  captureDownload(sandbox, () => t.exportCurrentMapCassandra());
  const nachher = sandbox.__lastConfirmRequest.message;
  // Beide speisen sich aus skippedAreas(), also muss dieselbe Aufstellung darin stehen.
  for (const teil of t.skippedAreas(t.state.activeMap)) {
    assert.ok(vorher.includes(teil), `der Hinweis vorher nennt ${teil}`);
    assert.ok(nachher.includes(teil), `die Meldung nachher nennt ${teil}`);
  }
});

test('Beim Oeffnen der Menueseite werden die Export-Knoepfe nachgefuehrt', () => {
  // Dort stehen sie, und die Geometrie kann sich seit dem letzten renderMapControls() geaendert
  // haben — sonst zeigte die Seite einen Zustand von vor der letzten Bearbeitung.
  const { t, elements } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  t.state.activeMap.exclusions = [{ id:'b', name:'Ausschluss 1', points:[{x:4,y:1},{x:4.5,y:1}] }];
  elements.get('cassandraSkippedHint').hidden = true;
  elements.get('cassandraSkippedHint').textContent = '';
  t.setMenuOpen(true);
  assert.strictEqual(elements.get('cassandraSkippedHint').hidden, false,
    'der Hinweis steht da, sobald die Seite aufgeht');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const menu = source.slice(source.indexOf('function setMenuOpen'));
  assert.ok(menu.slice(0, menu.indexOf('\n}')).includes('refreshExportButtons();'));
});

test('Die CaSSAndRA-Knoepfe stehen mit dem Bezugspunkt in einer Gruppe', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // T3: der Bezugspunkt gehoert sichtbar zum CaSSAndRA-Knopf, weil nur dieses Format ihn braucht.
  // Geprueft wird die Wirkung: Knoepfe und Eingabefelder liegen in derselben Gruppe.
  const start = markup.indexOf('id="cassandraGroup"');
  assert.ok(start > 0, 'die CaSSAndRA-Gruppe fehlt im Markup');
  // Die Gruppe wird ueber die div-Verschachtelung abgegrenzt, nicht ueber den naechsten
  // Textschnipsel: ein zusaetzlich eingefuegtes </div> wuerde die Felder sonst aus der Gruppe
  // herausnehmen, ohne dass der Test es merkt (genau so ist er einmal durchgerutscht).
  const block = (() => {
    const rest = markup.slice(markup.lastIndexOf('<div', start));
    let tiefe = 0;
    const tags = [...rest.matchAll(/<(\/?)div\b/g)];
    for (const m of tags) {
      tiefe += m[1] ? -1 : 1;
      if (tiefe === 0) return rest.slice(0, m.index);
    }
    throw new Error('cassandraGroup ist im Markup nicht geschlossen');
  })();
  for (const id of ['exportCassandraBtn', 'shareCassandraBtn', 'cassandraLatInput', 'cassandraLonInput']) {
    assert.ok(block.includes(`id="${id}"`), `${id} steht nicht in der CaSSAndRA-Gruppe`);
  }
  // Die Felder bleiben sichtbar: sie duerfen an keiner Stelle `hidden` tragen, der Bezugspunkt
  // gehoert zur Installation und nicht zum Positionsmodus einer Karte.
  for (const id of ['cassandraLatInput', 'cassandraLonInput']) {
    const tag = block.slice(block.indexOf(`id="${id}"`) - 160, block.indexOf(`id="${id}"`));
    assert.ok(!/\bhidden\b/.test(tag), `${id} darf nicht ausgeblendet starten`);
  }
  // Die reinen Sicherungsformate gehoeren NICHT in diese Gruppe.
  for (const id of ['exportJsonBtn', 'exportGeoJsonBtn', 'exportSunrayBtn']) {
    assert.ok(!block.includes(`id="${id}"`), `${id} gehoert nicht in die CaSSAndRA-Gruppe`);
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(source.includes("ui.exportCassandraBtn.addEventListener('click', exportCurrentMapCassandra)"));
  assert.ok(source.includes("shareCurrentMap('cassandra')"));
  // Der Hinweistext sagt, welcher Wert gemeint ist — und ausdruecklich, dass es keine
  // Ortsbestimmung ist.
  for (const lang of ['de', 'en']) {
    const hint = lang === 'de'
      ? source.slice(source.indexOf("cassandraRefHint: '"), source.indexOf("cassandraRefHint: '") + 400)
      : source.slice(source.lastIndexOf("cassandraRefHint: '"), source.lastIndexOf("cassandraRefHint: '") + 400);
    assert.ok(/Robotereinstellungen|robot settings/.test(hint),
      `der Hinweis (${lang}) verweist auf die Robotereinstellungen in CaSSAndRA`);
  }
});


test('CaSSAndRA-Datei: Import meldet Format und Bezugspunkt im Klartext, ohne Dialog', async () => {
  const { t, elements, sandbox } = setup();
  t.state.cassandraReference = { lat: 0, lon: 0 };
  const notice = elements.get('importNotice');
  // Im Browser sorgt das `hidden` im Markup fuer den Startzustand, im Stub diese Funktion.
  t.clearImportNotice();
  assert.strictEqual(notice.hidden, true, 'vor dem Import steht da nichts');
  assert.strictEqual(notice.textContent, '');

  // 20 x 10 m, geschlossener Ring, in Grad bei lat0/lon0 = 0 — die Form, die CaSSAndRA schreibt.
  const g = (x, y) => [x / 111111, y / 111111];
  const datei = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'perimeter' },
      geometry: { type: 'Polygon', coordinates: [[g(0,0), g(20,0), g(20,10), g(0,10), g(0,0)]] } },
    { type: 'Feature', properties: { name: 'dockpoints' }, geometry: { type: 'LineString', coordinates: [] } },
    { type: 'Feature', properties: { name: 'search wire' }, geometry: { type: 'LineString', coordinates: [] } },
  ] };
  assert.strictEqual(t.isCassandraGeoJson(datei), true);

  // „Kein Dialog“ wird ueber den Dialog-Haken geprueft, nicht ueber ein hidden-Attribut: der
  // Element-Stub kennt den Startzustand aus dem Markup nicht.
  sandbox.__lastConfirmRequest = null;
  const vorher = t.state.maps.length;
  await t.importMapFile({ text: async () => JSON.stringify(datei) });

  assert.strictEqual(t.state.maps.length, vorher + 1, 'die Karte ist entstanden');
  const karte = t.state.activeMap;
  // Wirkung, nicht Absicht: die Ausdehnung in Metern.
  const breite = Math.max(...karte.perimeter.map((p) => p.x)) - Math.min(...karte.perimeter.map((p) => p.x));
  const hoehe = Math.max(...karte.perimeter.map((p) => p.y)) - Math.min(...karte.perimeter.map((p) => p.y));
  assert.ok(Math.abs(breite - 20) < 0.01 && Math.abs(hoehe - 10) < 0.01,
    `erwartet 20 x 10 m, gemessen ${breite.toFixed(3)} x ${hoehe.toFixed(3)} m`);
  assert.strictEqual(karte.perimeterClosed, true, 'der geschlossene Ring kommt als geschlossen an');

  // Die Meldung steht als Hinweiszeile da — nicht als Dialog.
  assert.strictEqual(notice.hidden, false, 'die Meldung ist sichtbar');
  assert.ok(notice.textContent.includes('CaSSAndRA'), `Format genannt: ${notice.textContent}`);
  assert.ok(/Breite 0/.test(notice.textContent) && /L\u00e4nge 0/.test(notice.textContent),
    `Bezugspunkt im Klartext: ${notice.textContent}`);
  assert.strictEqual(sandbox.__lastConfirmRequest, null, 'kein Dialog, nur die Hinweiszeile');
});

test('CaSSAndRA-Datei ohne gueltigen Bezugspunkt: keine Karte, Meldung nennt den naechsten Schritt', async () => {
  const { t, elements } = setup();
  t.state.cassandraReference = null;          // Feld ausdruecklich geleert
  t.clearImportNotice();
  const g = (x, y) => [x / 111111, y / 111111];
  const datei = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'perimeter' },
      geometry: { type: 'Polygon', coordinates: [[g(0,0), g(20,0), g(20,10), g(0,0)]] } },
  ] };
  const vorher = t.state.maps.length;
  let fehler = null;
  await t.importMapFile({ text: async () => JSON.stringify(datei) }).catch((e) => { fehler = e; });

  assert.ok(fehler, 'der Import muss abbrechen');
  assert.strictEqual(t.state.maps.length, vorher, 'es darf keine Karte entstehen');
  assert.ok(/Bezugspunkt/.test(fehler.message), `die Meldung nennt den Grund: ${fehler.message}`);
  assert.ok(/erneut/.test(fehler.message), 'und den naechsten Schritt');
  assert.strictEqual(elements.get('importNotice').hidden, true, 'keine Erfolgsmeldung');
});

test('Eigenes GeoJSON und eigener CaSSAndRA-Export gehen unveraendert durch den Import', async () => {
  const { t, elements } = setup();
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  const m = t.makeMap('Eigen');
  t.clearImportNotice();
  m.perimeter = [{x:0,y:0},{x:12,y:0},{x:12,y:9}];
  m.perimeterClosed = true;

  // Unser eigenes GeoJSON traegt `properties.role` und bleibt in lokalen Metern.
  const eigen = t.mapToGeoJson(m);
  assert.strictEqual(t.isCassandraGeoJson(eigen), false);
  await t.importMapFile({ text: async () => JSON.stringify(eigen) });
  const zurueck = t.state.activeMap;
  assert.strictEqual(zurueck.perimeter.length, 3);
  assert.strictEqual(zurueck.perimeter[1].x, 12, 'die Meter bleiben Meter');
  assert.strictEqual(elements.get('importNotice').hidden, true,
    'fuer eigene Dateien erscheint keine CaSSAndRA-Meldung');

  // Unser eigener CaSSAndRA-Export traegt das mapmaker-Feature mit eigenem Ursprung.
  const eigenCass = t.mapToCassandraGeoJson(m, { lat: 52.26742967, lon: 8.60921633 });
  assert.strictEqual(t.isCassandraGeoJson(eigenCass), false,
    'der eigene Export darf nicht als Fremdformat gelten');
  await t.importMapFile({ text: async () => JSON.stringify(eigenCass) });
  const zurueck2 = t.state.activeMap;
  const b = Math.max(...zurueck2.perimeter.map((p) => p.x)) - Math.min(...zurueck2.perimeter.map((p) => p.x));
  assert.ok(Math.abs(b - 12) < 0.02, `eigener Rundlauf: erwartet 12 m, gemessen ${b.toFixed(3)} m`);
  assert.strictEqual(zurueck2.perimeterClosed, true, 'der Ringschluss ueberlebt den eigenen Rundlauf');
});


test('Exportknoepfe stehen in der Reihenfolge Sunray, CaSSAndRA, JSON, GeoJSON', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const reihenfolge = ['exportSunrayBtn', 'exportCassandraBtn', 'exportJsonBtn', 'exportGeoJsonBtn']
    .map((id) => ({ id, pos: markup.indexOf(`id="${id}"`) }));
  for (const r of reihenfolge) assert.ok(r.pos > 0, `${r.id} fehlt im Markup`);
  for (let i = 1; i < reihenfolge.length; i += 1) {
    assert.ok(reihenfolge[i].pos > reihenfolge[i - 1].pos,
      `${reihenfolge[i].id} steht vor ${reihenfolge[i - 1].id}`);
  }
  // Die Beschreibung sagt je Format, wofuer es da ist — und ausdruecklich, wofuer nicht.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  for (const [lang, treffer] of [
    ['de', [/Sunray-App/, /CaSSAndRA/, /Sicherung/, /Fremdwerkzeuge/, /NICHT für den Import in CaSSAndRA/]],
    ['en', [/Sunray app/, /CaSSAndRA/, /backup/, /third-party/, /NOT meant for importing into CaSSAndRA/]],
  ]) {
    const i = lang === 'de' ? src.indexOf("exportHint: '") : src.lastIndexOf("exportHint: '");
    const text = src.slice(i, src.indexOf("',", i));
    for (const t2 of treffer) assert.ok(t2.test(text), `exportHint (${lang}) sagt nichts zu ${t2}`);
  }
});

test('Der Sunray-Export haengt nicht am Bezugspunkt und meldet ohne Dialog-Zwang', () => {
  const { t } = setup();
  t.state.cassandraReference = null;              // Feld geleert -> CaSSAndRA gesperrt
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}].map((p) => ({ ...p, gps: {} }));
  t.refreshExportButtons();
  assert.strictEqual(t.elementsDisabled === undefined, true);

  const datei = t.mapExportFile('sunray');
  assert.ok(datei, 'der Sunray-Export bleibt moeglich');
  assert.strictEqual(t.mapExportFile('cassandra'), null, 'CaSSAndRA ist im selben Zustand gesperrt');
  const dok = JSON.parse(datei.text);
  assert.ok(Array.isArray(dok) && dok.length === 1, 'Liste von Karten');
  assert.strictEqual(dok[0].perimeter.length, 3);
  for (const pkt of dok[0].perimeter) {
    assert.ok('delta' in pkt && 'timestamp' in pkt, 'delta und timestamp sind Pflicht');
  }
});

test('Die Sunray-Meldung nennt die Einheit und die ausgelassenen Flaechen', () => {
  const { t, sandbox } = setup();
  t.state.activeMap.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}].map((p) => ({ ...p, gps: {} }));
  t.state.activeMap.exclusions = [
    { id:'a', name:'Gut', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}].map((p)=>({...p,gps:{}})) },
    { id:'b', name:'Zu kurz', points:[{x:4,y:1},{x:5,y:1}].map((p)=>({...p,gps:{}})) },
  ];
  sandbox.__lastConfirmRequest = null;
  t.noticeSunrayExport(t.state.activeMap);
  const text = String(sandbox.__lastConfirm || '');
  assert.ok(/Meter|metres/.test(text), `die Meldung nennt die Einheit: ${text}`);
  // Sie darf keinen konkreten Bezugspunkt-Wert nennen wie die CaSSAndRA-Meldung: dieses Format
  // rechnet nicht um. Dass keiner gebraucht wird, darf und soll dagegen dastehen.
  assert.ok(!/Breite \d|L\u00e4nge \d|latitude \d|longitude \d/.test(text),
    `sie nennt einen Bezugspunkt-Wert, obwohl das Format keinen benutzt: ${text}`);
  assert.ok(/nicht gebraucht|No reference point is needed/.test(text),
    'sie sagt ausdruecklich, dass keiner noetig ist');
  assert.ok(text.includes('Zu kurz'), 'und die ausgelassene Flaeche');
  // Dieselbe Aufstellung wie beim CaSSAndRA-Export.
  for (const teil of t.skippedAreas(t.state.activeMap)) {
    assert.ok(text.includes(teil), `die Aufstellung fehlt in der Meldung: ${teil}`);
  }
});

test('Der Verbindungshinweis steht dauerhaft und bleibt eine Beobachtung', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tag = markup.match(/<small[^>]*id="httpConflictHint"[^>]*>/);
  assert.ok(tag, '#httpConflictHint fehlt im Markup');
  assert.ok(!/\bhidden\b/.test(tag[0]), 'der Hinweis ist dauerhaft sichtbar, nicht ausgeblendet');
  assert.ok(/connect-warning/.test(tag[0]), 'er ist als Warnung hervorgehoben');
  const pos = markup.indexOf('id="httpConflictHint"');
  const connect = markup.indexOf('id="connectBtn"');
  assert.ok(pos < connect && connect - pos < 800, 'er steht beim Verbinden-Knopf');

  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // Kein Dialog bei jedem Verbindungsversuch.
  assert.ok(!/httpConflictHint[\s\S]{0,200}showNotice/.test(src),
    'der Hinweis darf nicht als Dialog erscheinen');
  // Wortlaut: als Beobachtung, nicht als erwiesene Ursache. In beiden Sprachen.
  for (const [lang, muster] of [
    ['de', [/Beobachtung/, /keine gesicherte Ursache/, /kein kontrollierter Vergleich/]],
    ['en', [/observation/, /not an established cause/, /not a controlled comparison/]],
  ]) {
    const i = lang === 'de' ? src.indexOf("httpConflictHint: '") : src.lastIndexOf("httpConflictHint: '");
    const text = src.slice(i, src.indexOf("',", i));
    for (const m of muster) assert.ok(m.test(text), `Wortlaut (${lang}) fehlt: ${m}`);
    assert.ok(!/verursacht|liegt daran|is caused by|because of/.test(text),
      `Wortlaut (${lang}) stellt es als erwiesen dar`);
  }
});


test('Sunray-Datei mit einer Karte: keine Auswahl, Meldung nennt Verworfenes', async () => {
  const { t, elements, sandbox } = setup();
  t.clearImportNotice();
  const datei = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'sunray-app-map.json'), 'utf8'));
  sandbox.__lastChoiceRequest = null;
  const vorher = t.state.maps.length;
  await t.importMapFile({ text: async () => JSON.stringify(datei) });

  assert.strictEqual(sandbox.__lastChoiceRequest, null,
    'bei genau einer Karte wird nicht gefragt');
  assert.strictEqual(t.state.maps.length, vorher + 1, 'die Karte ist entstanden');
  const karte = t.state.activeMap;
  assert.strictEqual(karte.perimeter.length, datei[0].perimeter.length);
  assert.strictEqual(karte.perimeterClosed, true, 'der Perimeter gilt als geschlossen');
  assert.ok(karte.exclusions.every((e) => e.closed === true));
  assert.strictEqual(karte.waypoints.length, 0, 'Wegpunkte werden verworfen');

  const notice = elements.get('importNotice');
  assert.strictEqual(notice.hidden, false, 'die Meldung ist sichtbar');
  assert.ok(/\b5\b/.test(notice.textContent),
    `die Zahl der verworfenen Wegpunkte steht im Klartext: ${notice.textContent}`);
  assert.ok(/Mähpfad|mowing path/.test(notice.textContent), 'mit Begruendung');
  // Auch die verworfenen Maehfelder werden genannt, nicht stillschweigend geschluckt.
  assert.ok(/Mäheinstellungen|mowing settings/.test(notice.textContent),
    `die uebergangenen Felder fehlen in der Meldung: ${notice.textContent}`);
});

test('Sunray-Datei mit mehreren Karten: der Nutzer waehlt, nie still die erste', async () => {
  const { t, sandbox } = setup();
  t.clearImportNotice();
  const datei = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'sunray-app-multi.json'), 'utf8'));
  assert.ok(datei.length >= 3, 'das Pruefmuster fuehrt mehrere Karten');

  // Die dritte waehlen — sie hat 120 Wegpunkte und keine Ausschlussflaechen.
  sandbox.__choiceAnswer = '2';
  sandbox.__lastChoiceRequest = null;
  await t.importMapFile({ text: async () => JSON.stringify(datei) });

  const anfrage = sandbox.__lastChoiceRequest;
  assert.ok(anfrage, 'es wird gefragt');
  assert.strictEqual(anfrage.options.length, datei.length, 'jede Karte steht zur Wahl');
  assert.ok(/3/.test(String(anfrage.message)), 'die Anzahl steht in der Frage');
  // Genommen wurde die gewaehlte, nicht die erste.
  assert.strictEqual(t.state.activeMap.exclusions.length, 0,
    'es wurde die dritte Karte uebernommen, nicht die erste');
  assert.ok(t.state.activeMap.name.includes('Hinterer Garten'),
    `Name der gewaehlten Karte: ${t.state.activeMap.name}`);

  // Namenlose Karte: kein leerer Eintrag, Position immer vorn, alle unterscheidbar.
  const labels = anfrage.options.map((o) => o.label);
  assert.strictEqual(new Set(labels).size, labels.length, 'alle Eintraege sind unterscheidbar');
  for (const [i, label] of labels.entries()) {
    assert.ok(label.trim().length > 3, `Eintrag ${i} ist leer: ${JSON.stringify(label)}`);
    assert.ok(label.startsWith(`${i + 1}.`), `Position fehlt vorn: ${label}`);
  }
  sandbox.__choiceAnswer = undefined;
});

test('Abbruch in der Auswahl importiert nichts', async () => {
  const { t, elements, sandbox } = setup();
  t.clearImportNotice();
  const datei = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'sunray-app-multi.json'), 'utf8'));
  sandbox.__choiceAnswer = null;                 // Abbruch
  const vorher = t.state.maps.length;
  const vorherAktiv = t.state.activeMap;
  await t.importMapFile({ text: async () => JSON.stringify(datei) });

  assert.strictEqual(t.state.maps.length, vorher, 'es entsteht keine Karte');
  assert.strictEqual(t.state.activeMap, vorherAktiv, 'die aktive Karte wechselt nicht');
  assert.strictEqual(elements.get('importNotice').hidden, true, 'und keine Erfolgsmeldung');
  sandbox.__choiceAnswer = undefined;
});

test('Die Auswahl laeuft ueber denselben Dialog wie Rueckfrage und Texteingabe', async () => {
  const { t, elements, sandbox } = setup();
  // Ohne Adapter den echten Dialogpfad fahren, wie bei askConfirm/askText.
  delete sandbox.__choiceAdapter;
  const select = elements.get('confirmDialogSelect');
  const antwort = t.askChoice({
    title: 'Titel', message: 'Text',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    confirmLabel: 'Nimm',
  });
  assert.strictEqual(elements.get('confirmDialog').hidden, false, 'derselbe Dialog oeffnet');
  assert.strictEqual(select.hidden, false, 'die Liste ist sichtbar');
  assert.strictEqual(select.children.length, 2, 'beide Eintraege stehen darin');
  assert.strictEqual(elements.get('confirmDialogInput').hidden !== false, true,
    'das Textfeld bleibt aus');
  assert.strictEqual(elements.get('confirmDialogAccept').textContent, 'Nimm');

  select.value = 'b';
  t.confirmDialogRespond(true);
  assert.strictEqual(await antwort, 'b', 'die Antwort ist der gewaehlte Wert');
  assert.strictEqual(select.hidden, true, 'die Liste wird wieder ausgeblendet');

  // Abbruch liefert null, nicht den vorbelegten Wert.
  const zweite = t.askChoice({ title: 'T', message: 'M', options: [{ value: 'x', label: 'X' }] });
  t.confirmDialogRespond(false);
  assert.strictEqual(await zweite, null, 'Abbruch liefert null');

  // Der Textmodus funktioniert danach unveraendert weiter.
  const dritte = t.askText({ title: 'T', message: 'M', value: 'alt', confirmLabel: 'OK' });
  assert.strictEqual(elements.get('confirmDialogSelect').hidden, true,
    'im Textmodus bleibt die Liste aus');
  elements.get('confirmDialogInput').value = 'neu';
  t.confirmDialogRespond(true);
  assert.strictEqual(await dritte, 'neu');
});

test('Unsere eigenen Formate gelten nicht als Sunray-Datei und werden unveraendert gelesen', async () => {
  const { t, elements } = setup();
  t.state.cassandraReference = { lat: 0, lon: 0 };
  const m = t.makeMap('Eigen');
  m.perimeter = [{x:0,y:0},{x:12,y:0},{x:12,y:9}];
  m.perimeterClosed = true;

  for (const [name, doc] of [
    ['JSON-Backup', JSON.parse(JSON.stringify(m))],
    ['GeoJSON', t.mapToGeoJson(m)],
    ['CaSSAndRA-Export', t.mapToCassandraGeoJson(m, { lat: 0, lon: 0 })],
  ]) {
    assert.strictEqual(t.isSunrayAppFile(doc), false, `${name} darf nicht als Sunray-Datei gelten`);
  }

  t.clearImportNotice();
  await t.importMapFile({ text: async () => JSON.stringify(t.mapToGeoJson(m)) });
  const zurueck = t.state.activeMap;
  assert.strictEqual(zurueck.perimeter.length, 3);
  assert.strictEqual(zurueck.perimeter[1].x, 12, 'die Meter bleiben Meter');
  const notice = elements.get('importNotice');
  assert.ok(notice.hidden === true || !/Mähpfad|mowing path/.test(notice.textContent),
    'fuer eigene Dateien erscheint keine Sunray-Meldung');
});

// --- Kartengrenze MAX_MAPS -------------------------------------------------
// Gemessen wird die Wirkung: greift die Grenze bei 25 und nicht bei 10 oder 26, und steht die
// Zahl in den Texten beider Sprachen. Dazu ein Waechter gegen eine zweite handgeschriebene
// Zaehlung — dieselbe Ueberlegung wie beim Test gegen Handzaehlungen neben hasUsablePolygon().

/** Fuellt den Bestand auf `n` Karten auf, ohne die Grenze zu befragen. */
function fuelleKarten(t, n) {
  t.state.maps = Array.from({ length: n }, (_, i) => t.normalizeMap(t.makeMap(`Karte ${i + 1}`)));
  t.state.activeMap = t.state.maps[0];
}

test('Die Kartengrenze greift bei 25, nicht bei 10 und nicht erst bei 26', async () => {
  const { t } = setup();
  // Gemessen wird ausschliesslich die Wirkung: wo das Anlegen noch geht und wo es aufhoert.
  // Die Konstante selbst wird hier bewusst nicht befragt — das waere die Absicht, nicht die
  // Wirkung, und der Waechtertest unten prueft ihren Wert ohnehin an der Quelle.

  // Bei 10 Karten — der frueheren Grenze — muss das Anlegen weiterhin gehen.
  fuelleKarten(t, 10);
  t.ui.newMapName.value = 'Elfte';
  await t.createMapFromInput();
  assert.strictEqual(t.state.maps.length, 11, 'bei 10 Karten wird nicht mehr gesperrt');

  // Die letzte freie Stelle: 24 → 25 muss noch durchgehen.
  fuelleKarten(t, 24);
  t.ui.newMapName.value = 'Fuenfundzwanzigste';
  await t.createMapFromInput();
  assert.strictEqual(t.state.maps.length, 25, 'die 25. Karte entsteht noch');

  // Und bei 25 ist Schluss — nicht erst bei 26.
  t.ui.newMapName.value = 'Sechsundzwanzigste';
  await assert.rejects(() => t.createMapFromInput(), /25/,
    'die 26. Karte wird abgelehnt, und die Meldung nennt die Grenze');
  assert.strictEqual(t.state.maps.length, 25, 'der Bestand waechst dabei nicht');
});

test('Die Grenze sperrt auch Import und Duplizieren, und die Oberflaeche sagt es', async () => {
  const { t, elements } = setup();
  fuelleKarten(t, 25);

  // Import: scheitert, bevor irgendetwas eingelesen wird.
  await assert.rejects(() => t.importMapFile({ text: async () => '{}' }), /25/,
    'am Limit wird gar nicht erst eingelesen');

  // Duplizieren: Meldung statt Ausnahme, Bestand unveraendert.
  await t.duplicateMapById(t.state.maps[0].id);
  assert.strictEqual(t.state.maps.length, 25, 'Duplizieren legt am Limit nichts an');

  // Knopfzustaende und das Zaehlfeld.
  t.renderMapControls();
  assert.strictEqual(t.ui.newMapBtn.disabled, true, 'der Knopf fuer neue Karten ist gesperrt');
  assert.strictEqual(t.ui.importInput.disabled, true, 'der Import ist gesperrt');
  assert.strictEqual(elements.get('mapCountBadge').textContent, '25 / 25',
    'das Zaehlfeld nennt die Grenze aus der Konstante');
});

test('Meldung und Hilfetext nennen die Grenze in beiden Sprachen, ohne Platzhalterrest', () => {
  const { t } = setup();
  for (const sprache of ['de', 'en']) {
    t.state.language = sprache;
    for (const key of ['mapLimitReached', 'offlineWorks4']) {
      const text = t.tr(key);
      assert.ok(text.includes(String(t.MAX_MAPS)),
        `${sprache}/${key} nennt die Grenze: ${text}`);
      assert.ok(!text.includes('{maxMaps}'),
        `${sprache}/${key} laesst keinen Platzhalter stehen: ${text}`);
      assert.ok(!/\b10\b/.test(text),
        `${sprache}/${key} traegt keine feste 10 mehr: ${text}`);
    }
  }
});

test('Es gibt keine zweite handgeschriebene Zaehlung der Kartengrenze', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // (1) Die Konstante steht genau einmal.
  const deklarationen = quelle.match(/^\s*const\s+MAX_MAPS\s*=/gm) || [];
  assert.strictEqual(deklarationen.length, 1, 'MAX_MAPS wird genau einmal deklariert');
  assert.ok(/const MAX_MAPS = 25;/.test(quelle), 'und traegt den Wert 25');

  // (2) Der Bestand wird nirgends gegen eine Zahl verglichen, immer gegen die Konstante.
  const verstoesse = [];
  quelle.split('\n').forEach((zeile, i) => {
    if (/(?:maps|state\.maps)\.length\s*(?:>=|<=|>|<|===|!==|==)\s*\d/.test(zeile)) {
      verstoesse.push(`app.js:${i + 1} — ${zeile.trim()}`);
    }
  });
  assert.strictEqual(verstoesse.length, 0,
    `der Kartenbestand wird von Hand gegen eine Zahl geprueft statt gegen MAX_MAPS:\n     ${verstoesse.join('\n     ')}`);

  // (2b) Das Zaehlfeld nennt die Grenze — die muss aus der Konstante kommen. Eine reine
  //      Wirkungspruefung faengt das nicht: `25 / 25` sieht von aussen richtig aus, egal woher
  //      die zweite 25 stammt.
  const badgeZeile = quelle.split('\n').find((l) => l.includes('mapCountBadge.textContent'));
  assert.ok(badgeZeile, 'das Zaehlfeld wird gesetzt');
  assert.ok(badgeZeile.includes('MAX_MAPS'),
    `das Zaehlfeld zieht die Konstante heran statt einer eigenen Zahl: ${badgeZeile.trim()}`);

  // (3) Die Texte ziehen den Platzhalter heran statt einer ausgeschriebenen Zahl. Der
  //     Markup-Fallback gehoert dazu: er ist die deutsche Fassung, die ohne applyLanguage()
  //     dastuende, und veraltete sonst bei der naechsten Aenderung still.
  for (const key of ['mapLimitReached', 'offlineWorks4']) {
    const treffer = quelle.match(new RegExp(`${key}: '([^']*)'`, 'g')) || [];
    assert.strictEqual(treffer.length, 2, `${key} steht in beiden Sprachen`);
    treffer.forEach((zeile) => {
      assert.ok(zeile.includes('{maxMaps}'), `${key} nutzt den Platzhalter: ${zeile}`);
      assert.ok(!/\d/.test(zeile.split("'")[1]), `${key} traegt keine ausgeschriebene Zahl: ${zeile}`);
    });
  }
  const fallback = markup.split('\n').find((l) => l.includes('data-i18n="offlineWorks4"'));
  assert.ok(fallback && fallback.includes('{maxMaps}'),
    `der Markup-Fallback nutzt den Platzhalter: ${fallback}`);
  const zaehlfeld = markup.split('\n').find((l) => l.includes('id="mapCountBadge"'));
  assert.ok(zaehlfeld && !/\d/.test(zaehlfeld.replace(/i18n|v\d+/g, '')),
    `das Zaehlfeld traegt keine feste Zahl im Markup: ${zaehlfeld}`);

  // (4) tr() ersetzt den Platzhalter an genau einer Stelle — sonst zoege ein zweiter Weg nach.
  const ersetzungen = quelle.match(/replaceAll\('\{maxMaps\}'/g) || [];
  assert.strictEqual(ersetzungen.length, 1, 'der Platzhalter wird an genau einer Stelle ersetzt');
});

// --- Ringschluss ueberlebt das Loeschen einzelner Punkte --------------------
// Gemessen wird durchgaengig die Wirkung: das Kennzeichen, der **gezeichnete** Umriss und die
// Sichtbarkeit des Erweitern-Feldes. Frueher setzten `deleteSelectedPoint()` und `undoPoint()`
// `perimeterClosed` zurueck — nur fuer den Perimeter, nicht fuer Flaechen. Daran hingen zwei
// Symptome: das Erweitern-Feld blieb dauerhaft weg, und der Umriss ging an der Kante
// letzter↔erster Punkt auf, also sichtbar weit entfernt von der geloeschten Stelle.

/** Der SVG-Tag des gezeichneten Perimeters: `polygon` = geschlossen, `polyline` = offen. */
function perimeterShapeTag(t, sandbox) {
  const orig = sandbox.document.createElementNS.bind(sandbox.document);
  sandbox.document.createElementNS = (ns, name) => { const el = orig(ns, name); el.__tag = name; return el; };
  t.ui.shapeLayer.innerHTML = '';
  t.renderMap();
  sandbox.document.createElementNS = orig;
  const shape = t.ui.shapeLayer.children.find((c) => (c.attributes?.class || '').includes('perimeter-shape'));
  return shape ? shape.__tag : null;
}

test('Einen Perimeterpunkt loeschen laesst den Ring geschlossen', async () => {
  const { t, sandbox } = setup();
  seedClosedPerimeter(t);
  assert.strictEqual(perimeterShapeTag(t, sandbox), 'polygon', 'Ausgangslage: geschlossen gezeichnet');
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'Ausgangslage: Erweitern steht bereit');

  // Punkt 2 von 4 — bewusst nicht der erste oder letzte, damit die Schlusskante woanders liegt.
  t.applyPointSelection({ role: 'perimeter', index: 1, exclusionId: null });
  await t.deleteSelectedPoint();
  await flush();

  assert.strictEqual(t.state.activeMap.perimeter.length, 3, 'der Punkt ist weg');
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'der Ring bleibt geschlossen');
  assert.strictEqual(perimeterShapeTag(t, sandbox), 'polygon',
    'und wird weiterhin als geschlossener Umriss gezeichnet — keine Luecke an der Schlusskante');
  assert.ok(!t.openContours().some((c) => c.role === 'perimeter'),
    'die Kartenpruefung meldet den Perimeter nicht als offen');

  // Das Erweitern-Feld bleibt sichtbar, auch ohne und mit Punktauswahl.
  t.refreshExtendButton();
  assert.strictEqual(t.canStartExtension(), true, 'Erweitern bleibt moeglich');
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'und das Feld steht weiter da');
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  t.refreshExtendButton();
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'auch mit ausgewaehltem Punkt');
});

test('„Letzten Punkt“ laesst den Ring ebenfalls geschlossen', async () => {
  const { t, sandbox } = setup();
  seedClosedPerimeter(t);
  await t.undoPoint();
  await flush();

  assert.strictEqual(t.state.activeMap.perimeter.length, 3, 'der letzte Punkt ist weg');
  assert.strictEqual(t.state.activeMap.perimeterClosed, true, 'der Ring bleibt geschlossen');
  assert.strictEqual(perimeterShapeTag(t, sandbox), 'polygon', 'und wird geschlossen gezeichnet');
  t.refreshExtendButton();
  assert.strictEqual(t.ui.extendWrap.hidden, false, 'das Erweitern-Feld bleibt sichtbar');
});

test('Unter drei Punkten meldet die Kartenpruefung, und der Export bleibt gesperrt', async () => {
  const { t, sandbox } = setup();
  t.state.cassandraReference = { lat: 0, lon: 0 };
  seedClosedPerimeter(t);

  // Von vier auf zwei Punkte herunterloeschen.
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  await t.deleteSelectedPoint();
  t.applyPointSelection({ role: 'perimeter', index: 0, exclusionId: null });
  await t.deleteSelectedPoint();
  await flush();
  assert.strictEqual(t.state.activeMap.perimeter.length, 2);

  // Das Kennzeichen wird bewusst **nicht** angefasst — der Fall wird ueber die Tauglichkeit
  // gemeldet, nicht ueber den Ringschluss. Beides sind verschiedene Fragen.
  t.validateActiveMap();
  assert.ok(t.state.validationResult.issues.some((i) => i.key === 'checkPerimeterTooFew'),
    'die Kartenpruefung meldet die zu kurze Kontur');
  assert.strictEqual(t.cassandraExportBlockKey(t.state.activeMap), 'checkPerimeterTooFew',
    'und der CaSSAndRA-Export bleibt mit demselben Grund gesperrt');
  t.refreshExportButtons();
  assert.strictEqual(t.ui.exportCassandraBtn.disabled, true, 'der Knopf ist gesperrt');

  // Gezeichnet wird trotzdem offen: drawPolyline() verlangt eigenstaendig drei Ecken.
  assert.strictEqual(perimeterShapeTag(t, sandbox), 'polyline',
    'zwei Punkte ergeben keinen Umriss, unabhaengig vom Kennzeichen');
  assert.strictEqual(t.canStartExtension(), false, 'und erweitern laesst sich das nicht');
});

test('Ausschlussflaechen verhalten sich beim Loeschen unveraendert', async () => {
  const { t } = setup();
  t.state.activeMap.perimeter = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  t.state.activeMap.perimeterClosed = true;
  t.state.activeMap.exclusions = [{ id: 'ex1', name: 'Ausschluss 1', closed: true,
    points: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 4, y: 7 }, { x: 2, y: 6 }] }];
  t.state.activeExclusionId = 'ex1';
  t.setMode('exclusion');
  assert.strictEqual(t.canStartExtension(), true);

  t.applyPointSelection({ role: 'exclusion', index: 2, exclusionId: 'ex1' });
  await t.deleteSelectedPoint();
  await flush();
  const flaeche = t.state.activeMap.exclusions[0];
  assert.strictEqual(flaeche.points.length, 4, 'der Punkt ist weg');
  assert.strictEqual(flaeche.closed, true, 'die Flaeche bleibt geschlossen — wie vorher schon');
  assert.strictEqual(t.canStartExtension(), true, 'und laesst sich weiter erweitern');

  // Und der Perimeter derselben Karte bleibt davon unberuehrt.
  assert.strictEqual(t.state.activeMap.perimeterClosed, true);
});

// Die Liste der Stellen, die `perimeterClosed` schreiben duerfen — jede mit Grund. Ein
// Vorkommen in einer nicht gelisteten Funktion schlaegt an, ein zusaetzliches in einer
// gelisteten ebenfalls. Gleiche Ueberlegung wie beim Waechter gegen Handzaehlungen: eine reine
// Textsuche kann die Absicht nicht lesen, die Zuordnung zur Funktion schon.
const RINGSCHLUSS_SCHREIBER = {
  closePerimeter: { anzahl: 1, grund: 'schliesst den Ring — der Zweck der Funktion' },
  reopenPerimeter: { anzahl: 1, grund: 'oeffnet ihn wieder, ausdrueckliche Nutzeraktion' },
  normalizeMap: { anzahl: 1, grund: 'Normalisierung: fehlendes Feld gilt als offen' },
  deleteElement: { anzahl: 1, grund: 'leert den Perimeter vollstaendig — dann gibt es keinen Ring' },
  undoLastAction: { anzahl: 1, grund: 'stellt den Schnappschuss wieder her' },
  sunrayAppToMap: { anzahl: 1, grund: 'Import: die Vorlage fuehrt geschlossene Konturen' },
  geoJsonToMap: { anzahl: 1, grund: 'Import: aus geoRingClosed() der Datei' },
  openContourForExtension: { anzahl: 1, grund: 'trennt die Kante auf — oeffnet den Ring absichtlich' },
};

test('Kein Loeschweg fasst den Ringschluss an', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const declaration = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;
  const gefunden = new Map();
  const verstoesse = [];
  let aktuell = '(Dateiebene)';
  source.split('\n').forEach((line, index) => {
    const decl = line.match(declaration);
    if (decl) aktuell = decl[1];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    const treffer = line.match(/perimeterClosed\s*=[^=]/g);
    if (!treffer) return;
    gefunden.set(aktuell, (gefunden.get(aktuell) || 0) + treffer.length);
    if (!RINGSCHLUSS_SCHREIBER[aktuell]) {
      verstoesse.push(`app.js:${index + 1} in ${aktuell}() — ${line.trim()}`);
    }
  });

  assert.strictEqual(verstoesse.length, 0,
    `perimeterClosed wird an einer nicht vorgesehenen Stelle gesetzt:\n     ${verstoesse.join('\n     ')}`);

  for (const [name, { anzahl, grund }] of Object.entries(RINGSCHLUSS_SCHREIBER)) {
    assert.strictEqual(gefunden.get(name) || 0, anzahl,
      `${name}() setzt perimeterClosed ${gefunden.get(name) || 0} mal, vorgesehen ist ${anzahl} (${grund})`);
  }

  // Ausdruecklich fuer die beiden Loeschwege: dort darf gar nichts stehen. Die Zaehlung oben
  // faengt das schon, aber benannt ist der Rueckfall leichter zu erkennen.
  for (const fn of ['deleteSelectedPoint', 'undoPoint']) {
    const start = source.indexOf(`function ${fn}(`);
    assert.ok(start > 0, `${fn}() existiert`);
    const koerper = source.slice(start, source.indexOf('\n}', start));
    const zeilen = koerper.split('\n').filter((l) => !l.trim().startsWith('//'));
    assert.ok(!zeilen.some((l) => /perimeterClosed\s*=[^=]/.test(l)),
      `${fn}() fasst den Ringschluss nicht an — eine Ecke zu entfernen oeffnet keinen Ring`);
  }
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
