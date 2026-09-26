# AirStick OSC Recorder — Design

- **Date:** 2026-06-14
- **Status:** Approved (design); pending implementation plan
- **Author:** Ciaran + Claude (brainstorming)

## 1. Summary

A browser-based tool that connects directly to AirStick devices over Bluetooth Low
Energy, captures their 100 Hz fused IMU stream, and records labelled "takes" to disk
as timestamped OSC dumps — replacing the **AirWare** macOS app for the
record-and-export workflow. Runs entirely in Chrome/Edge via the Web Bluetooth API;
no installed application, no Mac GUI app in the loop.

The visual design is the approved **"Lab Dashboard"** direction: a clean, data-forward
single screen showing live orientation and signal charts for one or two sticks, with a
transport bar and a list of recorded takes.

## 2. Goals & Non-Goals

### In scope
- Connect to **one or two** AirSticks simultaneously over BLE (Left `/1`, Right `/2`).
- Subscribe to the IMU Fused Data notify characteristic and decode each 20-byte frame.
- Live visualisation: 3D orientation per stick + live signal charts.
- Record synchronized **takes** (both sticks on one shared timeline).
- On stop, prompt to **name + describe** the take before storing it.
- Persist takes locally (IndexedDB) and export each as a **timestamped OSC dump**.
- OSC addresses + arguments **match AirWare** for the in-scope variables.

### In-scope OSC variables (the exactly-reproducible set)
These derive directly from the BLE stream with no undocumented DSP:
- **IMU Fused Data Frame** — the raw 20-byte frame forwarded as-is.
- **Quaternion** (w, x, y, z) — decoded from Q14.
- **Linear acceleration** (x, y, z) — decoded from raw int16.
- **Euler angles** (roll, pitch, yaw) — derived from the quaternion.

### Out of scope (this project)
- **Live OSC/UDP routing** to Max/Ableton in real time. Browsers cannot emit raw UDP;
  this would require a small local WebSocket→UDP bridge. Deferred — see §11.
- AirWare's **derived analysis variables**: linear-accel energy / energy ABS /
  directional ratios / directional raw, roll in-out, roll velocity, peg distances,
  peg energy, axis sliders. These require reverse-engineering AirWare's Swift DSP to
  bit-match and are explicitly excluded. See §11.
- Gyro / magnetometer streams — the firmware never enables these reports, so AirWare's
  charts for them are dead in this build. Nothing to capture.
- Writing the **command characteristic** (LED colour, rename, firmware version). Read-only
  consumer; we never configure the stick.
- Safari / Firefox support (no Web Bluetooth — see §10).

## 3. Background — the device contract

The AirStick is an **ESP32-S3 + BNO08x** running NimBLE firmware
(`AirStickCore-BLE-main/`). It communicates **only over BLE GATT** — it has no
networking and emits no OSC itself. AirWare is what currently bridges BLE → OSC on the
Mac. This tool replaces that bridge for recording.

Facts read directly from the firmware:

