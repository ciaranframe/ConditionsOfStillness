# Engine Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AirKit a headless "Conditions" profile on the `AirConditions` branch: nine device slots, one equal-power crossfader per wrist, scene parameters and a two-hand partner delivered to patches, a master stage with a safety limiter, status and level replies, and a smoke test that proves it end to end with fake sticks.

**Architecture:** `airkit/code3.0/conditions/main_conditions.scd` boots the unchanged shared controllers (`personalityController.scd`, `oscController.scd`) with piece configuration from `conditions/config.scd`, exactly the way COTF's `main_cotf.scd` does. Three tiny additive, default-preserving edits to the shared controllers (env-driven device count, env-driven roster filename, a per-tick timestamp) make nine slots and the piece roster possible. The profile fills the `~cotfSeatBus` map (the key the personality controller already reads) with nine private buses, mounts four wrist-monitor synths (each reading its wrist's two slot buses through `XFade2`), an audition monitor and a master with `Limiter`, and registers `[COS]` OSC handlers. Node-side, a copied OSC codec, a ping tool and an engine smoke test live in `scripts/`; `run.sh` starts the engine under a restart loop.

**Tech Stack:** SuperCollider 3.13 (sclang + scsynth, core UGens: `XFade2`, `VarLag`, `Limiter`, `SendPeakRMS`), OSC over UDP, Node ≥ 22.18 running TypeScript natively, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md` §5 (Engine profile), §3 (vocabulary), §9 (run.sh), §10 (engine smoke).

## Global Constraints

- All AirKit work happens in the worktree `airkit/` on branch `AirConditions`; commits there are prefixed `cos:`; never touch `~/AirKit`; push only to `mirror` (`git -C airkit push mirror AirConditions`), never to `origin`.
- Shared-controller edits (`oscController.scd`, `personalityController.scd`) are additive and default-preserving: with no `AIRKIT_*` environment variables set, behaviour is byte-for-byte today's (5 devices, `list_cotf.sc`). Piece-specific code lives only under `code3.0/conditions/`, `personalities/COS_*.sc`, `lists/list_conditions.sc`.
- Any commit that changes OSC behaviour updates `airkit/code3.0/API.md` in the same commit, additively, under `[COS]` headings.
- Slots: ZL = 1,2 · ZR = 3,4 · CL = 5,6 · CR = 7,8 · audition = 9. Device port for slot *n* = `9001 + n − 1` (the runner and the smoke test send from source port 9001). Wrist names on the wire are the strings `ZL`, `ZR`, `CL`, `CR`.
- Crossfader position on the wire: `pos` 0 = first slot of the pair, 1 = second. Fade times are seconds, clamped to ≥ 0.01 in the engine. Gains are linear, clamped 0–4.
- Master limiter ceiling −1 dBFS (linear 0.891), lookahead 0.01 s, disabled with `COS_LIMITER=0`.
- Stereo out (`numOutputBusChannels = 2`), `blockSize 128`, `s.latency 0.05`, `numBuffers 2048`, `memSize 65536`. Ports: default langPort 57120, scsynth `COS_SCSYNTH_PORT` (57110). The smoke test uses langPort 57130 / scsynth 57131 so it never collides with a running engine.
- Room state is always `\idle`; `/airkit/state` is still honoured (idle | tuning | piece | curtain | silent) and dispatches `~onRoomState` like Glimmer's launcher.
- Status reply is a hand-built JSON string; personality names are plain identifiers and are not escaped.
- Piece-repo commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. AirKit-branch commits use the plain `cos:` message.
- Never `Cmd-.`; never kill a running engine you did not start; smoke runs use their own ports and kill only their own sclang and the scsynth on their own port.
- Every file a tool writes goes to a temp path and is renamed into place.

## Review Focus

1. Scene params or a partner sent for a slot whose device does not exist yet (the runner preloads before a stick streams): the engine must store them without error and the patch must read them at `~init`. Pinned in Task 6 (smoke sends params/partner for slot 7 before its first IMU packet, then asserts the template posts the register after load).
2. An unknown wrist name (`Q`, `zl`): the handler posts `[COS] unknown wrist` and ignores it; the engine keeps answering. Pinned in Task 6.
3. Out-of-range values: `pos 7` clips to 1, `fade 0` clamps to 0.01, `gain 9` clips to 4. Pinned in Task 6 (status reply reflects the clamped values).
4. A second IMU sender from another source port (a stray stick pointed straight at the engine) creates extra devices that share slot buses; the status reply must expose `deviceCount` so Admin can show more than nine. Pinned in Task 6 (`deviceCount === 9` in the normal run) and Task 4 (field present).
5. Panic must leave every wrist at level 0 and every device on `silence`, and the engine must still answer status afterwards. Pinned in Task 6.

---

### Task 1: Shared-controller edits, roster, API config note

**Files:**
- Modify: `airkit/code3.0/oscController.scd:11`
- Modify: `airkit/code3.0/personalityController.scd:10-17` and the tick loop at `:318-337`
- Create: `airkit/lists/list_conditions.sc`
- Modify: `airkit/code3.0/API.md` (append)

**Interfaces:**
- Produces: env vars `AIRKIT_VIRTUAL_DEVICES` (integer, default 5) and `AIRKIT_LIST` (roster filename, default `list_cotf.sc`) read by the controllers at load; `d.lastTick` (seconds, `Main.elapsedTime`) set on every enabled tick of every device; roster `list_conditions.sc` = `["silence", "COS_Template", "silence"]` (index 1 = the template).

- [ ] **Step 1: Edit the device count**

In `airkit/code3.0/oscController.scd`, replace line 11
```supercollider
var numAirwareVirtualDevices = 5;
```
with
```supercollider
// [COS] env-driven, default-preserving: AIRKIT_VIRTUAL_DEVICES=9 for the Conditions profile.
var numAirwareVirtualDevices = ("AIRKIT_VIRTUAL_DEVICES".getenv ? "5").asInteger;
```

- [ ] **Step 2: Edit the roster filename and size the list array from the same count**

In `airkit/code3.0/personalityController.scd`, replace
```supercollider
var list = "list_cotf.sc";
```
with
```supercollider
// [COS] env-driven, default-preserving: AIRKIT_LIST=list_conditions.sc for the Conditions profile.
var list = "AIRKIT_LIST".getenv ? "list_cotf.sc";
```
and replace
```supercollider
var defaultLists = list!5;
```
with
```supercollider
// [COS] one entry per virtual device — must match oscController's count or loadPersonalityList
// indexes past the end for devices 6+.
var defaultLists = list ! (("AIRKIT_VIRTUAL_DEVICES".getenv ? "5").asInteger);
```

- [ ] **Step 3: Add the per-tick timestamp**

In `createProcRout` (personalityController.scd, inside `if(d.enabled == true,{ … })`), immediately after the line `~processDeviceData.(d);` add:
```supercollider
                    // [COS] age of the last completed tick is reported by /airkit/cos/getStatus;
                    // a hook that throws stops this loop and the age grows.
                    d.lastTick = Main.elapsedTime;
```

- [ ] **Step 4: Create the roster**

`airkit/lists/list_conditions.sc`:
```supercollider
// Conditions of Stillness roster. AirKit reads <root>/lists/<AIRKIT_LIST> from
// personalityController.scd; the Conditions profile sets AIRKIT_LIST=list_conditions.sc.
// Shape: ["silence", ...names..., "silence"]. Index 0 is what a new device gets; the LAST
// entry is unreachable (loadPersonality wraps with index.mod(size-1)) and is a sentinel.
(
	[
		"silence",
		"COS_Template",
		"silence",
	]
)
```

- [ ] **Step 5: Document the configuration in API.md**

Append to `airkit/code3.0/API.md`:
```markdown

## [COS] Conditions of Stillness profile — configuration (not OSC)

Entry point `code3.0/conditions/main_conditions.scd` (headless). Environment variables read at
load; every default preserves composer-machine behaviour exactly.

| Variable | Read by | Default | Conditions value |
|---|---|---|---|
| `AIRKIT_VIRTUAL_DEVICES` | `oscController.scd`, `personalityController.scd` | `5` | `9` (set by `conditions/config.scd`) |
| `AIRKIT_LIST` | `personalityController.scd` | `list_cotf.sc` | `list_conditions.sc` (set by `conditions/config.scd`) |
| `COS_SCSYNTH_PORT` | `conditions/config.scd` | `57110` | — |
| `COS_OUT_DEVICE` | `conditions/config.scd` | CoreAudio default | e.g. `MacBook Pro Speakers` |
| `COS_LIMITER` | `conditions/config.scd` | `1` | `0` disables the master limiter |
| `COS_SAMPLES` | `conditions/config.scd` | `~/Music/cos_samples` | the piece repo's `samples/` |

