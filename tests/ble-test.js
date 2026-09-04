'use strict';
// BLE-Tests gegen den Fake-Stack aus tests/fake-ble.js — kein Browser, kein echtes Geraet.
//
//   test(...)  = harte Zusicherung, laesst den Lauf bei Abweichung fehlschlagen.
//   probe(...) = Beobachtung zu einem in CLAUDE.md dokumentierten Verdachtsfall.
//                Probes schlagen nie fehl, sie protokollieren nur den Ist-Zustand,
//                damit sichtbar wird, ob ein bekannter Mangel noch besteht.

const assert = require('assert');
const { loadApp } = require('./app-harness.js');
const { createClock } = require('./virtual-clock.js');
const { createFakeBluetooth, ESP32_NOTIFY_PAYLOAD } = require('./fake-ble.js');

const EXPORTS = ['state', 'ui', 'bleAdapter', 'connectBluetooth', 'disconnectBluetooth', 'onDisconnected',
  'establishGatt', 'sendSunray', 'handleLine', 'onNotification', 'scheduleReconnect', 'startPolling', 'stopPolling',
  'initializeSunrayHandshake', 'emergencyStop'];

function setup(fakeOptions = {}) {
  const clock = createClock();
  const fake = createFakeBluetooth({ clock, ...fakeOptions });
  const { t, elements } = loadApp({ clock, bleAdapter: fake.adapter, exportNames: EXPORTS });
  elements.get('passwordInput').value = '123456';
  const logText = () => elements.get('debugLog').textContent;
  return { clock, fake, sim: fake.sim, t, elements, logText, disconnectEvents: () => (logText().match(/· TX=/g) || []).length };
}

/** Verbindet die App mit dem Fake und wartet den Handshake ab. */
async function connect(ctx, budgetMs = 2000) {
  const pending = ctx.t.connectBluetooth();
  await ctx.clock.runFor(budgetMs);
  await pending;
  return ctx;
}

// ---------------------------------------------------------------------------
const cases = [];
const test = (name, fn) => cases.push({ name, fn, kind: 'test' });
const probe = (name, fn) => cases.push({ name, fn, kind: 'probe' });

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