| Item | Value | Source |
|---|---|---|
| Service UUID | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` | `main/ble.h` `AIRSTICK_SVC_UUID` |
| IMU Fused Data char UUID | `beb5483e-36e1-4688-b7f5-ea07361b26a8` | `main/ble.h` `IMU_FUSEDDATA_CHR_UUID` |
| IMU char properties | **NOTIFY only** (subscribe via CCCD) | `main/gatt_svr.c` |
| Update rate | **100 Hz** (10 ms notify task) | `main/main.c` `imu_notify_task` |
| Payload size | 20 bytes | `imu_bno08x.h` `IMU_FUSEDDATA_CHAR_SIZE` |
| Battery service | `0x180F` / level `0x2A19` (READ + NOTIFY) | `main/gatt_svr.c` |
| Advertised name | device id string, default `"Stick"`, renameable | `main/main.c` |
| Advertised 128-bit service UUID | yes (used for scan filter) | `main/main.c` adv fields |

### Frame layout (20 bytes, little-endian `int16`)

| Bytes | Field | Decode to float |
|---|---|---|
| 0–1 | quaternion **W** | `raw / 16384.0` (Q14) |
| 2–3 | quaternion **X** | `raw / 16384.0` |
| 4–5 | quaternion **Y** | `raw / 16384.0` |
| 6–7 | quaternion **Z** | `raw / 16384.0` |
| 8–9 | linear accel **X** | raw int16 × accel scale (Q-point, see §6) |
| 10–11 | linear accel **Y** | raw int16 × accel scale |
| 12–13 | linear accel **Z** | raw int16 × accel scale |
| 14–19 | reserved | zeros |

Quaternion Q14 is confirmed by the firmware's world-rotation constant
(`s_qWorld.z = -11585 ≈ -0.70710678 × 16384`). Note byte order is **W, X, Y, Z** in the
payload. The firmware also applies axis swaps/inversions and an optional world-frame
rotation before transmitting (`imu_bno08x.cpp`), so the bytes on the wire are already in
AirStick's intended output frame — we decode them verbatim and do **not** re-transform.

## 4. Architecture

Single-page web app, no backend. All logic client-side in the browser.

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Chrome/Edge)                                       │
│                                                              │
│  ConnectionManager ──┬── StickConnection (/1)  Web Bluetooth │
│   (≤2 devices)       └── StickConnection (/2)  GATT notify   │
│         │                                                    │
│         ▼ decoded frames {t, qwxyz, axyz}                    │
│  FrameDecoder ───────────────────────────────────────────►  │
│         │                            │                       │
│         ▼ (live)                     ▼ (when recording)      │
│  Visualisation                   RecordingEngine             │
│  (3D + charts)                   (per-take buffer, app clock)│
│                                       │                      │
│                                       ▼ on stop + Save        │
│                                  TakeStore (IndexedDB)        │
│                                       │                      │
│                                       ▼ on Export            │
│                                  OscExporter → .osc file      │
└────────────────────────────────────────────────────────────┘
```

### Components (each independently testable)

1. **ConnectionManager** — owns up to two `StickConnection`s; assigns OSC ids (`/1`, `/2`)
   by connection order; surfaces connect/disconnect/reconnect; aggregates status.
2. **StickConnection** — wraps one BLE device: `requestDevice` (scan-filtered by service
   UUID), GATT connect, subscribe to the IMU notify characteristic, also read/subscribe
   battery. Emits raw 20-byte buffers with an arrival timestamp. Handles GATT
   disconnect events.
3. **FrameDecoder** — pure function: `Uint8Array(20) → {qw,qx,qy,qz, ax,ay,az}` (floats),
   plus `quatToEuler()`. No I/O; fully unit-testable against known byte vectors.
4. **RecordingEngine** — on record, buffers decoded frames per stick tagged with a
   monotonic app timestamp; tracks duration, frame counts, measured rate, dropped/
   gapped frames. Produces an in-memory `Take` on stop.
5. **TakeStore** — IndexedDB persistence of `Take` records (metadata + frame arrays).
   List, rename, delete, load.
6. **OscExporter** — serialises a `Take` to an OSC 1.0 binary dump (§7).
7. **UI (Lab Dashboard)** — header (device chips, status, OSC setup), orientation stage,
   live charts, transport, take list, save-take modal, OSC setup panel.

## 5. Data model

```
Take {
  id, name, description, createdAt,
  rate: 100,                       // nominal
  sticks: ["1", "2"],              // OSC ids present
  durationMs,
  frames: {
    "1": [ Frame, Frame, ... ],
    "2": [ Frame, Frame, ... ],
  }
}
Frame {
  t,                                // ms from take start (app arrival clock)
  raw: Uint8Array(20),             // kept verbatim for the Fused Frame export
  qw, qx, qy, qz,                  // decoded floats
  ax, ay, az,                      // decoded floats
}
```

`raw` is retained so the **IMU Fused Data Frame** OSC variable is a byte-exact passthrough,
independent of our float decode.

### Timing model (stated honestly)
The two sticks are **independent BLE connections**; the 20-byte payload carries **no
frame counter or device timestamp**. Take timing therefore uses the **app's arrival
timestamp** per frame, not a firmware clock. At 100 Hz this is fine for performance
capture, but cross-stick alignment is at BLE-arrival precision (single-digit ms jitter),
not sub-frame. The export preserves each frame's actual arrival time rather than snapping
to a 10 ms grid.

## 6. Decode math

- **Quaternion:** `f = int16 / 16384.0` for each of w,x,y,z.
- **Euler (from quaternion, radians→degrees):** standard ZYX/aerospace conversion;
  exact convention (order + handedness) to be matched to AirWare during the capture in §8
  so roll/pitch/yaw signs agree.
