# Engine reference — what a patch runs inside

The contract between a patch and the engine it runs in: environment, lifecycle, hooks, the
additions this profile makes, the gesture model, and what a patch must never do. Companions:
`patterns.md` (idioms with code), `pitfalls.md` (the traps), `research.md` (designing the sound).

**Sources and precedence.** Consolidated from COTF's Patch Lab `BIBLE.md`, Glimmer's `bible.md`,
Steph's `personality_authoring.md` / `concert_p_files.md` and the piece spec (§5, §5.1), then
re-checked line by line against the engine on the `AirConditions` branch (the `airkit/`
worktree). Where a secondary source disagrees with the engine, **the engine wins** and the
disagreement is named below.

**Citation convention.** Engine and corpus citations are written `` `token` (path:line) ``: the
backticked token is a literal substring of that line, and the path is relative to the piece
repo root (`airkit/…` is the AirKit worktree, `patching/corpus/…` the gitignored raw corpus in
the main checkout). `patching/tools/test/citations.test.ts` resolves every such citation and
fails if a line has moved. If one fails, trust the file and fix this document.

---

## 1. Boot, load order, devices

- The profile entry `main_conditions.scd` first runs `executeFile(codeRoot +/+ "conditions" +/+ "config.scd")` (airkit/code3.0/conditions/main_conditions.scd:10),
  which fixes the slot count, `~cosSlotCount = 9` (airkit/code3.0/conditions/config.scd:9), the wrist pairs
  `~cosWrists = (ZL: [1, 2], ZR: [3, 4], CL: [5, 6], CR: [7, 8])` (airkit/code3.0/conditions/config.scd:12),
  the audition slot `~cosAuditionSlot = 9` (airkit/code3.0/conditions/config.scd:14) and the samples root
  `~cosSamples = ("COS_SAMPLES".getenv` (airkit/code3.0/conditions/config.scd:18). Server: `blockSize = 128` (airkit/code3.0/conditions/config.scd:23),
  `s.latency = 0.05` (airkit/code3.0/conditions/config.scd:27).
- It then stubs the conductor — `~roomState = \idle;` (airkit/code3.0/conditions/main_conditions.scd:13), a static
  `~stateCtx = (` (airkit/code3.0/conditions/main_conditions.scd:17), `~beatClock = TempoClock.new(2).permanent_(true);` (airkit/code3.0/conditions/main_conditions.scd:22)
  and an empty `~onResync = { |idx| };` (airkit/code3.0/conditions/main_conditions.scd:24) — and loads the two shared
  controllers in the usual order: `"personalityController.scd"` (airkit/code3.0/conditions/main_conditions.scd:44)
  then `"oscController.scd"` (airkit/code3.0/conditions/main_conditions.scd:45). **No `conductorController`**: the beat
  hooks (`~onTick` … `~onScale`) are never dispatched, `ctx.voicePool` is always `[69]`, the
  score features are 0. A patch carries its own pitch world and its own time.
- A device is created only when its first IMU packet arrives: `addDevice.(addr.ip,addr.port+i,i+1)` (airkit/code3.0/oscController.scd:429),
  so device port = sender's source port + (N − 1) and `d.index` = N, for up to
  `numAirwareVirtualDevices = ` (airkit/code3.0/oscController.scd:12) nine slots. A new device immediately loads index 0:
  `sendMsg("/airkit/loadPersonality", port, 0)` (airkit/code3.0/oscController.scd:393) — `silence`.

## 2. The environment a patch is interpreted into

One `.sc` file, interpreted into a fresh `Environment` per device on every load:
`Environment.make {` (airkit/code3.0/personalityController.scd:107). Before your text runs the controller installs
`~filePath = path.asAbsolutePath` (airkit/code3.0/personalityController.scd:108), `~model = (` (airkit/code3.0/personalityController.scd:111), `~device = d;` (airkit/code3.0/personalityController.scd:151),
`~secs = 0.03` (airkit/code3.0/personalityController.scd:154), `~outBus = topEnvironment.at(\cotfSeatBus)` (airkit/code3.0/personalityController.scd:162),
`~processDeviceData = {` (airkit/code3.0/personalityController.scd:168), default `~init = {` (airkit/code3.0/personalityController.scd:240) and `~deinit = {` (airkit/code3.0/personalityController.scd:246), and every hook stub.
Then **your file body runs** at `interpret(str);` (airkit/code3.0/personalityController.scd:291), and only after it
`~smooth= {` (airkit/code3.0/personalityController.scd:294) and `~slope = {` (airkit/code3.0/personalityController.scd:301) are installed — so they are nil
at file-body time and usable only inside hooks.

