import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, matchTrigger, PedalMapper, startPedal, type MidiInputLike } from '../src/pedal.ts';
import { parseCast } from '../src/cast.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('parseMidi: note-on, note-off ignored, cc', () => {
  assert.deepEqual(parseMidi([0x90, 60, 100]), { type: 'note', number: 60, value: 100, channel: 1 });
  assert.equal(parseMidi([0x90, 60, 0]), null);
  assert.equal(parseMidi([0x80, 60, 0]), null);
  assert.deepEqual(parseMidi([0xb3, 64, 127]), { type: 'cc', number: 64, value: 127, channel: 4 });
  assert.equal(parseMidi([0xf8]), null);
});

test('matchTrigger', () => {
  assert.equal(matchTrigger({ type: 'note', number: 60, value: 1, channel: 1 }, { note: 60 }), true);
  assert.equal(matchTrigger({ type: 'note', number: 61, value: 1, channel: 1 }, { note: 60 }), false);
  assert.equal(matchTrigger({ type: 'cc', number: 64, value: 127, channel: 1 }, { cc: 64 }), true);
  assert.equal(matchTrigger({ type: 'cc', number: 64, value: 0, channel: 1 }, { cc: 64 }), false);
});

test('mapper fires next/back, debounces 150 ms per action, honours the channel filter', () => {
  const now = { t: 0 };
  const cues: string[] = [];
  const cast = parseCast('pedal: { next: { note: 60 }, back: { cc: 64 }, channel: 2, debounceMs: 150 }\n').cast;
  const m = new PedalMapper({ cast: () => cast, onCue: (a) => cues.push(a), clock: () => now.t });
  assert.match(m.feed([0x91, 60, 100])!, /→ next$/);
  now.t = 100; assert.match(m.feed([0x91, 60, 100])!, /debounced/);
  now.t = 200; m.feed([0x91, 60, 100]);
  now.t = 210; assert.match(m.feed([0xb1, 64, 127])!, /→ back$/);      // a different action is not debounced by next
  assert.match(m.feed([0x90, 60, 100])!, /wrong channel/);              // channel 1, filter says 2
  assert.match(m.feed([0x91, 61, 100])!, /unmapped/);
  assert.deepEqual(cues, ['next', 'next', 'back']);
  assert.equal(m.lastEvent?.desc.includes('note 61'), true);
});

test('scan() survives a native MIDI exception, recovers on the next tick, closes every probe it constructs, and a later probe-only failure does not disturb an open port — injectable Input needs no hardware', async (t) => {
  let getPortCountCalls = 0;
  let throwNextPortCount = false;
  let messageCb: ((dt: number, msg: number[]) => void) | null = null;
  const instances: FakeInput[] = [];    // every probe/input this test constructs, so none may be left open
  class FakeInput implements MidiInputLike {
    closed = false;
    constructor() { instances.push(this); }
    getPortCount() {
      getPortCountCalls++;
      if (getPortCountCalls === 1) throw new Error('native boom');           // first tick: the probe itself fails
      if (throwNextPortCount) { throwNextPortCount = false; throw new Error('native boom 2'); } // a later, one-off probe failure
      return 1;
    }
    getPortName(_i: number) { return 'Pedal'; }
    openPort(_i: number) {}
    closePort() { this.closed = true; }
    ignoreTypes() {}
    on(ev: 'message', cb: (dt: number, msg: number[]) => void) { if (ev === 'message') messageCb = cb; }
  }
  const cast = parseCast('pedal: { next: { note: 60 } }\n').cast;
  const cues: string[] = [];
  const logs: string[] = [];
  const p = await startPedal({ cast: () => cast, onCue: (a) => cues.push(a), log: (m) => logs.push(m), midi: { Input: FakeInput }, rescanMs: 20 });
  t.after(() => p.close());
  // First scan (synchronous, inside startPedal) hit the thrown getPortCount and was swallowed; its
  // probe must still have been closed — no leaked native handle from the failing tick.
  assert.equal(p.status().state, 'NO PEDAL');
  assert.equal(logs.some((l) => l.includes('scan failed: native boom')), true);
  assert.equal(instances.length > 0, true);
  assert.equal(instances.every((i) => i.closed), true);
  await sleep(60);
  const opened = p.status();
  assert.deepEqual(opened, { state: 'OK', port: 'Pedal', lastEvent: null });
  messageCb!(0, [0x90, 60, 100]);
  assert.deepEqual(cues, ['next']);
  // A probe-only failure on a later tick (listing ports for the disappearance check) must not
  // touch the already-open input: status stays OK on the same port.
  throwNextPortCount = true;
  await sleep(40);
  assert.equal(p.status().state, 'OK');
  assert.equal(p.status().port, 'Pedal');
  p.close();
  assert.equal(instances.every((i) => i.closed), true);
});
