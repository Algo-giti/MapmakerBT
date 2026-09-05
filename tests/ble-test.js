'use strict';
// BLE-Tests gegen den Fake-Stack aus tests/fake-ble.js — kein Browser, kein echtes Geraet.
// Alle vier in CLAUDE.md dokumentierten App-Verdachtsfaelle (10, 11, 13 und die App-Reaktion
// auf ESP32-Punkt 4) sind hier als harte Zusicherungen abgedeckt, nicht mehr als Beobachtung.

const assert = require('assert');
const { loadApp } = require('./app-harness.js');
const { createClock } = require('./virtual-clock.js');
const { createFakeBluetooth, ESP32_NOTIFY_PAYLOAD } = require('./fake-ble.js');

const EXPORTS = ['state', 'ui', 'bleAdapter', 'connectBluetooth', 'disconnectBluetooth', 'onDisconnected',
  'establishGatt', 'sendSunray', 'handleLine', 'onNotification', 'scheduleReconnect', 'startPolling', 'stopPolling',
  'initializeSunrayHandshake', 'emergencyStop', 'reportBleError'];

function setup(fakeOptions = {}) {
  const clock = createClock();
  const fake = createFakeBluetooth({ clock, ...fakeOptions });
  const { t, elements, sandbox } = loadApp({ clock, bleAdapter: fake.adapter, exportNames: EXPORTS });
  elements.get('passwordInput').value = '123456';
  const logText = () => elements.get('debugLog').textContent;
  return { clock, fake, sim: fake.sim, t, elements, sandbox, logText, disconnectEvents: () => (logText().match(/· TX=/g) || []).length };
}

/** Verbindet die App mit dem Fake und wartet den Handshake ab. */
async function connect(ctx, budgetMs = 2000) {
  const pending = ctx.t.connectBluetooth();
  await ctx.clock.runFor(budgetMs);
  await pending;
  return ctx;
}

// ---------------------------------------------------------------------------
/** Erwartete abgeleitete Grenze: 8000 ms Karenzzeit / 500 ms Intervall. */
const BLE_UNANSWERED_POLL_LIMIT_EXPECTED = 16;

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// === 1. Normaler Verbindungsaufbau =========================================
test('Verbindungsaufbau: Handshake, Firmware und Schluessel', async () => {
  const ctx = await connect(setup());
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.sim.stats.connectCalls, 1);
  assert.strictEqual(ctx.sim.stats.startNotifications, 1);
  assert.strictEqual(JSON.stringify(ctx.sim.lastRequestFilters.filters), JSON.stringify([{ services: ['0000ffe0-0000-1000-8000-00805f9b34fb'] }]));
  assert.strictEqual(ctx.sim.commands[0], 'AT+V,0x16');
  assert.strictEqual(ctx.t.state.firmware.firmware, 'Ardumower Sunray');
  assert.strictEqual(ctx.t.state.encryptionEnabled, true);
  assert.strictEqual(ctx.t.state.encryptionKey, 12); // 123456 % 162
});

test('AT+V geht im Klartext raus, spaetere Kommandos verschluesselt', async () => {
  const ctx = await connect(setup());
  assert.strictEqual(ctx.sim.rawCommands[0], 'AT+V,0x16');
  await ctx.clock.runFor(2100); // ein Polling-Zyklus
  const rawState = ctx.sim.rawCommands.find((line) => !line.startsWith('AT+'));
  assert.ok(rawState, 'nach dem Handshake muss ein verschluesseltes Kommando aufgetaucht sein');
  assert.ok(ctx.sim.commands.includes('AT+S,0x13'), 'Firmware muss AT+S entschluesselt sehen');
});

test('Polling: alle 500 ms ein AT+S, Telemetrie wird uebernommen', async () => {
  const ctx = await connect(setup());
  const polls = () => ctx.sim.commands.filter((c) => c.startsWith('AT+S')).length;
  assert.ok(polls() >= 1, 'startPolling() fragt sofort einmal ab');
  const before = polls();
  await ctx.clock.runFor(4000);
  assert.strictEqual(polls() - before, 8, 'genau acht weitere Abfragen in 4 s');
  assert.strictEqual(ctx.t.state.telemetry.x, 15.15);
  assert.strictEqual(ctx.t.state.telemetry.y, -10.24);
  assert.strictEqual(ctx.t.state.telemetry.solution, 2);
});

