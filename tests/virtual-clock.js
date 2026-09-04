'use strict';
// Virtuelle Uhr fuer die BLE-Tests: ersetzt setTimeout/setInterval/Date.now/performance.now
// im vm-Sandkasten, damit Backoff-Zeiten (bis 15 s) und Polling (2 s) ohne echtes Warten
// deterministisch durchlaufen werden.

function createClock(startMs = 1756900000000) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();

  const setTimeoutFn = (fn, delay = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { id, fn, args, time: now + Math.max(0, Number(delay) || 0), interval: null });
    return id;
  };
  const setIntervalFn = (fn, delay = 0, ...args) => {
    const id = nextId++;
    const every = Math.max(1, Number(delay) || 1);
    timers.set(id, { id, fn, args, time: now + every, interval: every });
    return id;
  };
  const clearFn = (id) => { timers.delete(id); };

  const earliest = () => {
    let best = null;
    for (const t of timers.values()) {
      if (!best || t.time < best.time || (t.time === best.time && t.id < best.id)) best = t;
    }
    return best;
  };

  // Eine echte Makrotask-Runde leert die komplette Microtask-Queue (auch verkettete awaits).
  const flush = async (rounds = 3) => {
    for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
  };

  async function runFor(ms) {
    const target = now + Math.max(0, ms);
    await flush();
    for (let guard = 0; guard < 100000; guard += 1) {
      const next = earliest();
      if (!next || next.time > target) break;
      now = Math.max(now, next.time);
      if (next.interval === null) timers.delete(next.id);
      else next.time = now + next.interval;
      try { next.fn(...next.args); } catch (error) { clock.errors.push(error); }
      await flush();
    }
    now = target;
    await flush();
  }

  const clock = {
    errors: [],
    now: () => now,
    pendingTimers: () => timers.size,
    pendingDelays: () => [...timers.values()].map((t) => t.time - now).sort((a, b) => a - b),
    runFor,
    flush,
    globals: {
      setTimeout: setTimeoutFn,
      clearTimeout: clearFn,
      setInterval: setIntervalFn,
      clearInterval: clearFn,
      performance: { now: () => now },
    },
  };
  return clock;
}

module.exports = { createClock };