test('Polling: alle 2000 ms ein AT+S, Telemetrie wird uebernommen', async () => {
  const ctx = await connect(setup());
  const polls = () => ctx.sim.commands.filter((c) => c.startsWith('AT+S')).length;
  assert.ok(polls() >= 1, 'startPolling() fragt sofort einmal ab');
  const before = polls();
  await ctx.clock.runFor(4000);
  assert.strictEqual(polls() - before, 2, 'genau zwei weitere Abfragen in 4 s');
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

probe('RX-Watchdog: reagiert die App auf einen stillen, aber "verbundenen" Link?', async () => {
  const ctx = await connect(setup());
  const lastRx = ctx.t.state.lastBleRxAt;
  ctx.sim.silent = true;
  await ctx.clock.runFor(60000);
  const silenceMs = ctx.clock.now() - ctx.t.state.lastBleRxAt;
  assert.ok(silenceMs >= 59000, 'Fake muss wirklich still sein');
  assert.ok(ctx.t.state.lastBleRxAt === lastRx);
  assert.ok(ctx.sim.commands.filter((c) => c.startsWith('AT+S')).length > 20, 'App pollt weiter ins Leere');
  if (ctx.t.state.connected) {
    return `OFFEN: nach ${Math.round(silenceMs / 1000)} s ohne RX gilt der Link weiter als verbunden `
      + '(state.lastBleRxAt wird gepflegt, aber nie ausgewertet) — CLAUDE.md App-Punkt 10.';
  }
  return 'BEHOBEN: die App erkennt den stillen Link und trennt/reconnectet.';
});

probe('Abgerissene Notify-Kette: bemerkt die App den wachsenden Rueckstau?', async () => {
  const ctx = setup({ notifyAck: false });
  await connect(ctx, 4200);
  await ctx.clock.runFor(60000);
  // Je Antwort verlaesst nur ein 15-Byte-Paket den ESP32; der Rest bleibt liegen. Die App bekommt
  // dadurch stark verzoegerte, teils veraltete Zeilen — merkt davon aber nichts.
  const backlog = ctx.sim.pendingTxBytes();
  if (ctx.t.state.connected && backlog > 200) {
    const polls = ctx.sim.commands.filter((c) => c.startsWith('AT+S')).length;
    return `OFFEN: ${polls} AT+S gesendet, nur ${ctx.t.state.bleRxLines} Zeilen zurueck, `
      + `${backlog} Byte Rueckstau im ESP32-TX-Puffer — die App pollt weiter und meldet "verbunden" `
      + '— CLAUDE.md ESP32-Punkt 4 + App-Punkt 10.';
  }
  return `BEHOBEN: die App bemerkt die abgerissene Notify-Kette (Rueckstau ${backlog} Byte).`;
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
test('Nach 8 erfolglosen Versuchen laufen keine Timer mehr', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999;
  ctx.sim.dropLink();
  await ctx.clock.runFor(120000); // Backoff 1+2,5+5+10+15+15+15+15 s = 78,5 s
  assert.strictEqual(ctx.t.state.reconnectAttempts, 8);
  assert.strictEqual(ctx.sim.stats.connectCalls, 9, '1 Erstverbindung + 8 Versuche');
  assert.strictEqual(ctx.t.state.reconnectTimer, null);
  assert.strictEqual(ctx.clock.pendingTimers(), 0, 'keine verwaisten Timer');
  assert.strictEqual(ctx.t.state.connected, false);
});

probe('Endzustand nach erschoepftem Reconnect', async () => {
  const ctx = await connect(setup());
  ctx.sim.connectFailures = 999;
  ctx.sim.dropLink();
  await ctx.clock.runFor(120000);
  const deadDevice = Boolean(ctx.t.state.device) && !ctx.t.state.connected && !ctx.t.state.manualDisconnect;
  const detail = ctx.t.state.connectionDetailKey;
  if (deadDevice && detail === 'bluetoothDisconnected') {
    return 'OFFEN: state.device bleibt gesetzt, der Status haengt auf "bluetoothDisconnected" — der Nutzer '
      + 'erfaehrt nicht, dass die App aufgegeben hat — CLAUDE.md App-Punkt 11.';
  }
  return `BEHOBEN: Endzustand device=${ctx.t.state.device ? 'gesetzt' : 'null'}, detail=${detail}.`;
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

probe('rxBuffer ohne Zeilenende waechst unbegrenzt', async () => {
  const ctx = await connect(setup());
  ctx.sim.silent = true;
  const bytes = 200000;
  ctx.sim.inject('A'.repeat(bytes));
  await ctx.clock.runFor(50);
  if (ctx.t.state.rxBuffer.length >= bytes) {
    return `OFFEN: ${ctx.t.state.rxBuffer.length} Zeichen ohne \\n werden ungebremst gepuffert, `
      + 'kein Limit und keine Warnung — CLAUDE.md App-Punkt 13.';
  }
  return `BEHOBEN: rxBuffer ist auf ${ctx.t.state.rxBuffer.length} Zeichen begrenzt.`;
});

// ---------------------------------------------------------------------------
(async () => {
  let failed = 0;
  const findings = [];
  for (const c of cases) {
    try {
      const verdict = await c.fn();
      if (c.kind === 'probe') findings.push(`  · ${c.name}\n    ${verdict}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL [${c.kind}] ${c.name}\n     ${error.message}`);
      if (process.env.BLE_TEST_STACK) console.error(error.stack);
    }
  }
  if (findings.length) console.log(`\nBefunde zu den dokumentierten Verdachtsfaellen:\n${findings.join('\n')}\n`);
  if (failed) { console.error(`ble tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
  console.log(`ble tests: OK (${cases.length} Faelle)`);
})();