- `var x` at file top is lexical state captured by every closure you assign: that is per-slot
  state. Nine slots running your patch are nine copies. Shared across all of them (global to
  sclang): SynthDef names, `Pdef`/`Ndef`/`Tdef` keys, `Event.eventTypes`, `topEnvironment`,
  and `~model.com`, which is one Event for every device: `var com = (` (airkit/code3.0/personalityController.scd:41),
  `\com: com` (airkit/code3.0/personalityController.scd:112). Old patches coordinate through `m.com`; here it would
  leak between wrists and scenes — use `~partner` instead.
- `~model.ptn` is a random 16-letter key per env, `\ptn: Array.fill(16` (airkit/code3.0/personalityController.scd:114):
  key every `Pdef` and custom event type with it.
- `~outBus`: under this profile `~cotfSeatBus.put(i + 1, Bus.audio(s, 2))` (airkit/code3.0/conditions/main_conditions.scd:105)
  gives every slot a private stereo bus; the wrist monitor crossfades the two slot buses,
  `XFade2.ar(a, b, pan)` (airkit/code3.0/conditions/main_conditions.scd:83), and sums into the master. Capture it at file
  top (`var ob = ~outBus ? 0;`) — inside `topEnvironment.use` your `~outBus` is nil — and never
  assign it. The template's first comment block states this: `var ob = ~outBus ? 0` (airkit/personalities/COS_Template.sc:16).
- `ctx` for state ticks is `topEnvironment[\stateCtx]`, a stub whose only changing field is `state` (`~stateCtx[\state] = new;` (airkit/code3.0/conditions/main_conditions.scd:55)); `~beatClock` runs at
  2 beats/s, so the upstream one-bar quant (`~scoreBeatsPerBar * ~scoreEventsPerBeat` = 8 beats)
  waits up to **4 s** before a pattern starts. Use a small quant (derived from the stub values).
- Hooks that exist but never fire here: the nine beat hooks and `~onResync` — both are
  dispatched by the conductor, which is not loaded; the COTF capture path also needs
  `var disp = topEnvironment[\cotfResyncDispatcher]` (airkit/code3.0/personalityController.scd:370), which this profile never
  defines. Installing `~onResync` is harmless (a Pdef patch lent to COTF
  needs it); relying on it is not.

## 3. Load, `~init`, `~deinit`

`loadPersonality` does, in order (a load onto a port with no device throws at
`var d = ~devices.at(port);` (airkit/code3.0/personalityController.scd:381), spec §5.1):

1. Re-reads the roster file every time: `loadPersonalityList.(d.index-1)` (airkit/code3.0/personalityController.scd:382).
2. Stamps `d.loadAt = Main.elapsedTime` (airkit/code3.0/personalityController.scd:389) and stops the old tick loop:
   `d.procRout.stop;` (airkit/code3.0/personalityController.scd:393).
3. Runs the **old** env's `~deinit.();` (airkit/code3.0/personalityController.scd:402) in a Routine after an `s.sync` —
   **asynchronous, not awaited**; it can overlap the new patch's `~init`.
4. Picks the entry: `index = index.mod(devicePersonalityList.size-1)` (airkit/code3.0/personalityController.scd:412) — the
   last roster entry is unreachable, hence the trailing `silence` sentinel.
5. Builds the new env: `d.env = interpretPersonality.(d);` (airkit/code3.0/personalityController.scd:417) — your file body
   runs here, synchronously, on the OSC thread.
6. Runs the new `~init.(d);` (airkit/code3.0/personalityController.scd:425) in its own Routine, again after an `s.sync`
   (so `s.sync` and waits are legal inside `~init`), then stamps
   `d.initAt = Main.elapsedTime; d.initEnv = currentEnvironment;` (airkit/code3.0/personalityController.scd:428).
7. Starts the tick loop **immediately**: `d.procRout.reset.play(AppClock);` (airkit/code3.0/personalityController.scd:436) —
   before `~init` has run. The first ticks see your synth as nil.