// === 2. MTU-Limit ==========================================================
test('MTU: Schreibvorgaenge sind auf 15 Byte gestueckelt', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling(); // Polling wuerde sonst Schreibvorgaenge dazwischenschieben
  const writesBefore = ctx.sim.writes.length;
  const pending = ctx.t.sendSunray('AT+C,-1,-1,-1,-1,-1,-1,-1,-1,128');
  await ctx.clock.runFor(200);
  await pending;
  const chunks = ctx.sim.writes.slice(writesBefore);
  assert.strictEqual(chunks.length, 3, 'AT+C,…,128,0x1a + \\n = 40 Byte -> 3 Pakete');
  assert.ok(Math.max(...chunks) <= ESP32_NOTIFY_PAYLOAD);
  assert.strictEqual(ctx.sim.commands.at(-1), 'AT+C,-1,-1,-1,-1,-1,-1,-1,-1,128,0x1a');
});

test('MTU: eine lange S-Zeile kommt in mehreren Notifies und wird als eine Zeile verarbeitet', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  const linesBefore = ctx.t.state.bleRxLines;
  const packetsBefore = ctx.sim.stats.notifyPackets;
  ctx.sim.answer(ctx.sim.stateLine());
  await ctx.clock.runFor(500);
  assert.ok(ctx.sim.stats.notifyPackets - packetsBefore >= 5, 'S-Zeile braucht mehr als 5 Notify-Pakete');
  assert.strictEqual(ctx.t.state.bleRxLines - linesBefore, 1, 'trotz Stueckelung genau eine Zeile');
  assert.strictEqual(ctx.t.state.rxBuffer, '');
});

// === 3. Plotzlicher Verbindungsabbruch =====================================
test('Linkverlust: Zustand wird aufgeraeumt und ein Reconnect geplant', async () => {
  const ctx = await connect(setup());
  ctx.sim.dropLink();
  await ctx.clock.runFor(50);
  assert.strictEqual(ctx.t.state.connected, false);
  assert.strictEqual(ctx.t.state.characteristic, null);
  assert.strictEqual(ctx.t.state.server, null);
  assert.strictEqual(ctx.t.state.pollTimer, null);
  assert.ok(ctx.t.state.reconnectTimer, 'Reconnect muss geplant sein');
  assert.strictEqual(ctx.t.state.reconnectAttempts, 1);
});

test('Reconnect nach Linkverlust gelingt und setzt den Zaehler zurueck', async () => {
  const ctx = await connect(setup());
  ctx.sim.dropLink();
  await ctx.clock.runFor(2000); // 1000 ms Backoff + Handshake
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.t.state.reconnectAttempts, 0);
  assert.strictEqual(ctx.sim.stats.connectCalls, 2);
  await ctx.clock.runFor(2100);
  assert.ok(ctx.t.state.telemetry.receivedAt > 0, 'Polling laeuft nach dem Reconnect weiter');
});

test('Manueller Trennvorgang loest genau einen Disconnect-Pfad und keinen Reconnect aus', async () => {
  const ctx = await connect(setup());
  const pending = ctx.t.disconnectBluetooth();
  await ctx.clock.runFor(1000);
  await pending;
  assert.strictEqual(ctx.t.state.connected, false);
  assert.strictEqual(ctx.disconnectEvents(), 1, 'onDisconnected darf nur einmal durchlaufen');
  assert.ok(ctx.sim.commands.includes('AT+M,0,0,0xc5'), 'Not-Halt vor dem Trennen');
  assert.ok(ctx.sim.commands.includes('AT+C,0,0,0xbb'));
  await ctx.clock.runFor(20000);
  assert.strictEqual(ctx.sim.stats.connectCalls, 1, 'nach manuellem Trennen kein Reconnect');
  assert.strictEqual(ctx.t.state.device, null);
});

