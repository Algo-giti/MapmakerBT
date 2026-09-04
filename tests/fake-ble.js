'use strict';
// Fake-Web-Bluetooth-Stack, der die Sunray/ESP32-Gegenseite nachbildet.
// Wird ueber globalThis.__bleAdapter in die App injiziert (siehe bleAdapter() in app.js).
//
// Nachgebildet werden:
//  - Verbindungsaufbau/-abbau inkl. gattserverdisconnected-Event
//  - plotzlicher Linkverlust zu beliebigem Zeitpunkt (dropLink)
//  - MTU-Limit: Antworten werden in BLE_MTU-5 = 15-Byte-Notifies zerlegt
//  - abreissende Notify-Kette: ohne SUCCESS_NOTIFY-Quittung wird nicht nachgeschoben
//  - Reconnect, bei dem Chrome dasselbe Characteristic-Objekt zurueckgibt
//  - Verschluesselung: Kommandos kommen verschoben an, AT+V immer im Klartext

const SunrayProtocol = require('../protocol.js');

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const ESP32_NOTIFY_PAYLOAD = 15; // BLE_MTU 20 - 5

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeCharacteristic {
  constructor(sim, service) {
    this.uuid = CHARACTERISTIC_UUID;
    this.service = service;
    this.properties = { write: true, writeWithoutResponse: true, notify: true, read: true };
    this.value = null;
    this._sim = sim;
    this._listeners = new Set();
    this.notifying = false;
  }

  async startNotifications() { this.notifying = true; this._sim.stats.startNotifications += 1; return this; }
  async stopNotifications() { this.notifying = false; return this; }

  addEventListener(type, fn) {
    if (type !== 'characteristicvaluechanged') return;
    this._listeners.add(fn);
    this._sim.stats.listenerAdds += 1;
  }

  removeEventListener(type, fn) {
    if (type !== 'characteristicvaluechanged') return;
    if (this._listeners.delete(fn)) this._sim.stats.listenerRemoves += 1;
  }

  get listenerCount() { return this._listeners.size; }

  async writeValueWithResponse(chunk) { return this._sim._appWrote(chunk, 'with-response'); }
  async writeValue(chunk) { return this._sim._appWrote(chunk, 'legacy'); }
  async writeValueWithoutResponse(chunk) { return this._sim._appWrote(chunk, 'without-response'); }

  _dispatch(bytes) {
    if (!this.notifying) return;
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const event = { type: 'characteristicvaluechanged', target: this };
    for (const fn of [...this._listeners]) fn(event);
  }
}

class FakeService {
  constructor(sim, uuid) { this.uuid = uuid; this._sim = sim; }
  async getCharacteristic(uuid) {
    if (uuid !== CHARACTERISTIC_UUID) throw new Error(`No Characteristic ${uuid}`);
    if (!this._sim.gatt.connected) throw new Error('GATT Server is disconnected.');
    return this._sim._characteristicForSession();
  }
}

class FakeGattServer {
  constructor(sim, device) { this._sim = sim; this.device = device; this.connected = false; }

  async connect() {
    const sim = this._sim;
    sim.stats.connectCalls += 1;
    if (sim.connectFailures > 0) {
      sim.connectFailures -= 1;
      throw new Error('GATT connect failed (simuliert)');
    }
    this.connected = true;
    sim._session += 1;
    sim._rxLine = '';
    sim._txBuf = '';
    sim._notifyBusy = false;
    return this;
  }

  async getPrimaryService(uuid) {
    if (!this.connected) throw new Error('GATT Server is disconnected.');
    if (uuid !== SERVICE_UUID) throw new Error(`No Service ${uuid}`);
    return new FakeService(this._sim, uuid);
  }

  disconnect() { this._sim._tearDown(); }
}

class FakeDevice {
  constructor(sim, name) {
    this.id = 'fake-ardumower';
    this.name = name;
    this._listeners = new Set();
    this.gatt = new FakeGattServer(sim, this);
  }
  addEventListener(type, fn) { if (type === 'gattserverdisconnected') this._listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'gattserverdisconnected') this._listeners.delete(fn); }
  _fireDisconnected() { for (const fn of [...this._listeners]) fn({ type: 'gattserverdisconnected', target: this }); }
}