`ready` in `getStatus` is `d.initEnv === d.env` (airkit/code3.0/conditions/main_conditions.scd:233): loaded ≠ ready.
Hot reload: every tick compares `File.mtime(~filePath)` (airkit/code3.0/personalityController.scd:317) and reloads on any
change — a half-written file is interpreted, so every write is temp-then-rename.
`unLoadPersonality`/`reLoadPersonality` are local-only (`NetAddr("127.0.0.1", NetAddr.langPort)` (airkit/code3.0/personalityController.scd:569)); the runner frees a slot by loading `silence`.

**Contract** (spec §5): compose, never clobber — `~init = ~init <> { |d| … }` and
`~deinit = ~deinit <> { … }`; release long-lived synths with `.set(\gate, 0)`, never `.free`;
capture refs and nil the vars first so a double fire is a no-op, as the template does:
`var sy = synth;` (airkit/personalities/COS_Template.sc:74); **silent within ~200 ms of `~deinit`** (the audition
checks silence within 1 s of the unload, on the meter's **rms** — its peak has a 3 s display lag, `SendPeakRMS.kr(sig, 10, 3` (airkit/code3.0/conditions/main_conditions.scd:89)); buffers freed last, after release tails.

## 4. The tick

`createProcRout` loops `d.env.use{` (airkit/code3.0/personalityController.scd:316) while `if(d.enabled == true` (airkit/code3.0/personalityController.scd:322):

1. `~processDeviceData.(d);` (airkit/code3.0/personalityController.scd:324) — raw sensors → `~model` (§7);
2. `d.lastTick = Main.elapsedTime;` (airkit/code3.0/personalityController.scd:327) — what `tickAgeMs` reports;
3. `~next.(d);` (airkit/code3.0/personalityController.scd:329) — unconditional, no default (nil.value is harmless);
4. the state tick for `topEnvironment[\roomState]`, with `var ctx = topEnvironment[\stateCtx];` (airkit/code3.0/personalityController.scd:339):
   here always `\idle,    { ~idleNext.(d, ctx) }` (airkit/code3.0/personalityController.scd:341);
5. `(~secs.()).yield;` (airkit/code3.0/personalityController.scd:348) — ~33 Hz on **AppClock**.

An uncaught error in any hook body ends this Routine: the slot freezes on its last `.set`
values, `tickAgeMs` grows, nothing else notices. `nil.set(...)` is the classic cause. The tick
never blocks (`s.sync`, `.wait`, `.yield`, `Buffer.read`, `SynthDef`) and never posts except on
change. Don't touch `~secs`: nine slots tick at once.

## 5. The `[COS]` additions

### 5.1 Scene parameters — may arrive before *or* after the load

- `/airkit/cos/params slot k v …` is stored per slot whether or not a device or patch exists:
  `~cosSlotParams.put(slot, params);` (airkit/code3.0/conditions/main_conditions.scd:194). Keys are Symbols,
  `params.put(kv[0].asSymbol, kv[1])` (airkit/code3.0/conditions/main_conditions.scd:191); numbers stay numbers and
  `string values arrive as Symbols` (airkit/code3.0/API.md:203).
- If the slot has an env the handler also runs `~sceneParams = params; ~onSceneParams.(params)` (airkit/code3.0/conditions/main_conditions.scd:197).
- So a patch reads them twice: in `~init` from `topEnvironment[\cosSlotParams]`, as
  `applyParams.(topEnvironment[\cosSlotParams]` (airkit/personalities/COS_Template.sc:58), and in the hook,
  `~onSceneParams = { |p| applyParams.(p) };` (airkit/personalities/COS_Template.sc:69). The map entry may be absent (nil)
  or an empty Event; absent keys mean defaults; **every patch must run with no params**.
- Timing (spec §5.1): `~onSceneParams` exists from file-body time, so an update can reach a new
  env **before its `~init` has run**, and — because the runner sends params before the load —
  the **old** patch on a standby slot can receive the next scene's params just before it is
  replaced. Store values in vars; guard every synth reference inside the hook.
- Values persist per slot across loads; the runner always re-sends params (empty is fine) before
  every load. Recommended keys and ranges are in the profile (`register`, `density`,
  `brightness`, `pitchset`, `rate`, `wet`).

### 5.2 `~partner` and two-hand patches

- `/airkit/cos/partner slot partnerSlot` stores `~cosSlotPartner.put(slot, partner)` (airkit/code3.0/conditions/main_conditions.scd:206)
  and, if the slot has an env, sets `d.env[\partner] = ~cosPartnerDevice.(slot)` (airkit/code3.0/conditions/main_conditions.scd:208).
  A fresh env has no `~partner` until `~init` reads it:
  `~partner = topEnvironment[\cosPartnerDevice]` (airkit/personalities/COS_Template.sc:60). The helper works from inside
  a device env because it wraps itself in `topEnvironment.use` (airkit/code3.0/conditions/main_conditions.scd:41).
- `~partner` is a **device** Event (`~partner.sensors.*`, `~partner.index`), nil for one-hand
  patches, nil before `~init`, nil again after `partner slot 0`. Lint `partner.guard` requires a
  guard on every `~partner.env[\model]` read in a `2H` patch and forbids dereferencing it in any
  other.
- **Engine wins over spec §5**: §5 says the partner's `~model` is not available; §5.1 corrects it.
  Every device runs at least `silence` from creation, so `~partner.env[\model]` always exists
  while `~partner` is set — but that env is **replaced whenever the partner slot reloads**:
  re-read it every tick, never cache it.
- The partner's `*Filtered` fields use whatever coefficients the partner's own patch set;
  `silence` itself sets `m.accelMassFilteredAttack = 0.7;` (airkit/personalities/silence.sc:3). A `2H` patch that
  wants predictable smoothing reads raw `accelMass` / gyro angles and smooths them itself.
- The profile's shape: a `2H` patch loads on the left-wrist slot with `~partner` = the right
  wrist's device, whose own slot runs `silence`.

### 5.3 Room state

`~roomState` starts `\idle` and the runner keeps it there; `~idleNext` is the patch. The engine
still accepts `/airkit/state` — `[\idle, \tuning, \piece, \curtain, \silent].includes(new)` (airkit/code3.0/conditions/main_conditions.scd:51) —
and dispatches `d.env.use { ~onRoomState.(ctx) }` (airkit/code3.0/conditions/main_conditions.scd:59) with
`ctx = (state: new, prevState: old, stateChanged: true)` (airkit/code3.0/conditions/main_conditions.scd:57): an edge that may
repeat the same state. `\silent` has no tick, `// note: \silent has no per-tick hook` (airkit/code3.0/personalityController.scd:286):
mute one-shot in `~onRoomState` (lint `state.silent-unhandled`). While `\silent`, no state tick
runs at all, and a patch **loaded** during `\silent` never gets the edge — if that matters, seed
the mute in `~init` from `topEnvironment[\roomState]`. Alias the other ticks to `~idleNext`
(lint `state.idle-alias`), as `~tuningNext = ~idleNext;` (airkit/personalities/COS_Template.sc:94).

### 5.4 Slot pairs, standby preload, crossfade-aware exit

- Each wrist owns two slots; the runner forwards that wrist's IMU to both at all times, sent
  `to both of its slots` (airkit/code3.0/API.md:193). The monitor's `XFade2` over `pos` decides which one the room
  hears; `VarLag.kr(pos * 2 - 1, posLagT)` (airkit/code3.0/conditions/main_conditions.scd:82) makes a scene's fade a linear ramp.
- The runner preloads the next scene's sound into the **standby** slot (the side the crossfader
  is not on, so it is inaudible), waits for `ready`, crossfades, then loads `silence` on the
  outgoing slot (spec §5 load sequence). Consequences for a patch:
  - it ticks at full rate on the performer's real motion for as long as it waits unheard, so it
    must be **cheap when unheard** — idle CPU is eight live patches (spec §5.1);
  - nothing may accumulate while unheard that bursts on first hearing: unbounded integrators,
    queued one-shots, a feedback or reverb loop charged by minutes of input, a Pdef backlog;
  - during the fade both slots sound; after it, the old patch gets `~deinit` and must be silent
    within ~200 ms.