// === 4. Fehlende / verzoegerte Notifies ====================================
test('Ohne V-Antwort wird AT+V einmal ohne Checksumme wiederholt', async () => {
  const ctx = setup({ answerVersion: false });
  await connect(ctx, 4200);
  const versions = ctx.sim.commands.filter((c) => c.startsWith('AT+V'));
  assert.strictEqual(versions.length, 2);
  assert.strictEqual(versions[0], 'AT+V,0x16');
  assert.strictEqual(versions[1], 'AT+V', 'zweiter Versuch ohne Checksumme');
  assert.strictEqual(ctx.t.state.connectionDetailKey, 'noVersionReply');
  assert.strictEqual(ctx.t.state.firmware, null);
});

test('Abgerissene Notify-Kette: Teilpaket bleibt im rxBuffer, Rest im TX-Puffer der Firmware', async () => {
  const ctx = setup({ notifyAck: false });
  await connect(ctx, 4200);
  ctx.t.stopPolling();
  // Die V-Antwort tropft nur in 15-Byte-Haeppchen durch und ist nach 2x1800 ms noch nicht komplett:
  // der Handshake laeuft in beide Timeouts.
  assert.strictEqual(ctx.sim.commands.filter((c) => c.startsWith('AT+V')).length, 2);
  assert.ok(ctx.t.state.rxBuffer.length > 0, 'unvollstaendiges Fragment bleibt im rxBuffer liegen');
  const packetsBefore = ctx.sim.stats.notifyPackets;
  const bufferBefore = ctx.sim.pendingTxBytes();
  ctx.sim.answer(ctx.sim.stateLine());
  await ctx.clock.runFor(1000);
  assert.strictEqual(ctx.sim.stats.notifyPackets - packetsBefore, 1, 'ohne SUCCESS_NOTIFY genau ein Paket je Antwort');
  assert.ok(ctx.sim.pendingTxBytes() > bufferBefore, 'der Rest staut sich im ESP32-TX-Puffer');
});

test('RX-Watchdog trennt einen stillen Link und laesst den Reconnect anlaufen', async () => {
  const ctx = await connect(setup());
  ctx.sim.silent = true;          // Firmware empfaengt weiter, antwortet aber nicht mehr
  ctx.sim.connectFailures = 999;  // Reconnect soll die Zustandspruefung nicht ueberholen
  await ctx.clock.runFor(12000);
  assert.strictEqual(ctx.t.state.connected, false, 'stiller Link darf nicht "verbunden" bleiben');
  assert.strictEqual(ctx.sim.gatt.connected, false, 'GATT wurde aktiv getrennt');
  assert.ok(ctx.t.state.reconnectAttempts >= 1, 'Reconnect wurde angestossen');
  assert.strictEqual(ctx.disconnectEvents(), 1, 'genau ein Disconnect-Durchlauf');
  assert.ok(['bleLinkStalled', 'bleNoAnswer'].includes(ctx.t.state.connectionDetailKey), 'Grund wird gemeldet');
  assert.ok(/RX watchdog|status requests unanswered/.test(ctx.logText()), 'Grund steht im Diagnoseprotokoll');
});

test('RX-Watchdog haelt eine Karenzzeit ein und schlaegt nicht sofort zu', async () => {
  const ctx = await connect(setup());
  ctx.sim.silent = true;
  ctx.sim.connectFailures = 999;
  await ctx.clock.runFor(6000);
  assert.strictEqual(ctx.t.state.connected, true, 'kurze Stille loest noch nichts aus');
  await ctx.clock.runFor(6000);
  assert.strictEqual(ctx.t.state.connected, false, 'nach der Karenzzeit wird getrennt');
});

test('RX-Watchdog: nach dem Trennen faengt sich die App selbst wieder', async () => {
  const ctx = await connect(setup());
  ctx.sim.silent = true;
  await ctx.clock.runFor(11000);
  assert.ok(ctx.sim.stats.connectCalls >= 2, 'Reconnect wurde versucht');
  ctx.sim.silent = false; // Gegenstelle antwortet wieder
  await ctx.clock.runFor(20000);
  assert.strictEqual(ctx.t.state.connected, true, 'App ist danach wieder verbunden');
  assert.ok(ctx.t.state.telemetry.receivedAt > 0, 'Telemetrie laeuft weiter');
});

