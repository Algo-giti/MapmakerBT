(function (root) {
  'use strict';

  const Protocol = {
    checksum8(text) {
      let sum = 0;
      for (let i = 0; i < text.length; i += 1) sum = (sum + text.charCodeAt(i)) & 0xff;
      return sum;
    },

    withChecksum(command) {
      return `${command},0x${this.checksum8(command).toString(16)}`;
    },

    checkLineChecksum(line) {
      const clean = String(line || '').trim();
      const idx = clean.lastIndexOf(',');
      if (idx < 0) return false;
      const supplied = clean.slice(idx + 1);
      if (!/^0x[0-9a-f]+$/i.test(supplied)) return false;
      const expected = parseInt(supplied, 16) & 0xff;
      const payload = clean.slice(0, idx);
      return this.checksum8(payload) === expected;
    },

    deriveEncryptionKey(password, challenge) {
      const pass = Number.parseInt(String(password), 10);
      const ch = Number.parseInt(String(challenge), 10);
      if (!Number.isFinite(pass) || !Number.isFinite(ch) || ch <= 0) return null;
      return pass % ch;
    },

    encryptPrintable(text, key) {
      if (!key) return text;
      let out = '';
      for (const ch of text) {
        let code = ch.charCodeAt(0) + key;
        // Match CaSSAndRA/Sunray's printable-ASCII wrap exactly:
        // values above '~' (126) continue at ASCII 32.
        while (code > 126) code = code - 126 + 31;
        while (code < 32) code = 126 - (31 - code);
        out += String.fromCharCode(code);
      }
      return out;
    },

    parseVersion(line) {
      const clean = String(line || '').trim();
      const fields = clean.split(',');
      if (fields[0] !== 'V' || fields.length < 5) return null;
      return {
        raw: clean,
        firmware: fields[1] || '',
        version: fields[2] || '',
        encryptionEnabled: Number(fields[3]) === 1,
        challenge: Number.parseInt(fields[4], 10) || 0,
        checksumValid: this.checkLineChecksum(clean),
      };
    },

    parseState(line) {
      const clean = String(line || '').trim();
      const fields = clean.split(',');
      if (fields[0] !== 'S' || fields.length < 10) return null;
      const num = (index) => {
        const value = Number(fields[index]);
        return Number.isFinite(value) ? value : null;
      };
      return {
        raw: clean,
        batteryVoltage: num(1),
        x: num(2),
        y: num(3),
        delta: num(4),
        solution: num(5),
        job: num(6),
        mowPointIndex: num(7),
        age: num(8),
        sensor: num(9),
        targetX: num(10),
        targetY: num(11),
        accuracy: num(12),
        visibleSatellites: num(13),
        amps: num(14),
        visibleSatellitesDgps: num(15),
        mapCrc: num(16),
        lateralError: num(17),
        timetableDay: num(18),
        timetableHour: num(19),
        checksumValid: this.checkLineChecksum(clean),
      };
    },

    solutionName(solution) {
      if (solution === 2) return 'RTK FIX';
      if (solution === 1) return 'RTK FLOAT';
      if (solution === 0) return 'INVALID';
      return 'UNBEKANNT';
    },
  };

  root.SunrayProtocol = Protocol;
  if (typeof module !== 'undefined' && module.exports) module.exports = Protocol;
})(typeof globalThis !== 'undefined' ? globalThis : this);