- Panic: every wrist level to 0 over 0.2 s, then `silence` on every device —
  `NetAddr.localAddr.sendMsg("/airkit/loadPersonality", port, 0)` (airkit/code3.0/conditions/main_conditions.scd:260).

### 5.5 The audition slot (9)

Slot 9 has its own plain-gain monitor, `SynthDef(\cosAuditionMonitor` (airkit/code3.0/conditions/main_conditions.scd:87). The
runner mirrors a wrist there (device port 9009); `patch-audition.ts` sends from its own source
port so its device is 9109 with index 9 — same `~outBus`, same monitor. With two index-9 devices,
`~cosDeviceForSlot` returns an arbitrary one of the index-9 devices (Dictionary order), `~devices.values.detect { |d| d.index == slot }` (airkit/code3.0/conditions/main_conditions.scd:40),
so a live params update may reach the other one; params stored before the load are read by
whichever loads.

## 6. Header

Ten keys, one line each, in the leading `/* … */` block (lint `header.keys`; `internals` and
`research` warn only): `gestures`, `description`, `internals`, `sound`, `pitch`, `rhythm`,
`family`, `params`, `samples`, `research`. `gestures:` is a bracketed list from the profile's
vocabulary (lint `header.gestures-grammar`). Shape: `gestures:    [sway, shake, tilt]` (airkit/personalities/COS_Template.sc:2).
One-line guidance per key: `assets/header-template.txt`.