test('Fehlgeschlagene Schreibvorgaenge werden dem Nutzer gemeldet', async () => {
  const ctx = await connect(setup());
  ctx.sim.failWrites = true;
  await ctx.clock.runFor(2500); // die naechste Statusabfrage scheitert
  assert.ok(ctx.logText().includes('GATT Error Unknown'), 'Fehler steht im Diagnoseprotokoll');
  assert.ok(ctx.elements.get('pointStatus').textContent.includes('Senden fehlgeschlagen'),
    'Kurzhinweis erscheint auf der Karte');
  assert.ok(ctx.sandbox.__lastConfirmRequest, 'der erste Fehler wird als Meldung gezeigt');
  assert.strictEqual(ctx.sandbox.__lastConfirmRequest.singleButton, true);

  // Der 2-s-Poll darf den Nutzer nicht mit Dialogen zuschuetten.
  ctx.sandbox.__lastConfirmRequest = null;
  await ctx.clock.runFor(6000);
  assert.strictEqual(ctx.sandbox.__lastConfirmRequest, null, 'kein Dialog je fehlgeschlagenem Poll');
});

test('RX-Watchdog schlaegt bei laufendem Empfang nicht an', async () => {
  const ctx = await connect(setup());
  await ctx.clock.runFor(30000); // Polling wird beantwortet -> Dauerempfang
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.sim.stats.connectCalls, 1, 'kein unnoetiger Reconnect');
});

test('Unbeantwortete AT+S werden erkannt, auch wenn noch Daten eintrudeln', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999; // Reconnect soll den Endzustand nicht ueberschreiben
  ctx.sim.silent = true;         // keine Antworten mehr auf AT+S
  // Bruchstuecke halten lastBleRxAt frisch: der reine Stille-Watchdog wuerde hier nie
  // anschlagen — genau die Lage bei abgerissener Notify-Kette (CLAUDE.md ESP32-Punkt 4).
  for (let i = 0; i < 14 && ctx.t.state.connected; i += 1) {
    ctx.sim.inject('X\r\n');
    await ctx.clock.runFor(1000);
  }
  assert.strictEqual(ctx.t.state.connected, false, 'ausbleibende Antworten muessen auffallen');
  assert.strictEqual(ctx.t.state.connectionDetailKey, 'bleNoAnswer', 'eigener Fehlergrund, nicht nur "getrennt"');
  assert.ok(ctx.logText().includes('status requests unanswered'));
  assert.ok(ctx.t.state.reconnectAttempts >= 1, 'Reconnect laeuft an');
});

test('Abgerissene Notify-Kette laeuft mit 500-ms-Polling nur noch verlangsamt', async () => {
  // Die Firmware schiebt das naechste Notify-Paket entweder aus SUCCESS_NOTIFY nach oder beim
  // naechsten bleSend(). Faellt SUCCESS_NOTIFY aus, tropft der Stau also im Takt der Abfragen
  // heraus — mit 500 ms statt 2000 ms viermal so schnell. Dadurch setzen sich wieder ganze
  // Zeilen zusammen: der Link ist nicht mehr tot, sondern nur langsam, und die App darf ihn
  // deshalb auch nicht mehr trennen. Frueher (2-s-Takt) reichte der Tropfen nicht und die
  // Erkennung schlug zu. Der Fall "es kommt wirklich nichts Verwertbares" bleibt durch
  // 'Unbeantwortete AT+S werden erkannt, auch wenn noch Daten eintrudeln' abgedeckt.
  const ctx = setup({ notifyAck: false });
  await connect(ctx, 4200);
  ctx.sim.connectFailures = 999;
  const seenAt = ctx.t.state.telemetry.receivedAt;
  await ctx.clock.runFor(30000);
  assert.strictEqual(ctx.t.state.connected, true, 'ein tropfender Link ist kein toter Link');
  assert.ok(ctx.t.state.telemetry.receivedAt > seenAt, 'es kommen weiterhin ganze Zeilen an');
  assert.ok(ctx.t.state.pendingStateReplies < BLE_UNANSWERED_POLL_LIMIT_EXPECTED,
    'der Zaehler wird immer wieder zurueckgesetzt');
});