function createFakeBluetooth(options = {}) {
  const clock = options.clock;
  if (!clock) throw new Error('createFakeBluetooth benoetigt eine virtuelle Uhr');

  const sim = {
    // --- steuerbares Verhalten ---------------------------------------------
    encryptionEnabled: options.encryptionEnabled !== false,
    password: options.password ?? '123456',
    challenge: options.challenge ?? 162,
    firmwareName: options.firmwareName ?? 'Ardumower Sunray',
    firmwareVersion: options.firmwareVersion ?? '1.0.324',
    /** Antwortverzoegerung der Firmware in ms (Kommando -> erstes Notify). */
    answerDelayMs: options.answerDelayMs ?? 20,
    /** Abstand zwischen zwei Notify-Paketen in ms (ESP32: naechstes Paket erst nach SUCCESS_NOTIFY). */
    notifyIntervalMs: options.notifyIntervalMs ?? 10,
    /** false = die Notify-Kette reisst nach dem ersten Paket ab (kein SUCCESS_NOTIFY). */
    notifyAck: options.notifyAck !== false,
    /** true = Firmware empfaengt, antwortet aber nie (stiller Link). */
    silent: Boolean(options.silent),
    /** true = Chrome liefert beim Reconnect dasselbe Characteristic-Objekt zurueck. */
    reuseCharacteristic: Boolean(options.reuseCharacteristic),
    /** Anzahl der naechsten gatt.connect()-Aufrufe, die fehlschlagen sollen. */
    connectFailures: options.connectFailures ?? 0,
    /** Antwortet die Firmware ueberhaupt auf AT+V? */
    answerVersion: options.answerVersion !== false,
    telemetry: { battery: 28.6, x: 15.15, y: -10.24, delta: 2.02, solution: 2, accuracy: 0.02, sats: 49, satsDgps: 48 },

    // --- Beobachtung --------------------------------------------------------
    /** Alle empfangenen Kommandozeilen (bereits entschluesselt). */
    commands: [],
    /** Rohe Zeilen so, wie sie ueber die Luft kamen. */
    rawCommands: [],
    writes: [],
    stats: { connectCalls: 0, disconnects: 0, startNotifications: 0, listenerAdds: 0, listenerRemoves: 0, notifyPackets: 0, bytesToApp: 0, maxWriteChunk: 0 },

    _session: 0,
    _rxLine: '',
    _txBuf: '',
    _notifyBusy: false,
    _characteristic: null,
    _characteristicSession: -1,
  };

  const device = new FakeDevice(sim, options.deviceName ?? 'Ardumower');
  sim.device = device;
  sim.gatt = device.gatt;

  sim._characteristicForSession = () => {
    if (!sim._characteristic || (!sim.reuseCharacteristic && sim._characteristicSession !== sim._session)) {
      sim._characteristic = new FakeCharacteristic(sim, null);
      sim._characteristicSession = sim._session;
    }
    return sim._characteristic;
  };

  sim.characteristic = () => sim._characteristic;

  const key = () => (sim.encryptionEnabled ? SunrayProtocol.deriveEncryptionKey(sim.password, sim.challenge) : 0);

  // --- Firmware-Logik -------------------------------------------------------
  sim._appWrote = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer || chunk);
    if (!sim.gatt.connected) throw new Error('GATT Server is disconnected.');
    sim.writes.push(bytes.byteLength);
    sim.stats.maxWriteChunk = Math.max(sim.stats.maxWriteChunk, bytes.byteLength);
    sim._rxLine += decoder.decode(bytes);
    let idx;
    while ((idx = sim._rxLine.search(/[\r\n]/)) >= 0) {
      const raw = sim._rxLine.slice(0, idx);
      sim._rxLine = sim._rxLine.slice(idx + 1);
      if (raw) sim._handleCommand(raw);
    }
  };

  sim._handleCommand = (raw) => {
    sim.rawCommands.push(raw);
    // Sunray ueberspringt die Entschluesselung fuer AT+V; alles andere kommt verschoben an.
    const plain = raw.startsWith('AT+') ? raw : SunrayProtocol.encryptPrintable(raw, -key());
    sim.commands.push(plain);
    if (sim.silent) return;
    const cmd = plain.split(',')[0];
    if (cmd === 'AT+V' && sim.answerVersion) sim._scheduleAnswer(sim.versionLine());
    else if (cmd === 'AT+S') sim._scheduleAnswer(sim.stateLine());
  };

  sim.versionLine = () => SunrayProtocol.withChecksum(
    `V,${sim.firmwareName},${sim.firmwareVersion},${sim.encryptionEnabled ? 1 : 0},${sim.challenge}`,
  );

  sim.stateLine = () => {
    const t = sim.telemetry;
    return SunrayProtocol.withChecksum(
      `S,${t.battery.toFixed(2)},${t.x.toFixed(2)},${t.y.toFixed(2)},${t.delta.toFixed(2)},${t.solution},2,0,0.25,0,`
      + `15.70,-11.39,${t.accuracy.toFixed(2)},${t.sats},-0.05,${t.satsDgps},-971195`,
    );
  };

  sim._scheduleAnswer = (line) => {
    clock.globals.setTimeout(() => sim.answer(line), sim.answerDelayMs);
  };

  /** Legt eine Antwortzeile in den TX-Ringpuffer (wie bleSend()) und startet die Notify-Kette. */
  sim.answer = (line) => {
    sim._txBuf += `${line}\r\n`;
    sim._pump();
  };

  /** Schiebt rohe Bytes ohne Firmware-Logik zur App (fuer Fehler-/Flutszenarien). */
  sim.inject = (text, { chunked = true } = {}) => {
    if (!chunked) { sim._emit(encoder.encode(text)); return; }
    const bytes = encoder.encode(text);
    for (let i = 0; i < bytes.length; i += ESP32_NOTIFY_PAYLOAD) {
      sim._emit(bytes.slice(i, i + ESP32_NOTIFY_PAYLOAD));
    }
  };

  sim._pump = () => {
    if (sim._notifyBusy || !sim._txBuf || !sim.gatt.connected) return;
    sim._notifyBusy = true;
    const packet = sim._txBuf.slice(0, ESP32_NOTIFY_PAYLOAD);
    sim._txBuf = sim._txBuf.slice(packet.length);
    clock.globals.setTimeout(() => {
      sim._emit(encoder.encode(packet));
      sim._notifyBusy = false;
      // Ohne SUCCESS_NOTIFY-Quittung schiebt der ESP32 kein weiteres Paket nach:
      // der Rest bleibt im txBuf liegen (dokumentierter Verdachtsfall 4).
      if (sim.notifyAck) sim._pump();
    }, sim.notifyIntervalMs);
  };

  sim._emit = (bytes) => {
    if (!sim._characteristic || !sim.gatt.connected) return;
    sim.stats.notifyPackets += 1;
    sim.stats.bytesToApp += bytes.byteLength;
    sim._characteristic._dispatch(bytes);
  };

  sim._tearDown = () => {
    if (!sim.gatt.connected) return;
    sim.gatt.connected = false;
    sim.stats.disconnects += 1;
    sim._txBuf = '';
    sim._notifyBusy = false;
    clock.globals.setTimeout(() => device._fireDisconnected(), 0);
  };

  /** Plotzlicher Linkverlust (Supervision-Timeout, ESP32-Reboot, ...). */
  sim.dropLink = () => sim._tearDown();

  /** Pending TX-Bytes, die wegen abgerissener Notify-Kette liegen bleiben. */
  sim.pendingTxBytes = () => sim._txBuf.length;

  const adapter = {
    async getAvailability() { return true; },
    async requestDevice(filters) {
      sim.lastRequestFilters = filters;
      if (options.rejectPicker) throw new Error('User cancelled the requestDevice() chooser.');
      return device;
    },
  };

  return { adapter, device, sim, SERVICE_UUID, CHARACTERISTIC_UUID, ESP32_NOTIFY_PAYLOAD };
}

module.exports = { createFakeBluetooth, SERVICE_UUID, CHARACTERISTIC_UUID, ESP32_NOTIFY_PAYLOAD };