`personalityController.scd` also stamps `d.lastTick = Main.elapsedTime` on every enabled tick
(informational; reported by `/airkit/cos/getStatus`).
```

- [ ] **Step 6: Load-check both controllers headless with the env set**

Write `/tmp/cos-loadcheck.scd` (outside the repo):
```supercollider
(
var root = "AIRKIT_ROOT".getenv;
"AIRKIT_VIRTUAL_DEVICES".setenv("9");
"AIRKIT_LIST".setenv("list_conditions.sc");
thisProcess.interpreter.executeFile(root +/+ "code3.0/personalityController.scd");
thisProcess.interpreter.executeFile(root +/+ "code3.0/oscController.scd");
"LOADCHECK OK".postln;
0.exit;
)
```
Run from the piece repo root:
```bash
AIRKIT_ROOT="$PWD/airkit" timeout 90 /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57139 /tmp/cos-loadcheck.scd 2>&1 | grep -E "LOADCHECK OK|ERROR" | head
```
Expected: `LOADCHECK OK` and no `ERROR` line. Then the same with the env vars absent (delete the two `setenv` lines) to prove the defaults still load: `LOADCHECK OK`.

- [ ] **Step 7: Commit on the AirKit branch**

```bash
git -C airkit add code3.0/oscController.scd code3.0/personalityController.scd lists/list_conditions.sc code3.0/API.md
git -C airkit commit -m "cos: env-driven device count and roster filename, per-tick timestamp, list_conditions roster"
```

---

### Task 2: OSC codec, engine ping tool

**Files:**
- Create: `scripts/lib/osc.ts`
- Create: `scripts/engine-ping.ts`
- Test: `scripts/test/osc.test.ts`

**Interfaces:**
- Produces (from `scripts/lib/osc.ts`, same API as Glimmer's codec): `encodeMessage(address: string, args?: OscArg[], types?: string): Buffer`, `decodeMessage(buf: Buffer): OscMessage`, `flattenPacket(buf: Buffer): OscMessage[]`, `type OscArg = number | string | boolean | null | Uint8Array | bigint`, `interface OscMessage { address: string; args: OscArg[]; types: string }`. Integers are encoded as `i` only when `types` says so; a JavaScript number is encoded as `f` by default (AirKit's handlers call `.asInteger`/`.asFloat`, so floats are fine everywhere).
- Produces: `node scripts/engine-ping.ts [langPort=57120]` prints every reply to `/airkit/getRoster`, `/airkit/getSeats`, `/airkit/getState`, `/airkit/cos/getStatus` within 1.5 s.

- [ ] **Step 1: Copy the codec**

Copy `/Users/ciaran/Documents/Glimmer/code/show-engine/src/osc/codec.ts` to `scripts/lib/osc.ts` unchanged, then prepend this header comment:
```ts
// OSC 1.0 codec. Copied from the Glimmer show engine (code/show-engine/src/osc/codec.ts,
// Ciaran Frame, 2026) so this repo has no dependency on the Glimmer checkout. Keep in sync by hand.
```
Read the file once after copying and confirm the exports listed in the Interfaces block exist (`decodeMessage`, `decodeBundle`, `decodePacket`, `flattenPacket`, `encodeMessage`, `encodeBundle`, `isBundle`).

- [ ] **Step 2: Write the failing tests**

`scripts/test/osc.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessage, flattenPacket, encodeBundle } from '../lib/osc.ts';

test('round-trips a message with float, string and explicit int', () => {
  const buf = encodeMessage('/airkit/cos/xfade', ['ZL', 1, 2.5], 'sif');
  const m = decodeMessage(buf);
  assert.equal(m.address, '/airkit/cos/xfade');
  assert.equal(m.types, 'sif');
  assert.deepEqual(m.args, ['ZL', 1, 2.5]);
});

test('numbers encode as floats by default', () => {
  const m = decodeMessage(encodeMessage('/x', [9001, 0]));
  assert.equal(m.types, 'ff');
  assert.deepEqual(m.args, [9001, 0]);
});

test('flattenPacket unpacks a bundle into its messages', () => {
  const b = encodeBundle([encodeMessage('/a', [1]), encodeMessage('/b', ['x'])]);
  const ms = flattenPacket(b);
  assert.deepEqual(ms.map((m) => m.address), ['/a', '/b']);
});