test('Die Grenze fuer unbeantwortete Abfragen haengt am Intervall, nicht an einer festen Zahl', () => {
  // Als feste Anzahl (frueher 4) haette das schnellere Polling die Karenzzeit von 8 s auf 2 s
  // verkuerzt und gesunde Verbindungen abgeschossen.
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const interval = Number((source.match(/BLE_POLL_INTERVAL_MS = (\d+)/) || [])[1]);
  const grace = Number((source.match(/BLE_UNANSWERED_POLL_GRACE_MS = (\d+)/) || [])[1]);
  assert.ok(interval > 0 && grace > 0, 'beide Konstanten muessen benannt sein');
  assert.ok(/BLE_UNANSWERED_POLL_LIMIT = Math\.max\(4, Math\.round\(BLE_UNANSWERED_POLL_GRACE_MS \/ BLE_POLL_INTERVAL_MS\)\)/.test(source),
    'die Grenze muss aus Karenzzeit und Intervall abgeleitet werden');
  assert.strictEqual(BLE_UNANSWERED_POLL_LIMIT_EXPECTED, Math.round(grace / interval));
  assert.strictEqual(grace, 8000, 'die Karenzzeit von 8 s bleibt unabhaengig vom Intervall');
});

test('Bleibt das Disconnect-Event aus, raeumt die App selbst auf', async () => {
  const ctx = setup({ suppressDisconnectEvent: true });
  await connect(ctx);
  ctx.sim.silent = true;
  ctx.sim.connectFailures = 999;
  await ctx.clock.runFor(15000);
  assert.strictEqual(ctx.sim.gatt.connected, false, 'GATT wurde getrennt');
  assert.strictEqual(ctx.t.state.connected, false, 'Sicherheitsnetz greift ohne Event');
  assert.strictEqual(ctx.disconnectEvents(), 1, 'trotzdem nur ein Aufraeum-Durchlauf');
});

test('Ein gesunder Link setzt den Zaehler der offenen Abfragen zurueck', async () => {
  const ctx = await connect(setup());
  await ctx.clock.runFor(20000);
  assert.ok(ctx.t.state.pendingStateReplies <= 1, 'jede Abfrage wird beantwortet');
  assert.strictEqual(ctx.t.state.connected, true);
});

// === 5. Mehrfache characteristicvaluechanged-Listener ======================
test('Reconnect mit frischem Characteristic: genau ein Listener, keine Doppelverarbeitung', async () => {
  const ctx = await connect(setup({ reuseCharacteristic: false }));
  ctx.sim.dropLink();
  await ctx.clock.runFor(2000);
  ctx.t.stopPolling();
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.sim.characteristic().listenerCount, 1);
  const before = ctx.t.state.bleRxLines;
  ctx.sim.answer(ctx.sim.stateLine());
  await ctx.clock.runFor(500);
  assert.strictEqual(ctx.t.state.bleRxLines - before, 1);
});

test('Reconnect auf demselben Characteristic-Objekt: keine Doppelverarbeitung', async () => {
  // Chrome kann beim Reconnect dasselbe Characteristic-Objekt zurueckgeben. establishGatt() ruft dann
  // erneut addEventListener() mit *derselben* Funktionsreferenz auf — der EventTarget-Standard
  // dedupliziert das, es entsteht kein zweiter Listener. Damit ist CLAUDE.md App-Punkt 8 entkraeftet.
  const ctx = await connect(setup({ reuseCharacteristic: true }));
  ctx.sim.dropLink();
  await ctx.clock.runFor(2000);
  ctx.t.stopPolling();
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.sim.stats.listenerAdds, 2, 'die App haengt den Listener zweimal ein');
  assert.strictEqual(ctx.sim.stats.listenerRemoves, 0, 'und raeumt ihn nie ab');
  assert.strictEqual(ctx.sim.characteristic().listenerCount, 1, 'EventTarget dedupliziert die Referenz');
  const before = ctx.t.state.bleRxLines;
  ctx.sim.answer(ctx.sim.stateLine());
  await ctx.clock.runFor(500);
  assert.strictEqual(ctx.t.state.bleRxLines - before, 1, 'jede Zeile wird genau einmal verarbeitet');
});