## 7. The gesture model

### 7.1 Raw, on `d.sensors` (per packet, on the OSC thread)

- `accelEvent`: `\x:msg[1].asFloat * 0.1` (airkit/code3.0/oscController.scd:286) — **gravity included**.
- `quatEvent`: `sensors.quatEvent = (` (airkit/code3.0/oscController.scd:292) from `qx qy qz qw`.
- `gyroEvent`: Euler angles in radians from the quaternion, `sensors.gyroEvent = (` (airkit/code3.0/oscController.scd:316):
  x roll ±π, y pitch ±π/2 (clamped at `// gimbal lock handling` (airkit/code3.0/oscController.scd:208)), z yaw ±π.
- `rrateEvent`: the wrapped change of each Euler angle **per packet**, `\x:angleDiff.value(rx, ox)` (airkit/code3.0/oscController.scd:329)
  — radians per packet, not per tick, so its scale follows the packet rate. Two rates, often
  confused: a stick streams packets at ~100 Hz, `~100 Hz IMU stream` (airkit/code3.0/API.md:28);
  the engine *ticks* at ~33 Hz (§4). `patching/profile.md` once gave "~33 Hz" as the stream
  rate — that is the tick. Measure the packet rate with takes. Near vertical, roll and yaw swing fast (gimbal
  lock): clamp rotation-rate inputs.
- `velocity`: a leaky integral, `sensors.velocity, 0.3);` (airkit/code3.0/oscController.scd:349) — drifty; unused by anything.
- Calibration: `/airkit/calibrate` is local-only, `'/airkit/calibrate', NetAddr("127.0.0.1"` (airkit/code3.0/oscController.scd:467); when set,
  `qe = quatMul.value(qRefInv, qe)` (airkit/code3.0/oscController.scd:307) makes the Euler angles relative. The runner never
  calibrates, and `quatCalibrated = q;` (airkit/code3.0/oscController.scd:308) stores an undeclared interpreter
  variable — never read `quatCalibrated`, never rely on calibration.
- `d.sensorBus` is one Bus for every device — `\sensorBus: Bus.control(s,7),` (airkit/code3.0/oscController.scd:79) sits in
  the shared prototype and `addDevice` never replaces it — so it carries whichever stick sent
  last. Don't read it.

### 7.2 Derived every tick into `~model`

Smoothing: `~smooth` is a one-pole with separate rise and fall weights —
`if(history > input, {coeff = decay});` (airkit/code3.0/personalityController.scd:296), then `c·in + (1−c)·history`. `c` is the
weight on the new value per tick, so at ~33 Hz the time constant is −0.03 s / ln(1 − c):
c = 0.9 → 13 ms, 0.7 → 25 ms, 0.1 → 0.28 s, 0.02 → 1.5 s (derived). Set the knobs at file top.

| field | derivation | range (derived) |
|---|---|---|
| `accelMass` | accel sumabs × 0.33 | ≈ 0.32 flat, up to ≈ 0.56 tilted, at rest (gravity); 2+ shaken hard |
| `accelMassFiltered` | smoothed; default attack 0.9 / decay 0.7 | same |
| `rrateMass`, `rrateMassFiltered` | sumabs of `rrateEvent` | ≈ 0 still; radians per packet |
| `rrateX/Y/ZMass` (+`Filtered`) | one axis, abs; shares the rrate coefficients | — |
| `gyroXFiltered` | roll / π | −1…1, wraps at ±1 |
| `gyroYFiltered` | pitch / (π/2) | −1…1, the most legible continuous control |
| `gyroZFiltered` | yaw / π | −1…1, arbitrary zero, wraps |