- **Linear acceleration scale:** the BNO08x reports linear acceleration with a Q-point of
  **8** (`f = int16 / 256.0`, m/s²) per the SH-2 spec. **To confirm** against an AirWare
  capture (§8) since "match AirWare exactly" depends on identical scaling.

## 7. OSC export format

A recording exports as a binary **OSC 1.0 dump**: a sequence of OSC **bundles**, one per
captured time-slice, each carrying an NTP **timetag** and the per-stick messages for that
slice. This is replayable by standard OSC players and faithful to the wire format.

- **Container:** length-prefixed OSC packets (4-byte big-endian size + packet), the common
  convention for stored/streamed OSC, so players can walk the file. (Exact container
  convention to match whatever AirWare/your players expect — confirm in §8.)
- **Timetag origin:** take start = the first frame's time, mapped to NTP. The OSC setup
  panel offers "start at zero" vs "wall-clock start".
- **Address scheme:** `/<id>/<variable>`, matching AirWare (e.g. `/1/...`, `/2/...`),
  emitted to the conceptual port 9000 namespace. Both sticks interleave on one timeline.
- **Per-variable address suffix + argument packing:** the in-scope variables are Fused
  Frame, Quaternion, Linear Accel, Euler. The **exact** suffix strings and argument
  layout (e.g. one message with 4 floats vs. grouped, blob vs. typed args for the fused
  frame) **must be captured from AirWare** — see §8. This is the single open item.
- **Variable selection:** the OSC setup panel chooses which of the four variables are
  written into the dump (default: all four), plus the stick id mapping.

## 8. Open item — confirm AirWare's exact wire format (one-time)

To honour "match AirWare exactly," before/while building OscExporter we capture AirWare's
real output:

1. Connect a stick in AirWare, enable the relevant OSC variables, point it at port 9000.
2. Capture UDP on `localhost:9000` (e.g. `tcpdump`/`nc`/a tiny Node OSC sniffer).
3. Record, for each in-scope variable: the **exact address suffix**, the **OSC type tag**
   (`,f`, `,ffff`, `,b`…), argument order, accel scaling, and euler convention.
4. Encode those findings as fixtures; OscExporter is written to reproduce them and tested
   against the captured bytes.

Everything else in the build is independent of this and can proceed in parallel.

## 9. Live visualisation

- **Orientation:** per stick, a 3D object driven by the decoded quaternion (Three.js or a
  light WebGL/canvas renderer). Two sticks → two viewports, colour-coded (Left indigo,
  Right magenta).
- **Signal charts:** rolling windows for accel magnitude (and optionally accel XYZ / quat /
  euler) per stick. Decimated for render; full rate is what gets recorded.
- Visualisation reads the live decoded stream and is independent of recording state.

## 10. Platform constraints (call out in the UI)

- **Web Bluetooth = Chrome/Edge only** (desktop + Android). **No Safari, no Firefox.** On
  macOS this means running it in Chrome. Show a clear unsupported-browser message elsewhere.
- **User gesture per device:** each `requestDevice` needs a click → two sticks = two quick
  picks from Chrome's chooser at session start. Provide explicit "Add stick" / "Reconnect"
  buttons rather than auto-connect.
- **HTTPS or localhost** required for Web Bluetooth. Serve over `https://` or run locally.
- Recordings live in **IndexedDB** until exported; takes survive reload but are per-browser-
  profile. Export is the durable artifact.

## 11. Future / deferred

- **Live OSC bridge:** a ~30-line local WebSocket→UDP relay would let the app stream OSC
  live to Max/Ableton, making it a full AirWare replacement (not just a recorder). Clean
  add-on later; the OSC encoding work here is directly reusable.
- **Derived variables:** energy / directional ratios / roll velocity / pegs etc., once the
  DSP is reverse-engineered from AirWare captures, could be added as additional OSC
  variables using the same exporter.

## 12. Testing

- **FrameDecoder:** unit tests mapping known 20-byte vectors → expected floats (incl. the
  Q14 world-rotation example) and quat→euler.
- **OscExporter:** byte-equality against captured AirWare fixtures (§8).
- **RecordingEngine:** synthetic frame streams → correct durations, counts, gap handling,
  two-stick interleave.
- **TakeStore:** round-trip save/load/delete in IndexedDB.
- **Manual:** real stick(s) in Chrome — connect, record, save, export, replay the `.osc` in
  an OSC player and confirm parity with an AirWare dump of the same motion.