// === 6. Erschoepfter Reconnect =============================================
test('Nach 8 erfolglosen Versuchen endet der Reconnect in einem sauberen Zustand', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999;
  ctx.sim.dropLink();
  await ctx.clock.runFor(120000); // Backoff 1+2,5+5+10+15+15+15+15 s = 78,5 s
  assert.strictEqual(ctx.sim.stats.connectCalls, 9, '1 Erstverbindung + 8 Versuche, danach Schluss');
  assert.strictEqual(ctx.t.state.reconnectTimer, null);
  assert.strictEqual(ctx.clock.pendingTimers(), 0, 'keine verwaisten Timer');
  assert.strictEqual(ctx.t.state.connected, false);
  assert.strictEqual(ctx.t.state.device, null, 'Geraet wird losgelassen');
  assert.strictEqual(ctx.t.state.characteristic, null);
  assert.strictEqual(ctx.t.state.connectionDetailKey, 'reconnectGaveUp', 'klare Ansage statt stiller Haenger');
  assert.strictEqual(ctx.t.state.reconnectAttempts, 0, 'Zaehler ist fuer einen neuen Anlauf zurueckgesetzt');
  assert.strictEqual(ctx.elements.get('connectBtn').disabled, false, 'manueller Neuversuch ist moeglich');
  await ctx.clock.runFor(60000);
  assert.strictEqual(ctx.sim.stats.connectCalls, 9, 'kein Endlos-Retry im Hintergrund');
});

test('Manueller Neuversuch nach dem Aufgeben funktioniert', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999;
  ctx.sim.dropLink();
  await ctx.clock.runFor(120000);
  assert.strictEqual(ctx.t.state.device, null);
  ctx.sim.connectFailures = 0;
  await connect(ctx, 3000); // entspricht dem Tippen auf "Gerät suchen & verbinden"
  assert.strictEqual(ctx.t.state.connected, true);
  assert.strictEqual(ctx.t.state.reconnectAttempts, 0);
  assert.ok(ctx.t.state.device, 'Geraet ist wieder gebunden');
});

// === 7. rxBuffer ===========================================================
test('rxBuffer erholt sich nach Muell, sobald ein \\n kommt', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  ctx.sim.telemetry.x = 3.25;
  ctx.sim.inject(`${'?'.repeat(4000)}\n${ctx.sim.stateLine()}\r\n`);
  await ctx.clock.runFor(50);
  assert.strictEqual(ctx.t.state.rxBuffer, '');
  assert.strictEqual(ctx.t.state.telemetry.x, 3.25);
});

test('rxBuffer ist gedeckelt: Muell ohne Zeilenende wird verworfen', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  ctx.sim.silent = true;
  ctx.sim.inject('A'.repeat(200000));
  await ctx.clock.runFor(50);
  assert.ok(ctx.t.state.rxBuffer.length <= 4096, `rxBuffer blieb bei ${ctx.t.state.rxBuffer.length} Zeichen`);
  assert.ok(ctx.logText().includes('RX buffer overflow'), 'Ueberlauf wird als Protokollfehler protokolliert');
});

test('Nach dem Ueberlauf wird der Datenstrom wieder korrekt ausgewertet', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  ctx.sim.silent = true;
  ctx.sim.telemetry.x = 7.5;
  ctx.sim.inject('B'.repeat(9000));           // ein Ueberlauf
  ctx.sim.inject(`\n${ctx.sim.stateLine()}\r\n`);
  await ctx.clock.runFor(50);
  assert.strictEqual(ctx.t.state.telemetry.x, 7.5, 'die naechste gueltige Zeile kommt wieder an');
  assert.strictEqual(ctx.t.state.rxBuffer, '');
  assert.strictEqual(ctx.t.state.connected, true, 'ein einzelner Ueberlauf trennt nicht');
});