Lines: `accelMass = d.sensors.accelEvent.sumabs * 0.33` (airkit/code3.0/personalityController.scd:169),
`rrateMass = d.sensors.rrateEvent.sumabs` (airkit/code3.0/personalityController.scd:170), `rrateXMass = d.sensors.rrateEvent.x.abs` (airkit/code3.0/personalityController.scd:184),
`d.sensors.gyroEvent.x / pi,` (airkit/code3.0/personalityController.scd:207), `d.sensors.gyroEvent.y / pi.half,` (airkit/code3.0/personalityController.scd:213),
`d.sensors.gyroEvent.z / pi,` (airkit/code3.0/personalityController.scd:220); defaults `\accelMassFilteredAttack: 0.9,` (airkit/code3.0/personalityController.scd:133),
`\accelMassFilteredDecay: 0.7,` (airkit/code3.0/personalityController.scd:134), `\gyroFilteredAttack: 0.9,` (airkit/code3.0/personalityController.scd:142).

The at-rest numbers assume the stick sends m/s² (9.81 × 0.1 × 0.33 × 1…√3); the template says
the same, `m.accelMass includes gravity (~0.3 flat, ~0.55 tilted)` (airkit/personalities/COS_Template.sc:28). So a fixed
threshold on `accelMass` reads *orientation* as motion. Use the template's gravity-free
`energy` — `grav = grav + ((m.accelMass - grav) * 0.02);` (airkit/personalities/COS_Template.sc:35) — 0 at rest in any
orientation, ~0.3 swaying, 2+ shaken hard. Smoothing an angle across its ±1 wrap sweeps
through 0: unwrap or use rates for yaw and for roll near ±π.

For this piece: piano playing is small, fast vertical accelerations with wrist turn on rolled
chords; a tremolo is sustained low-amplitude high-rate shake; a drum stroke is a spike plus
rebound; damping is sudden stillness after a stroke; the non-playing hand is often still.
Calibrate thresholds on recorded takes (`takes/INDEX.md`), not on guesses.

## 8. What a patch must never do

| never | why | lint |
|---|---|---|
| `s.sync`, `.wait`, `.yield`, `Buffer.read`, `SynthDef(` in a tick | stalls or kills the AppClock tick | `tick.blocking` |
| post every tick | floods the log for all nine slots | `tick.posting` (warn) |
| a literal or absolute path (`"/Users/…"`, `"~/…"`) | resolves on one machine only | `banned.abs-path` |
| `Buffer.read*` from anything but `topEnvironment[\cosSamples]` / `~cosSamples` | samples live under the piece's `samples/` | `sample.manifest` |
| `s.boot/quit/freeAll`, `Server.killAll`, `CmdPeriod.run`, `0.exit` | kills every slot and the monitors; run.sh restarts | `banned.server-control` |
| write `topEnvironment[…]`, `~cos…`, `~devices` | engine state shared by every slot | `banned.global-write` |
| assign `~outBus` | breaks the slot's routing | `banned.outbus-rewire` |
| dereference `~partner` in a one-hand patch; unguarded `~partner.env[\model]` in a `2H` | nil outside a `2H` load and before `~init` | `partner.guard`, `name.two-hand` |
| read scene params without `~onSceneParams` | later scene changes ignored | `hooks.scene-params` |
| unprefixed / duplicated / colliding SynthDef names | global, last load wins for every slot | `synthdef.prefix`, `synthdef.duplicate`, `synthdef.collision` |
| a literal `Pdef(\name)` key | shared by every slot running the patch | `pdef.literal-name` (warn) |
| a class this machine cannot compile | "Class not defined" on every load | `class.unknown` |
| skip `~init`/`~deinit`/`~onRoomState`/`~idleNext`, or `\silent` | lifecycle contract | `hooks.required`, `state.silent-unhandled` |

Reads that are allowed from `topEnvironment`: `\cosSlotParams`, `\cosPartnerDevice`,
`\cosSamples`, `\roomState`, `\stateCtx`, `\beatClock` (for a clock, inside
`topEnvironment.use`). Nothing a patch owns is ever written there.