test('decodeMessage rejects an unterminated address', () => {
  assert.throws(() => decodeMessage(Buffer.from('/abc')), /osc/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test scripts/test/osc.test.ts`
Expected: FAIL, cannot find `../lib/osc.ts` (before the copy) — if you copied first, expect PASS and note that in the report; the tests still pin the behaviour.

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/test/osc.test.ts`
Expected: `pass 4`. If `numbers encode as floats by default` fails because the codec defaults integers to `i`, keep the codec and change that test's expectation to the codec's real behaviour, and record it in the report; nothing downstream depends on the type tag.

- [ ] **Step 5: Write the ping tool**

`scripts/engine-ping.ts`:
```ts
// Ask a Conditions engine (or any AirKit) for roster, seats, state and [COS] status.
// Usage: node scripts/engine-ping.ts [langPort=57120]
import { createSocket } from 'node:dgram';
import { encodeMessage, flattenPacket } from './lib/osc.ts';

const port = Number(process.argv[2] ?? 57120);
const sock = createSocket('udp4');
sock.on('message', (buf) => {
  for (const m of flattenPacket(Buffer.from(buf))) console.log(m.address, m.args.map(String).join(' '));
});
sock.on('error', (e) => { console.error(String(e)); sock.close(); });
sock.bind(0, () => {
  for (const a of ['/airkit/getRoster', '/airkit/getSeats', '/airkit/getState', '/airkit/cos/getStatus']) {
    sock.send(encodeMessage(a, []), port, '127.0.0.1');
  }
  setTimeout(() => sock.close(), 1500);
});
```
Run `node scripts/engine-ping.ts 57199` (nothing listening) and expect it to exit silently after 1.5 s with code 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/osc.ts scripts/test/osc.test.ts scripts/engine-ping.ts
git commit -m "cos engine: OSC codec (copied from Glimmer) with tests, engine-ping tool

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `conditions/config.scd` and `main_conditions.scd` core (boot, buses, monitors, master, meter, state)

**Files:**
- Create: `airkit/code3.0/conditions/config.scd`
- Create: `airkit/code3.0/conditions/main_conditions.scd`

**Interfaces:**
- Consumes: Task 1's env vars and `d.lastTick`.
- Produces in `topEnvironment` (read by Task 4's handlers and Task 5's template): `~cosSlotCount` (9), `~cosWrists` (`(ZL: [1,2], ZR: [3,4], CL: [5,6], CR: [7,8])`), `~cosWristOrder` (`[\ZL, \ZR, \CL, \CR]`), `~cosAuditionSlot` (9), `~cosLimiterOn` (Boolean), `~cosSamples` (path String), `~cotfSeatBus` (Dictionary slot → stereo `Bus`), `~cosMasterBus`, `~cosMonitors` (Dictionary wrist Symbol → `Synth`, plus `\audition`), `~cosMasterSynth`, `~cosWristState` (Dictionary wrist → `(pos:, level:, fade:)`), `~cosMaster` (`(gain:)`), `~cosPeaks` (Dictionary key → `[peak, rms]`, reset by the broadcaster), `~cosRunnerAddr` (`NetAddr` or nil), `~cosSlotParams` (Dictionary slot → Event), `~cosSlotPartner` (Dictionary slot → Integer), `~cosDeviceForSlot = { |slot| … }` → device or nil, `~cosPartnerDevice = { |slot| … }` → device or nil. SynthDefs `\cosWristMonitor`, `\cosAuditionMonitor`, `\cosMaster`. OSCdefs `\cosState` (`/airkit/state`), `\cosGetState` (`/airkit/getState`), `\cosMeter` (`/cos/meter` from scsynth). The post line `Conditions AirKit up: …` marks readiness. Meter reply IDs: 1–4 = wrists in `~cosWristOrder`, 9 = audition, 0 = master.

- [ ] **Step 1: Write `config.scd`**

`airkit/code3.0/conditions/config.scd`:
```supercollider
// Conditions of Stillness engine configuration — loaded by conditions/main_conditions.scd
// BEFORE the shared controllers. Piece-only: the composer's main.sc and COTF's main_cotf.scd
// never load this file. OSC contract: ../API.md ([COS] sections). Spec: the piece repo,
// docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md §5.
(
// --- slots -----------------------------------------------------------------
// Two slots per wrist (crossfade pair) plus one audition slot. The shared controllers read the
// count and the roster name from the environment; set them here so nothing else has to.
~cosSlotCount = 9;
"AIRKIT_VIRTUAL_DEVICES".setenv(~cosSlotCount.asString);
"AIRKIT_LIST".setenv("list_conditions.sc");
~cosWrists = (ZL: [1, 2], ZR: [3, 4], CL: [5, 6], CR: [7, 8]);
~cosWristOrder = [\ZL, \ZR, \CL, \CR];
~cosAuditionSlot = 9;

// --- options from the environment ------------------------------------------
~cosLimiterOn = ("COS_LIMITER".getenv ? "1") == "1";
~cosSamples = ("COS_SAMPLES".getenv ? "~/Music/cos_samples").standardizePath;

// --- server: stereo out, show latency ----------------------------------------
s.options.numOutputBusChannels = 2;
s.options.numInputBusChannels = 0;
s.options.blockSize = 128;
s.options.numBuffers = 2048;
s.options.memSize = 65536;
s.options.numWireBufs = 256;
s.latency = 0.05;
"COS_OUT_DEVICE".getenv !? { |dev| if (dev.size > 0) { s.options.outDevice = dev } };
s.addr = NetAddr("127.0.0.1", ("COS_SCSYNTH_PORT".getenv ? "57110").asInteger);
)
```

- [ ] **Step 2: Write `main_conditions.scd` (core; Task 4 appends the handlers into the marked block)**

`airkit/code3.0/conditions/main_conditions.scd`:
```supercollider
// Conditions of Stillness engine — headless AirKit profile. Boots the SAME shared controllers
// as the composer's main.sc, with piece configuration (conditions/config.scd). No GUI, no
// conductor: the piece is in free time and the room state stays \idle.
// Run: /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57120 main_conditions.scd
// Env: COS_SCSYNTH_PORT (57110), COS_OUT_DEVICE (default device), COS_LIMITER (1), COS_SAMPLES.
// OSC contract: ../API.md [COS]. Readiness: the post line "Conditions AirKit up".
(
var codeRoot = thisProcess.nowExecutingPath.dirname.dirname; // .../code3.0

thisProcess.interpreter.executeFile(codeRoot +/+ "conditions" +/+ "config.scd");

// --- stub conductor: everything the personality controller and patches may read ---------
~roomState = \idle;
~scoreVoicePool = [69];
~scoreBeatsPerBar = 2;
~scoreEventsPerBeat = 4;
~stateCtx = (
    state: \idle, voicePool: [69],
    loudness: 0, tension: 0, brightness: 0, density: 0, register: 0,
    sectionId: nil, phraseId: nil, chord: nil, key: nil, scale: nil, p: nil, m: nil
);
~beatClock = TempoClock.new(2).permanent_(true);
~stop = { };
~onResync = { |idx| };

// --- [COS] per-slot state the OSC handlers write and patches read -----------------------
~cosSlotParams = Dictionary();   // slot -> Event of scene params (may arrive before the device exists)
~cosSlotPartner = Dictionary();  // slot -> partner slot (Integer); absent = one-hand sound
~cosWristState = Dictionary();   // wrist Symbol -> (pos:, level:, fade:) mirror of the monitor synth
~cosMaster = (gain: 1.0);
~cosRunnerAddr = nil;            // last sender of any /airkit/cos/* message; levels are broadcast there
~cosPeaks = Dictionary();        // wrist Symbol | \audition | \master -> [peak, rms] since last broadcast
~cosAuditionWrist = nil;         // informational: which wrist the runner mirrors to slot 9

~cosDeviceForSlot = { |slot| ~devices.values.detect { |d| d.index == slot } };
~cosPartnerDevice = { |slot| ~cosSlotPartner.at(slot) !? { |p| ~cosDeviceForSlot.(p) } };

// Same load order as main.sc / main_cotf.scd: personality -> osc. No conductorController.
thisProcess.interpreter.executeFile(codeRoot +/+ "personalityController.scd");
thisProcess.interpreter.executeFile(codeRoot +/+ "oscController.scd");

// --- room state (same contract as COTF/Glimmer); the piece stays in \idle -----------------
OSCdef(\cosState, { |msg|
    var new = msg[1].asString.asSymbol;
    var old = ~roomState;
    if ([\idle, \tuning, \piece, \curtain, \silent].includes(new).not) {
        "[COS] unknown /airkit/state: %".format(msg[1]).postln;
    } {
        ~roomState = new;
        ~stateCtx[\state] = new;
        block {
            var ctx = (state: new, prevState: old, stateChanged: true);
            ~devices.keysValuesDo { |port, d|
                if (d.env.notNil and: { d.enabled == true }) { d.env.use { ~onRoomState.(ctx) } };
            };
        };
        "[COS] room state: % -> %".format(old, new).postln;
    };
}, '/airkit/state');

OSCdef(\cosGetState, { |msg, time, addr|
    addr.sendMsg("/airkit/state/reply", ~roomState.asString);
}, '/airkit/getState');

s.waitForBoot({
    // --- audio graph ---------------------------------------------------------------------
    // slot bus (private, per device) -> wrist monitor (XFade2 over the wrist's two slots, level)
    //   -> master bus -> master (gain, limiter) -> hardware 0/1.
    // pos: 0 = first slot of the pair, 1 = second. VarLag = a linear ramp that takes exactly
    // posLagT seconds, so a scene's fade time is the fade time.
    SynthDef(\cosWristMonitor, { |inA, inB, out, pos = 0, posLagT = 0.1, level = 1, levelLagT = 0.1, wrist = 0|
        var a = In.ar(inA, 2), b = In.ar(inB, 2);
        var pan = VarLag.kr(pos * 2 - 1, posLagT);
        var sig = XFade2.ar(a, b, pan) * VarLag.kr(level, levelLagT);
        SendPeakRMS.kr(sig, 10, 3, '/cos/meter', wrist);
        Out.ar(out, sig);
    }).add;
    SynthDef(\cosAuditionMonitor, { |in, out, level = 1, levelLagT = 0.1|
        var sig = In.ar(in, 2) * VarLag.kr(level, levelLagT);
        SendPeakRMS.kr(sig, 10, 3, '/cos/meter', 9);
        Out.ar(out, sig);
    }).add;
    SynthDef(\cosMaster, { |in, out = 0, gain = 1, gainLagT = 0.1, limiterOn = 1|
        var sig = In.ar(in, 2) * VarLag.kr(gain, gainLagT);
        var lim = Limiter.ar(sig, 0.891, 0.01); // -1 dBFS ceiling: sticks are near heads and a PA
        sig = Select.ar(limiterOn, [sig, lim]);
        SendPeakRMS.kr(sig, 10, 3, '/cos/meter', 0);
        ReplaceOut.ar(out, sig);
    }).add;
    s.sync;

    // The personality controller hands each device ~outBus = topEnvironment[\cotfSeatBus][d.index].
    // The key name is COTF's; the map is ours, one private stereo bus per slot.
    ~cotfSeatBus = Dictionary();
    ~cosSlotCount.do { |i| ~cotfSeatBus.put(i + 1, Bus.audio(s, 2)) };
    ~cosMasterBus = Bus.audio(s, 2);

    // Monitors at the tail of the default group, master last, so they read what every patch wrote.
    ~cosMonitors = Dictionary();
    ~cosWristOrder.do { |w, i|
        var slots = ~cosWrists[w];
        ~cosWristState.put(w, (pos: 0.0, level: 1.0, fade: 0.1));
        ~cosMonitors.put(w, Synth.tail(s, \cosWristMonitor, [
            \inA, ~cotfSeatBus[slots[0]].index, \inB, ~cotfSeatBus[slots[1]].index,
            \out, ~cosMasterBus.index, \wrist, i + 1
        ]));
    };
    ~cosMonitors.put(\audition, Synth.tail(s, \cosAuditionMonitor, [
        \in, ~cotfSeatBus[~cosAuditionSlot].index, \out, ~cosMasterBus.index
    ]));
    ~cosMasterSynth = Synth.tail(s, \cosMaster, [
        \in, ~cosMasterBus.index, \out, 0, \limiterOn, ~cosLimiterOn.binaryValue
    ]);

    // --- meters: SendPeakRMS replies /cos/meter nodeID replyID peakL rmsL peakR rmsR ------
    OSCdef(\cosMeter, { |msg|
        var id = msg[2].asInteger;
        var key = switch(id, 0, { \master }, 9, { \audition }, { ~cosWristOrder.clipAt(id - 1) });
        var peak = max(msg[3], msg[5]), rms = max(msg[4], msg[6]);
        var cur = ~cosPeaks.at(key) ? [0, 0];
        ~cosPeaks.put(key, [max(cur[0], peak), max(cur[1], rms)]);
    }, '/cos/meter', s.addr);

    // ==== [COS] OSC handlers (Task 4 appends here) ============================================
    // ==== end [COS] OSC handlers =============================================================

    NetAddr.localAddr.sendMsg("/airkit/startOSCListening", NetAddr.langPort);
    "Conditions AirKit up: langPort %, scsynth %, slots %, out device %, limiter %".format(
        NetAddr.langPort, s.addr.port, ~cosSlotCount, s.options.outDevice ? "default", ~cosLimiterOn
    ).postln;
});
)
```

- [ ] **Step 3: Boot it headless on spare ports and confirm readiness**

From the piece repo root:
```bash
mkdir -p ~/.conditions
COS_SCSYNTH_PORT=57131 timeout 150 /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57130 airkit/code3.0/conditions/main_conditions.scd > ~/.conditions/task3-boot.log 2>&1 &
BOOT=$!
for i in $(seq 1 60); do sleep 2; grep -q "Conditions AirKit up" ~/.conditions/task3-boot.log && break; done
grep -E "Conditions AirKit up|ERROR|not understood|FAILURE" ~/.conditions/task3-boot.log | head
node scripts/engine-ping.ts 57130
kill $BOOT; pkill -f "scsynth -u 57131"; sleep 1; pgrep -f "scsynth -u 57131" || echo "scsynth 57131 gone"
```
Expected: the `Conditions AirKit up: langPort 57130, scsynth 57131, slots 9, …` line, no `ERROR`/`not understood`/`FAILURE` lines, the ping prints `/airkit/roster/reply silence COS_Template silence`, `/airkit/seats/reply` (empty args: no devices yet), `/airkit/state/reply idle` (no `/airkit/cos/status/reply` yet — that is Task 4), and `scsynth 57131 gone`. First boot on this laptop can take ~90 s (CoreAudio negotiation); the loop allows 120 s.

- [ ] **Step 4: Commit on the AirKit branch**

```bash
git -C airkit add code3.0/conditions/config.scd code3.0/conditions/main_conditions.scd
git -C airkit commit -m "cos: conditions profile — headless boot, 9 slot buses, wrist crossfade monitors, master limiter, meters, room state"
```

---

### Task 4: `[COS]` OSC handlers and API contract

**Files:**
- Modify: `airkit/code3.0/conditions/main_conditions.scd` (the marked `[COS] OSC handlers` block)
- Modify: `airkit/code3.0/API.md` (append)

**Interfaces:**
- Consumes: everything Task 3 puts in `topEnvironment`.
- Produces OSC (all on the engine's langPort; every `/airkit/cos/*` message records its sender as `~cosRunnerAddr`):

| Address | Args | Effect |
|---|---|---|
| `/airkit/cos/xfade` | `wrist(s) pos(f) fadeSec(f)` | `pos` clipped 0–1, fade ≥ 0.01; sets the wrist monitor `posLagT`, `pos`; mirrors into `~cosWristState` |
| `/airkit/cos/level` | `wrist(s) gain(f) fadeSec(f)` | gain clipped 0–4 |
| `/airkit/cos/master` | `gain(f) fadeSec(f)` | gain clipped 0–4 |
| `/airkit/cos/params` | `slot(i) k v k v …` | stores `~cosSlotParams[slot]` (Event; string values arrive as Symbols); if the slot's device has an env: `~sceneParams = params; ~onSceneParams.(params)` inside it |
| `/airkit/cos/partner` | `slot(i) partnerSlot(i)` | 0 clears; stores `~cosSlotPartner`; if the slot's device has an env, sets its `~partner` to the partner device (or nil) |
| `/airkit/cos/audition` | `wrist(s)` | informational, echoed in status |
| `/airkit/cos/getStatus` | — | reply `/airkit/cos/status/reply <json>` |
| `/airkit/cos/panic` | — | wrists and audition to level 0 over 0.2 s; 0.25 s later `loadPersonality port 0` for every live device |
| `/airkit/cos/levels` | broadcast 10 Hz to `~cosRunnerAddr` | `ZLpeak ZLrms ZRpeak ZRrms CLpeak CLrms CRpeak CRrms audPeak audRms masterPeak masterRms` (floats, linear, max since the previous broadcast) |

  Status JSON shape (one line): `{"slots":[{"slot":1,"name":"COS_Template","tickAgeMs":31},…9 entries; name "" and tickAgeMs -1 when no device],"wrists":{"ZL":{"pos":0.0,"level":1.0,"fade":0.1},…},"master":1.0,"serverCpu":2.3,"limiterOn":1,"audition":null,"state":"idle","deviceCount":9}`.

- [ ] **Step 1: Insert the handlers**

Replace the two marker lines in `main_conditions.scd`
```supercollider
    // ==== [COS] OSC handlers (Task 4 appends here) ============================================
    // ==== end [COS] OSC handlers =============================================================
```
with:
```supercollider
    // ==== [COS] OSC handlers — contract in ../API.md =========================================
    ~cosNoteSender = { |addr| ~cosRunnerAddr = addr };
    ~cosWristKey = { |name|
        var w = name.asString.asSymbol;
        if (~cosWrists[w].isNil) { "[COS] unknown wrist %".format(name).postln; nil } { w };
    };

    OSCdef(\cosXfade, { |msg, time, addr|
        var w = ~cosWristKey.(msg[1]);
        var pos = (msg[2] ? 0).asFloat.clip(0, 1);
        var fade = (msg[3] ? 0.1).asFloat.max(0.01);
        ~cosNoteSender.(addr);
        w !? {
            ~cosWristState[w].pos = pos;
            ~cosWristState[w].fade = fade;
            ~cosMonitors[w].set(\posLagT, fade, \pos, pos);
        };
    }, '/airkit/cos/xfade');

    OSCdef(\cosLevel, { |msg, time, addr|
        var w = ~cosWristKey.(msg[1]);
        var gain = (msg[2] ? 1).asFloat.clip(0, 4);
        var fade = (msg[3] ? 0.1).asFloat.max(0.01);
        ~cosNoteSender.(addr);
        w !? {
            ~cosWristState[w].level = gain;
            ~cosMonitors[w].set(\levelLagT, fade, \level, gain);
        };
    }, '/airkit/cos/level');

    OSCdef(\cosMasterLevel, { |msg, time, addr|
        var gain = (msg[1] ? 1).asFloat.clip(0, 4);
        var fade = (msg[2] ? 0.1).asFloat.max(0.01);
        ~cosNoteSender.(addr);
        ~cosMaster.gain = gain;
        ~cosMasterSynth.set(\gainLagT, fade, \gain, gain);
    }, '/airkit/cos/master');

    OSCdef(\cosParams, { |msg, time, addr|
        var slot = msg[1].asInteger;
        var params = Event.new;
        var d;
        ~cosNoteSender.(addr);
        if (msg.size > 2) {
            msg.copyRange(2, msg.size - 1).clump(2).do { |kv|
                if (kv.size == 2) { params.put(kv[0].asSymbol, kv[1]) };
            };
        };
        ~cosSlotParams.put(slot, params);
        d = ~cosDeviceForSlot.(slot);
        if (d.notNil and: { d.env.notNil }) {
            d.env.use { ~sceneParams = params; ~onSceneParams.(params) };
        };
    }, '/airkit/cos/params');

    OSCdef(\cosPartner, { |msg, time, addr|
        var slot = msg[1].asInteger;
        var partner = (msg[2] ? 0).asInteger;
        var d;
        ~cosNoteSender.(addr);
        if (partner == 0) { ~cosSlotPartner.removeAt(slot) } { ~cosSlotPartner.put(slot, partner) };
        d = ~cosDeviceForSlot.(slot);
        if (d.notNil and: { d.env.notNil }) { d.env[\partner] = ~cosPartnerDevice.(slot) };
    }, '/airkit/cos/partner');

    OSCdef(\cosAudition, { |msg, time, addr|
        ~cosNoteSender.(addr);
        ~cosAuditionWrist = msg[1] !? { |w| w.asString };
    }, '/airkit/cos/audition');

    OSCdef(\cosGetStatus, { |msg, time, addr|
        var now = Main.elapsedTime;
        var slots = (1..~cosSlotCount).collect { |slot|
            var d = ~cosDeviceForSlot.(slot);
            var name = d !? { |x| x.name.asString } ? "";
            var age = d !? { |x| x.lastTick !? { |t| ((now - t) * 1000).round.asInteger } } ? -1;
            "{\"slot\":%,\"name\":\"%\",\"tickAgeMs\":%}".format(slot, name, age)
        };
        var wrists = ~cosWristOrder.collect { |w|
            var st = ~cosWristState[w];
            "\"%\":{\"pos\":%,\"level\":%,\"fade\":%}".format(w, st.pos.asFloat, st.level.asFloat, st.fade.asFloat)
        };
        var audition = ~cosAuditionWrist !? { |w| "\"" ++ w ++ "\"" } ? "null";
        var json = "{\"slots\":[%],\"wrists\":{%},\"master\":%,\"serverCpu\":%,\"limiterOn\":%,\"audition\":%,\"state\":\"%\",\"deviceCount\":%}".format(
            slots.join(","), wrists.join(","), ~cosMaster.gain.asFloat, (s.avgCPU ? 0).round(0.1),
            ~cosLimiterOn.binaryValue, audition, ~roomState, ~devices.size
        );
        ~cosNoteSender.(addr);
        addr.sendMsg("/airkit/cos/status/reply", json);
    }, '/airkit/cos/getStatus');

    OSCdef(\cosPanic, { |msg, time, addr|
        ~cosNoteSender.(addr);
        "[COS] panic: wrists to 0, every device to silence".postln;
        ~cosWristOrder.do { |w|
            ~cosWristState[w].level = 0;
            ~cosMonitors[w].set(\levelLagT, 0.2, \level, 0);
        };
        ~cosMonitors[\audition].set(\levelLagT, 0.2, \level, 0);
        {
            ~devices.keysValuesDo { |port, d|
                NetAddr.localAddr.sendMsg("/airkit/loadPersonality", port, 0);
            };
        }.defer(0.25);
    }, '/airkit/cos/panic');

    // Levels broadcast: 10 Hz to the last runner address, max-hold since the previous send.
    ~cosLevelsRout = Routine {
        loop {
            ~cosRunnerAddr !? { |addr|
                var vals = List.new;
                (~cosWristOrder ++ [\audition, \master]).do { |k|
                    var v = ~cosPeaks.at(k) ? [0, 0];
                    vals.add(v[0].asFloat); vals.add(v[1].asFloat);
                };
                ~cosPeaks = Dictionary();
                addr.sendMsg("/airkit/cos/levels", *vals.asArray);
            };
            0.1.wait;
        }
    }.play(AppClock);
    // ==== end [COS] OSC handlers =============================================================
```

- [ ] **Step 2: Append the contract to API.md**

Append to `airkit/code3.0/API.md`:
```markdown

## [COS] Conditions of Stillness profile — OSC

All on the engine's sclang port (default 57120). Wrist names are the strings `ZL` `ZR` `CL` `CR`;
each wrist owns two slots (ZL 1,2 · ZR 3,4 · CL 5,6 · CR 7,8); slot 9 is the audition slot.
Device port for slot n = 9001 + n − 1 (the runner sends every wrist's IMU from source port 9001
to both of its slots). Every `/airkit/cos/*` message records its sender as the levels target.

| Address | Args | Notes |
|---|---|---|
| `/airkit/cos/xfade` | `wrist pos fadeSec` | `pos` 0 = first slot of the pair, 1 = second (clipped); linear ramp over `fadeSec` (≥ 0.01) |
| `/airkit/cos/level` | `wrist gainLinear fadeSec` | scene level for the wrist, 0–4 |
| `/airkit/cos/master` | `gainLinear fadeSec` | master, 0–4; a Limiter at −1 dBFS follows it (`COS_LIMITER=0` disables) |
| `/airkit/cos/params` | `slot k v k v …` | stored per slot (may precede the device); delivered as `~sceneParams` and `~onSceneParams.(params)` when a patch is loaded; string values arrive as Symbols |
| `/airkit/cos/partner` | `slot partnerSlot` | `0` clears; the slot's patch sees the partner device as `~partner` (set at load via `topEnvironment[\cosPartnerDevice]`, updated live) |
| `/airkit/cos/audition` | `wrist` | informational: which wrist the runner mirrors to slot 9 |
| `/airkit/cos/getStatus` | — | replies `/airkit/cos/status/reply <json>`: `slots[{slot,name,tickAgeMs}]` (name "" / age −1 without a device), `wrists{ZL{pos,level,fade}…}`, `master`, `serverCpu`, `limiterOn`, `audition`, `state`, `deviceCount` |
| `/airkit/cos/levels` | (broadcast, 10 Hz, to the last sender) | `ZLpeak ZLrms ZRpeak ZRrms CLpeak CLrms CRpeak CRrms auditionPeak auditionRms masterPeak masterRms`, linear, max-hold since the previous message |
| `/airkit/cos/panic` | — | every wrist and the audition monitor to level 0 over 0.2 s, then `silence` loaded on every live device; levels stay 0 until the runner re-sends them |

Unchanged upstream calls the runner uses: `/airkit/loadPersonality devicePort index`,
`/airkit/getRoster`, `/airkit/getSeats`, `/airkit/state`, `/airkit/getState`. `unLoadPersonality`
and `reLoadPersonality` remain local-only (sclang's own port); the runner loads `silence` (index 0)
to free a slot.

Personality contract additions (documented for patch authors in the piece repo's profile):
`~sceneParams` (read `topEnvironment[\cosSlotParams][d.index]` in `~init`; implement
`~onSceneParams = { |p| }` for later updates; every patch must run with no params),
`~partner` (nil for one-hand sounds), `~idleNext` is the main tick, `~onRoomState` must still
handle `\silent`.
```

- [ ] **Step 3: Boot on spare ports and exercise every handler with the ping tool plus a scratch sender**

Write `/tmp/cos-task4.ts` (outside the repo):
```ts
import { createSocket } from 'node:dgram';
import { encodeMessage, flattenPacket } from '/Users/ciaran/Documents/ConditionsOfStillness/scripts/lib/osc.ts';
const port = 57130;
const sock = createSocket('udp4');
const got: string[] = [];
sock.on('message', (buf) => { for (const m of flattenPacket(Buffer.from(buf))) got.push(m.address + ' ' + m.args.map(String).join(' ')); });
const send = (a: string, args: (number | string)[] = []) => sock.send(encodeMessage(a, args), port, '127.0.0.1');
sock.bind(0, async () => {
  send('/airkit/cos/xfade', ['ZL', 7, 0]);       // clips to pos 1, fade 0.01
  send('/airkit/cos/xfade', ['Q', 1, 1]);        // unknown wrist
  send('/airkit/cos/level', ['CR', 9, 0.5]);     // clips to 4
  send('/airkit/cos/master', [0.5, 0.1]);
  send('/airkit/cos/params', [7, 'register', 'low', 'density', 0.3]);
  send('/airkit/cos/partner', [1, 3]);
  send('/airkit/cos/audition', ['CL']);
  await new Promise((r) => setTimeout(r, 300));
  send('/airkit/cos/getStatus');
  await new Promise((r) => setTimeout(r, 1500));
  console.log(got.join('\n'));
  sock.close();
});
```
Then:
```bash
COS_SCSYNTH_PORT=57131 timeout 200 /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57130 airkit/code3.0/conditions/main_conditions.scd > ~/.conditions/task4-boot.log 2>&1 &
BOOT=$!
for i in $(seq 1 60); do sleep 2; grep -q "Conditions AirKit up" ~/.conditions/task4-boot.log && break; done
node /tmp/cos-task4.ts
grep -E "unknown wrist|ERROR|not understood|FAILURE" ~/.conditions/task4-boot.log | head
kill $BOOT; pkill -f "scsynth -u 57131"
```
Expected: one `/airkit/cos/status/reply {…}` line whose JSON has `"ZL":{"pos":1.0,"level":1.0,"fade":0.01}`, `"CR":{…"level":4.0…}`, `"master":0.5`, `"audition":"CL"`, `"deviceCount":0`, nine slot entries with `"name":""` and `"tickAgeMs":-1`; at least one `/airkit/cos/levels` line with twelve `0` values (the broadcast starts once a sender is known); the log has exactly one `[COS] unknown wrist Q` line and no `ERROR`/`not understood`/`FAILURE`.

- [ ] **Step 4: Commit on the AirKit branch**

```bash
git -C airkit add code3.0/conditions/main_conditions.scd code3.0/API.md
git -C airkit commit -m "cos: [COS] OSC — xfade, level, master, params, partner, audition, getStatus, levels broadcast, panic; API.md contract"
```

---

### Task 5: `COS_Template` personality

**Files:**
- Create: `airkit/personalities/COS_Template.sc`

**Interfaces:**
- Consumes: `topEnvironment[\cosSlotParams]`, `topEnvironment[\cosPartnerDevice]` (Task 3), `~outBus`, `~model`, `~device` (upstream).
- Produces: the runnable skeleton every piece patch starts from; it sounds when the wrist moves, reads `register` from scene params (`low` | `mid` | `high`, default `mid`), posts one line `[COS_Template] slot % register % partner %` at init (the smoke test greps it), and is silent within 200 ms of unload.

- [ ] **Step 1: Write the template**

`airkit/personalities/COS_Template.sc`:
```supercollider
/*
gestures:    [sway, shake, tilt]
description: Engine skeleton, not a piece sound — a soft two-sine voice whose loudness follows how much the wrist moves and whose note follows tilt; scene param `register` shifts the octave.
internals:   One long-lived Synth (\cosTemplateVoice) reshaped every tick. Gravity-free motion energy drives amp; tilt picks a pentatonic step; ~sceneParams.register chooses the octave; ~partner is read only to post whether a two-hand load happened.
sound:       plain warm sine pair
pitch:       A minor pentatonic; octave from register (low | mid | high)
rhythm:      none — continuous, moves only with gesture
family:      template
params:      register (low|mid|high, default mid)
samples:     none
research:    none — this is the skeleton
*/

// -------------------------------------------------------------------------------------------
// Copy to personalities/COS_<Name>.sc and rewrite. The load-bearing idioms here — keep them:
//   var ob = ~outBus ? 0           capture at file top (nil inside topEnvironment.use)
//   ~init = ~init <> { |d| }        compose, never clobber
//   synth.set(\gate, 0)            release by gate, never .free
//   if (synth.notNil)              a tick can land before ~init has made the synth
//   params at ~init + ~onSceneParams   scene params may arrive before OR after the load
// -------------------------------------------------------------------------------------------

var m = ~model;
var ob = ~outBus ? 0;
var synth;
var register = \mid;

// Gravity-free motion energy: m.accelMass includes gravity (~0.3 flat, ~0.55 tilted), so a
// fixed threshold reads orientation as movement. `grav` follows accelMass slowly; what is left
// is motion: 0 at rest, ~0.3 swaying, 2+ shaken hard.
var grav = 0.35;
var energy = 0;
var track = {
	var x;
	grav = grav + ((m.accelMass - grav) * 0.02);
	x = (m.accelMass - grav).abs * 2;
	energy = if (x > energy) { (0.9 * x) + (0.1 * energy) } { (0.12 * x) + (0.88 * energy) };
	energy
};

var scale = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]; // A minor pentatonic, A3..A5
var octaveFor = { |r| switch(r.asSymbol, \low, { -12 }, \high, { 12 }, { 0 }) };
var applyParams = { |p| p !? { p[\register] !? { |r| register = r.asSymbol } } };

m.gyroFilteredAttack = 0.7;
m.gyroFilteredDecay = 0.7;

// SynthDef names are global to the whole AirKit process: prefix with cos<Name>.
SynthDef(\cosTemplateVoice, { |out = 0, amp = 0, freq = 440, gate = 1, bright = 0.2|
	var env = EnvGen.kr(Env.asr(0.05, 1, 0.15), gate, doneAction: Done.freeSelf);
	var f = freq.lag(0.08);
	var sig = SinOsc.ar(f * [1, 1.004]) + SinOsc.ar(f * 2.001, 0, bright.lag(0.2));
	Out.ar(out, (sig * 0.25 * amp.lagud(0.03, 0.9)).tanh * env);
}).add;

~init = ~init <> { |d|
	// Params and partner may have arrived before this load: read them now.
	applyParams.(topEnvironment[\cosSlotParams] !? { |map| map.at(d.index) });
	~partner = topEnvironment[\cosPartnerDevice] !? { |f| f.(d.index) };
	"[COS_Template] slot % register % partner %".format(
		d.index, register, ~partner !? { |p| p.index } ? "none").postln;
	topEnvironment.use {
		synth = Synth(\cosTemplateVoice, [\out, ob, \amp, 0]);
	};
	d
};

~onSceneParams = { |p| applyParams.(p) };

// Silent within ~200 ms and nothing left behind. Runs async and may overlap the next patch's
// ~init: capture + nil first so a double fire is a no-op.
~deinit = ~deinit <> {
	var sy = synth;
	synth = nil;
	if (sy.notNil) { sy.set(\gate, 0) };
};

// ~33 Hz on AppClock. Cheap arithmetic and .set only: no s.sync, no .wait, no posting.
~idleNext = { |d, ctx|
	var e = track.();
	var amp = e.lincurve(0.03, 1.5, -42, -9, -3);
	var step = m.gyroYFiltered.linlin(-0.8, 0.8, 0, scale.size - 1).round.asInteger;
	if (synth.notNil) {
		synth.set(
			\amp, if (e > 0.03) { amp.dbamp } { 0 },
			\freq, (scale.clipAt(step) + octaveFor.(register)).midicps,
			\bright, e.linlin(0, 2.5, 0.05, 0.6)
		);
	};
};

// The piece stays in \idle; never leave another state dead.
~tuningNext = ~idleNext;
~pieceNext = ~idleNext;
~curtainNext = ~idleNext;

~onRoomState = { |ctx|
	switch (ctx.state,
		\silent, { if (synth.notNil) { synth.set(\amp, 0) } },
		{ }
	);
};

~plotMin = 0;
~plotMax = 3;
~plot = { |d, p| [energy, m.accelMass, grav] };
```

- [ ] **Step 2: Parse-check the file headless**

```bash
printf '(\nvar f = File.open("%s", "r"); var s = f.readAllString; f.close;\ns.compile !? { "PARSE OK".postln } ?? { "PARSE FAIL".postln };\n0.exit;\n)\n' "$PWD/airkit/personalities/COS_Template.sc" > /tmp/cos-parse.scd
timeout 60 /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57139 /tmp/cos-parse.scd 2>&1 | grep -E "PARSE|ERROR" | head -3
```
Expected: `PARSE OK`. (`String:compile` returns nil on a syntax error, printing the error.)

- [ ] **Step 3: Commit on the AirKit branch**

```bash
git -C airkit add personalities/COS_Template.sc
git -C airkit commit -m "cos: COS_Template personality — skeleton with scene params and partner"
```

---

### Task 6: Engine smoke test and `run.sh`

**Files:**
- Create: `scripts/engine-smoke.ts`
- Create: `run.sh`
- Modify: `package.json` (add `"smoke": "node scripts/engine-smoke.ts"`)

**Interfaces:**
- Consumes: Tasks 1–5; `scripts/lib/osc.ts`.
- Produces: `node scripts/engine-smoke.ts [--keep]` — boots the profile on langPort 57130 / scsynth 57131 with `COS_LIMITER=1` and `COS_SAMPLES=<repo>/samples`, drives it with fake sticks from source port 9001, checks every assertion below, prints a PASS/FAIL report, kills what it started (unless `--keep`), exits 0/1. Log at `~/.conditions/smoke.log`. `./run.sh` — starts the engine under a restart loop on the production ports.

- [ ] **Step 1: Write the smoke test**

`scripts/engine-smoke.ts`:
```ts
// Boot the Conditions engine on spare ports, drive it with fake sticks, check the [COS] contract.
// Usage: node scripts/engine-smoke.ts [--keep]   (keeps sclang running afterwards for poking)
import { spawn, spawnSync } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { mkdirSync, openSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { encodeMessage, flattenPacket, type OscMessage } from './lib/osc.ts';

const LANG = 57130, SCSYNTH = 57131, SRC = 9001;
const SCLANG = '/Applications/SuperCollider.app/Contents/MacOS/sclang';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MAIN = join(ROOT, 'airkit/code3.0/conditions/main_conditions.scd');
const LOG = join(homedir(), '.conditions/smoke.log');
const KEEP = process.argv.includes('--keep');

const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? '[ok]' : '[!!]'} ${what}`); if (!ok) failures.push(what); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function killEngine(child: ReturnType<typeof spawn> | null) {
  if (child) child.kill('SIGTERM');
  spawnSync('pkill', ['-f', `scsynth -u ${SCSYNTH}`]);
}

async function main() {
  if (!existsSync(MAIN)) { console.error(`missing ${MAIN}; run ./setup.sh`); process.exit(1); }
  mkdirSync(join(homedir(), '.conditions'), { recursive: true });
  spawnSync('pkill', ['-f', `scsynth -u ${SCSYNTH}`]);
  const logFd = openSync(LOG, 'w');
  const child = spawn(SCLANG, ['-u', String(LANG), MAIN], {
    env: { ...process.env, COS_SCSYNTH_PORT: String(SCSYNTH), COS_LIMITER: '1', COS_SAMPLES: join(ROOT, 'samples') },
    stdio: ['ignore', logFd, logFd],
  });
  const log = () => readFileSync(LOG, 'utf8');

  // control socket (any port) and stick socket (fixed source port 9001)
  const ctl: Socket = createSocket('udp4');
  const sticks: Socket = createSocket('udp4');
  const inbox: OscMessage[] = [];
  ctl.on('message', (buf) => { for (const m of flattenPacket(Buffer.from(buf))) inbox.push(m); });
  await new Promise<void>((r) => ctl.bind(0, r));
  await new Promise<void>((r) => sticks.bind(SRC, r));
  const send = (a: string, args: (number | string)[] = []) => ctl.send(encodeMessage(a, args), LANG, '127.0.0.1');
  const take = (address: string) => { const i = inbox.findIndex((m) => m.address === address); return i < 0 ? null : inbox.splice(i, 1)[0]; };
  const ask = async (a: string, reply: string, ms = 1500) => { send(a); const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = take(reply); if (m) return m; await sleep(20); } return null; };
  const status = async () => { const m = await ask('/airkit/cos/getStatus', '/airkit/cos/status/reply'); return m ? JSON.parse(String(m.args[0])) : null; };
  const seats = async () => { const m = await ask('/airkit/getSeats', '/airkit/seats/reply'); const out: Record<number, string> = {}; if (m) for (let i = 0; i + 1 < m.args.length; i += 2) out[Number(m.args[i])] = String(m.args[i + 1]); return out; };
  const freshLevels = async () => { inbox.splice(0, inbox.length, ...inbox.filter((m) => m.address !== '/airkit/cos/levels')); const t0 = Date.now(); while (Date.now() - t0 < 1500) { const m = take('/airkit/cos/levels'); if (m) return m.args.map(Number); await sleep(20); } return null; };

  // fake sticks: slot n streams /n/IMUFusedData ax ay az qx qy qz qw at ~33 Hz; slot 1 moves when told
  let moving = new Set<number>();
  let t = 0;
  const imu = setInterval(() => {
    t += 0.03;
    for (let n = 1; n <= 9; n++) {
      const az = moving.has(n) ? -9.8 + 4 * Math.sin(2 * Math.PI * 4 * t) : -9.8;
      sticks.send(encodeMessage(`/${n}/IMUFusedData`, [0, 0, az, 0, 0, 0, 1]), LANG, '127.0.0.1');
    }
  }, 30);

  try {
    // 1. boot
    let up = false;
    for (let i = 0; i < 75 && !up; i++) { await sleep(2000); up = log().includes('Conditions AirKit up'); }
    check(up, 'engine boots (Conditions AirKit up within 150 s)');
    if (!up) throw new Error('boot');

    // 2. params/partner BEFORE any device exists (Review Focus 1)
    send('/airkit/cos/params', [7, 'register', 'low']);
    send('/airkit/cos/partner', [7, 5]);

    // 3. devices auto-create from the IMU stream
    let s: Record<number, string> = {};
    for (let i = 0; i < 50 && Object.keys(s).length < 9; i++) { await sleep(200); s = await seats(); }
    check(Object.keys(s).length === 9, `9 devices auto-created (got ${Object.keys(s).length})`);
    check(Object.keys(s).every((p) => Number(p) >= 9001 && Number(p) <= 9009), 'device ports are 9001..9009');
    let st = await status();
    check(st?.deviceCount === 9, 'status.deviceCount === 9 (Review Focus 4)');
    check(st?.slots?.length === 9 && st.slots.every((x: { name: string }) => x.name === 'silence'), 'all nine slots on silence');

    // 4. load the template on slot 7 (params/partner already stored) and slot 1
    send('/airkit/loadPersonality', [9007, 1]);
    send('/airkit/loadPersonality', [9001, 1]);
    for (let i = 0; i < 25; i++) { await sleep(200); s = await seats(); if (s[9007] === 'COS_Template' && s[9001] === 'COS_Template') break; }
    check(s[9007] === 'COS_Template' && s[9001] === 'COS_Template', 'COS_Template loaded on slots 1 and 7');
    await sleep(500);
    check(/\[COS_Template\] slot 7 register low partner 5/.test(log()), 'slot 7 read params and partner sent before it existed (Review Focus 1)');
    check(/\[COS_Template\] slot 1 register mid partner none/.test(log()), 'slot 1 defaults with no params');

    // 5. live param update
    send('/airkit/cos/params', [1, 'register', 'high']);
    await sleep(300);
    st = await status();
    check(st?.slots?.[0]?.tickAgeMs >= 0 && st.slots[0].tickAgeMs < 500, `slot 1 tick is alive (age ${st?.slots?.[0]?.tickAgeMs} ms)`);

    // 6. clamping and unknown wrist (Review Focus 2, 3)
    send('/airkit/cos/xfade', ['Q', 1, 1]);
    send('/airkit/cos/xfade', ['ZL', 7, 0]);
    send('/airkit/cos/level', ['CR', 9, 0]);
    await sleep(300);
    st = await status();
    check(st?.wrists?.ZL?.pos === 1 && st.wrists.ZL.fade === 0.01, 'xfade pos clips to 1 and fade clamps to 0.01');
    check(st?.wrists?.CR?.level === 4, 'level clips to 4');
    check(/\[COS\] unknown wrist Q/.test(log()), 'unknown wrist is reported, not fatal');
    st = await status();
    check(st !== null, 'engine still answers after the bad message');

    // 7. sound: move slot 1's stick with the crossfader on slot 1 -> ZL peaks; fade to slot 2 (silence) -> quiet
    send('/airkit/cos/xfade', ['ZL', 0, 0.1]);
    send('/airkit/cos/level', ['ZL', 1, 0.1]);
    moving = new Set([1]);
    await sleep(2500);
    let lv = await freshLevels();
    check(lv !== null && lv[0] > 0.002, `ZL peaks while slot 1 moves (peak ${lv?.[0]})`);
    check(lv !== null && lv[10] > 0.002, `master peaks too (peak ${lv?.[10]})`);
    send('/airkit/cos/xfade', ['ZL', 1, 1.0]);
    await sleep(2500);
    lv = await freshLevels();
    check(lv !== null && lv[0] < 0.01, `ZL quiet after crossfading to the silent slot (peak ${lv?.[0]})`);
    send('/airkit/cos/xfade', ['ZL', 0, 0.1]);
    await sleep(1500);
    lv = await freshLevels();
    check(lv !== null && lv[0] > 0.002, `ZL loud again after crossfading back (peak ${lv?.[0]})`);

    // 8. panic (Review Focus 5)
    send('/airkit/cos/panic');
    await sleep(1500);
    s = await seats();
    st = await status();
    check(Object.values(s).every((n) => n === 'silence'), 'every device on silence after panic');
    check(st && Object.values(st.wrists).every((w: any) => w.level === 0), 'every wrist level 0 after panic');
    lv = await freshLevels();
    check(lv !== null && lv[0] < 0.01 && lv[10] < 0.01, 'silent after panic');

    // 9. log hygiene
    const bad = log().split('\n').filter((l) => /ERROR|not understood|FAILURE|DoesNotUnderstand/.test(l));
    check(bad.length === 0, `no error lines in the log${bad.length ? ':\n  ' + bad.slice(0, 5).join('\n  ') : ''}`);
  } catch (e) {
    failures.push(String(e));
  } finally {
    clearInterval(imu);
    ctl.close(); sticks.close();
    if (!KEEP) killEngine(child);
  }
  console.log(failures.length === 0 ? `\nSMOKE PASS (log: ${LOG})` : `\nSMOKE FAIL: ${failures.length} check(s) (log: ${LOG})`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
```

- [ ] **Step 2: Add the npm script and run the smoke test**

In `package.json` `scripts`, add `"smoke": "node scripts/engine-smoke.ts"`. Then:
```bash
npm run smoke
```
Expected: every line `[ok]` and `SMOKE PASS`. Failures point at the engine or template; fix the responsible file (the tests are the contract) and rerun. Typical first-run causes: the `Synth` for the template outputs on `ob` but `ob` is 0 because `~cotfSeatBus` was filled after the device loaded (it is filled inside `waitForBoot` before `startOSCListening`, so devices always come later); `SendPeakRMS` argument order; a `nil` in the status format when `s.avgCPU` is nil (the `? 0` guards it).

- [ ] **Step 3: Write `run.sh`**

`run.sh`:
```bash
#!/bin/bash
# Start the Conditions of Stillness engine (AirKit profile on branch AirConditions) under a
# restart loop. Sub-project 3 adds the runner here. Ctrl-C stops sclang and its scsynth.
#   COS_LANGPORT      sclang OSC port   (default 57120)
#   COS_SCSYNTH_PORT  scsynth port      (default 57110)
#   COS_OUT_DEVICE    output device name (default: CoreAudio default; e.g. "MacBook Pro Speakers")
#   COS_LIMITER       1 (default) | 0
#   COS_SAMPLES       samples folder    (default: ./samples)
set -uo pipefail
cd "$(dirname "$0")" || exit 1
SCLANG="/Applications/SuperCollider.app/Contents/MacOS/sclang"
PORT="${COS_LANGPORT:-57120}"
export COS_SCSYNTH_PORT="${COS_SCSYNTH_PORT:-57110}"
export COS_OUT_DEVICE="${COS_OUT_DEVICE:-}"
export COS_LIMITER="${COS_LIMITER:-1}"
export COS_SAMPLES="${COS_SAMPLES:-$PWD/samples}"
MAIN="airkit/code3.0/conditions/main_conditions.scd"
LOG="${COS_AIRKIT_LOG:-$HOME/.conditions/airkit.log}"

[ -x "$SCLANG" ] || { echo "run.sh: SuperCollider not found at $SCLANG" >&2; exit 1; }
[ -f "$MAIN" ] || { echo "run.sh: $MAIN missing — run ./setup.sh first" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
: > "$LOG"

# On Ctrl-C / TERM / exit: kill sclang (our child) and the scsynth it spawned (not our child).
# sclang runs in the background and is wait-ed on so the trap can fire between commands.
trap 'pkill -P $$ 2>/dev/null; pkill -f "scsynth -u $COS_SCSYNTH_PORT" 2>/dev/null; exit' INT TERM EXIT

echo "[engine] log: $LOG · langPort $PORT · scsynth $COS_SCSYNTH_PORT · samples $COS_SAMPLES"
while true; do
  if pgrep -f "scsynth -u $COS_SCSYNTH_PORT" >/dev/null; then
    echo "[engine] stale scsynth on $COS_SCSYNTH_PORT; killing it first"
    pkill -f "scsynth -u $COS_SCSYNTH_PORT"; sleep 1
  fi
  "$SCLANG" -u "$PORT" "$MAIN" > >(tee -a "$LOG") 2>&1 &
  wait "$!"
  echo "[engine] sclang exited ($?); restarting in 3 s"
  sleep 3
done
```
Then `chmod +x run.sh`.

- [ ] **Step 4: Prove `run.sh` starts and stops cleanly on the production ports**

Only if nothing else is using langPort 57120 on this machine (`lsof -iUDP:57120` empty):
```bash
./run.sh > /tmp/cos-run.out 2>&1 &
RUN=$!
for i in $(seq 1 60); do sleep 2; grep -q "Conditions AirKit up" ~/.conditions/airkit.log && break; done
node scripts/engine-ping.ts 57120 | head -3
kill -INT $RUN; sleep 2
pgrep -f "scsynth -u 57110" || echo "scsynth gone"; pgrep -f "main_conditions.scd" || echo "sclang gone"
```
Expected: the ping prints the roster and a status reply; after Ctrl-C both `scsynth gone` and `sclang gone`.

- [ ] **Step 5: Run the whole suite and commit in the piece repo**

```bash
npm test
git add scripts/engine-smoke.ts run.sh package.json
git commit -m "cos engine: end-to-end smoke test with fake sticks; run.sh restart loop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: all tests pass (27 + 4 codec tests).

---

### Task 7: Docs, lock, mirror push

**Files:**
- Modify: `README.md` (Running section)
- Modify: `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md` (§7 note on the template location)
- Modify: `airkit.lock` (`sha=`)

- [ ] **Step 1: Push the AirKit branch to the mirror and record the sha**

```bash
git -C airkit push mirror AirConditions
git -C airkit rev-parse HEAD
```
Edit `airkit.lock`'s `sha=` line to the printed sha. Run `./setup.sh --check` and expect `[ok] airkit-lock: match <7 chars>`.

- [ ] **Step 2: Replace the README's Running section**

Replace
```markdown
## Running
`./run.sh` arrives with sub-project 2 (engine profile). Until then, nothing here makes sound.
```
with
```markdown
## Running
- `./run.sh` — starts the engine (AirKit profile `airkit/code3.0/conditions/main_conditions.scd`)
  under a restart loop; log at `~/.conditions/airkit.log`; Ctrl-C stops sclang and scsynth.
  `COS_OUT_DEVICE="MacBook Pro Speakers" ./run.sh` pins the output device. The runner and the
  Perform/Admin pages arrive with sub-project 3.
- `node scripts/engine-ping.ts` — prints roster, seats, state and `[COS]` status of a running engine.
- `npm run smoke` — boots a private engine on ports 57130/57131, drives it with fake sticks and
  checks the `[COS]` contract end to end (audible for ~10 s). Safe while a real engine runs.
- OSC contract: `airkit/code3.0/API.md`, the `[COS]` sections.
```

- [ ] **Step 3: Note the template location in the spec**

In the spec's §7 "The skill" paragraph, after `write the patch atomically from the profile's `TEMPLATE.sc``, append ` (the runnable skeleton is `airkit/personalities/COS_Template.sc`, built with the engine; the profile points at it rather than keeping a copy)`.

- [ ] **Step 4: Commit and push the piece repo**

```bash
git add README.md docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md airkit.lock
git commit -m "cos engine: README running section, template location in spec, lock follows branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

## Self-review

**Spec §5 coverage:** entry point and config (T3) ✓; stub conductor (T3) ✓; two env edits (T1; the list array sizing was a third necessary edit found in the code, plus the tick timestamp for `tickAgeMs`) ✓; slot table and ports (T3/T6) ✓; audio graph with per-slot buses, wrist monitors with equal-power crossfade and lag, audition monitor, master with limiter (T3) ✓; meters and 10 Hz levels broadcast (T3/T4) ✓; every OSC row of §5 (T4) plus `deviceCount` (Review Focus 4) ✓; patch contract additions (T4 API.md, T5 template) ✓; load-and-fade sequence is runner-driven (sub-project 3) and the engine primitives it needs are all here ✓; §9 `run.sh` (T6) ✓; §10 engine smoke (T6) ✓. Not in scope: crossfade-aware exit rule enforcement (a lint rule, sub-project 4).

**Placeholders:** none. Every code step is complete.

**Type consistency:** `~cosWristState` entries `(pos:, level:, fade:)` in T3 match T4's reads and the status JSON keys; `~cosMonitors` keys are wrist Symbols plus `\audition` in both; `~cosDeviceForSlot`/`~cosPartnerDevice` defined in T3, used in T4 and T5; meter reply IDs (1–4 wrists, 9 audition, 0 master) agree between the SynthDefs and `\cosMeter`; the levels array order in T4 (`ZL ZR CL CR audition master`, peak then rms) matches the indices T6 reads (`lv[0]` ZL peak, `lv[10]` master peak); the template's post line format in T5 matches T6's regexes; `list_conditions.sc` index 1 = `COS_Template` matches T6's `loadPersonality … 1`.

**Review Focus:** all five pinned in T6 (params/partner before device; unknown wrist; clamping; deviceCount; panic), and #4's field is also produced in T4.