test('Lange, aber gueltige Zeilen werden nicht abgeschnitten', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  const before = ctx.t.state.bleRxLines;
  ctx.sim.telemetry.x = 1.25;
  // Deutlich laenger als jede echte Sunray-Zeile, aber unterhalb des Limits.
  ctx.sim.inject(`${'#'.repeat(3000)}\n${ctx.sim.stateLine()}\r\n`);
  await ctx.clock.runFor(50);
  assert.strictEqual(ctx.t.state.bleRxLines - before, 2, 'beide Zeilen werden verarbeitet');
  assert.strictEqual(ctx.t.state.telemetry.x, 1.25);
  assert.ok(!ctx.logText().includes('RX buffer overflow'), 'kein Fehlalarm');
});

test('Wiederholter Ueberlauf gilt als kaputter Datenstrom und trennt die Verbindung', async () => {
  const ctx = await connect(setup());
  ctx.sim.silent = true;
  ctx.sim.connectFailures = 999;
  for (let i = 0; i < 3; i += 1) ctx.sim.inject('C'.repeat(9000));
  await ctx.clock.runFor(100);
  assert.strictEqual(ctx.t.state.connected, false);
  assert.strictEqual(ctx.t.state.connectionDetailKey, 'bleProtocolError');
  assert.ok(ctx.t.state.reconnectAttempts >= 1, 'Reconnect laeuft an');
});

// === Neues Symptom: einzelne Schreibvorgaenge scheitern, der Link steht weiter ============
// Beobachtet am Geraet: "GATT Error Unknown" bei AT+S/AT+M, nicht dauerhaft reproduzierbar.
// Die folgenden Faelle halten den IST-Zustand fest — sie beschreiben, was die App heute tut,
// nicht was sie tun soll. Aenderungen am Verhalten muessen sie bewusst mit anpassen.

test('IST: ein vereinzelter Schreibfehler wird gemeldet und nicht wiederholt', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  const before = ctx.sim.commands.length;
  ctx.sim.failWriteChunks = 1; // genau der naechste Chunk scheitert
  let rejected = null;
  const pending = ctx.t.sendSunray('AT+S').catch((error) => { rejected = error; });
  await ctx.clock.runFor(200);
  await pending;
  assert.ok(rejected, 'sendSunray() lehnt ab, verschluckt den Fehler also nicht');
  assert.strictEqual(rejected.message, 'GATT Error Unknown');
  assert.strictEqual(ctx.sim.commands.length, before, 'das Kommando kam nie bei der Firmware an');
  // Kein automatischer zweiter Versuch: die App sendet von sich aus nichts nach.
  await ctx.clock.runFor(1000);
  assert.strictEqual(ctx.sim.commands.length, before, 'kein Retry');
  assert.strictEqual(ctx.sim.stats.writeFailures, 1);
  assert.strictEqual(ctx.t.state.sendBusy, false, 'die Sendesperre wird trotz Fehler geloest');
  assert.strictEqual(ctx.t.state.connected, true, 'die Verbindung gilt weiterhin als bestehend');
});

test('Ein Fehler mitten im Kommando wird durch ein nachgesendetes Zeilenende abgeschlossen', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  // AT+C,… ist drei Chunks lang, dazwischen liegen 12 ms Pause: erst Chunk 1 durchlassen,
  // dann genau den naechsten Chunk abweisen.
  const long = 'AT+C,-1,-1,-1,-1,-1,-1,-1,-1,128';
  const before = ctx.sim.rawCommands.length;
  let rejected = null;
  const pending = ctx.t.sendSunray(long).catch((e) => { rejected = e; });
  await ctx.clock.runFor(6);
  ctx.sim.failWriteChunks = 1;
  await ctx.clock.runFor(200);
  await pending;
  assert.ok(rejected, 'der Fehler kommt trotz Resynchronisation beim Aufrufer an');
  assert.strictEqual(rejected.message, 'GATT Error Unknown');
  assert.strictEqual(ctx.sim._rxLine, '', 'kein Bruchstueck bleibt im Empfangspuffer der Firmware');
  assert.ok(ctx.logText().includes('Zeilenende nachgesendet'), 'die Resynchronisation steht im Protokoll');

  // Das naechste Kommando kommt dadurch unverstuemmelt an.
  const next = ctx.t.sendSunray('AT+S');
  await ctx.clock.runFor(200);
  await next;
  const arrived = ctx.sim.commands.slice(before);
  assert.ok(arrived.some((c) => c === 'AT+S,0x13'),
    `AT+S muss sauber ankommen, angekommen ist: ${JSON.stringify(arrived)}`);
  assert.ok(!arrived.some((c) => c.includes('AT+C') && c.includes('AT+S')),
    'kein zusammengeklebtes Kommando mehr');
});

test('IST: ohne bereits gesendeten Chunk wird nichts nachgeschickt', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  const writesBefore = ctx.sim.writes.length;
  ctx.sim.failWriteChunks = 1; // schon der erste Chunk scheitert
  let rejected = null;
  const pending = ctx.t.sendSunray('AT+S').catch((e) => { rejected = e; });
  await ctx.clock.runFor(200);
  await pending;
  assert.ok(rejected);
  assert.strictEqual(ctx.sim.writes.length, writesBefore,
    'ohne angefangene Zeile gibt es nichts abzuschliessen — kein zusaetzlicher Schreibvorgang');
});

test('IST: dauerhaft scheiternde Schreibvorgaenge trennen erst ueber den RX-Watchdog', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999; // Reconnect soll den Zustand nicht sofort wieder aufraeumen
  ctx.sim.failWrites = true;
  await ctx.clock.runFor(5000);
  assert.strictEqual(ctx.t.state.connected, true, 'nach 5 s gilt der Link noch als verbunden');
  assert.strictEqual(ctx.t.state.pendingStateReplies, 0,
    'die ESP32-4-Erkennung greift nicht: nicht gesendete Abfragen werden nicht gezaehlt');
  await ctx.clock.runFor(5000);
  assert.strictEqual(ctx.t.state.connected, false, 'erst der RX-Watchdog (8 s Stille) beendet den Link');
  assert.strictEqual(ctx.t.state.connectionDetailKey, 'bleLinkStalled');
});

test('IST: scheiternder Fahr-Heartbeat meldet sich und wird im naechsten Takt erneut versucht', async () => {
  const ctx = await connect(setup());
  ctx.t.stopPolling();
  ctx.t.state.driveDirection = 'joystick';
  ctx.t.state.driveVector = { linear: 0.2, angular: 0 };
  ctx.sim.failWriteChunks = 1;
  let rejected = null;
  const pending = ctx.t.sendSunray('AT+M,0.20,0.00').catch((e) => { rejected = e; ctx.t.reportBleError('AT+M', e); });
  await ctx.clock.runFor(200);
  await pending;
  assert.ok(rejected, 'der Fahrbefehl scheitert sichtbar');
  assert.ok(ctx.elements.get('driveState').textContent.includes('Senden fehlgeschlagen'),
    'der Hinweis steht in der Fahrzeile, nicht nur im Log');
  // Der naechste Befehl geht wieder durch — der 650-ms-Takt ist die faktische Wiederholung.
  const before = ctx.sim.commands.length;
  const again = ctx.t.sendSunray('AT+M,0.20,0.00');
  await ctx.clock.runFor(200);
  await again;
  assert.strictEqual(ctx.sim.commands.length, before + 1, 'der naechste Takt kommt an');
});

// ---------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${c.name}\n     ${error.message}`);
      if (process.env.BLE_TEST_STACK) console.error(error.stack);
    }
  }
  if (failed) { console.error(`ble tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
  console.log(`ble tests: OK (${cases.length} Faelle)`);
})();
