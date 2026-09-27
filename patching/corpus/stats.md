# AirKit corpus statistics

Mined from Airsticks-RPI @ a7a893e, Airsticks-Desktop @ 5ac5790, MiMBrentonShows @ d7e05a6, master @ 1f753bf, AirConcert @ 3703cae.

574 entries (561 unique blobs, 14 flagged duplicates);
statistics below are over the 560 non-duplicate entries (459 personalities).

## Per-branch totals

| branch | ref | commit | personalities | synths | only on this branch |
|---|---|---|---:|---:|---:|
| Airsticks-RPI | `origin/Airsticks-RPI` | `a7a893e` | 233 | 67 | 126 |
| Airsticks-Desktop | `origin/Airsticks-Desktop` | `5ac5790` | 187 | 67 | 72 |
| MiMBrentonShows | `origin/MiMBrentonShows` | `d7e05a6` | 130 | 51 | 81 |
| master | `origin/master` | `1f753bf` | 71 | 18 | 37 |
| AirConcert | `origin/AirConcert` | `3703cae` | 32 | 70 | 40 |

## UGens (top 40, files using each)

| UGen | files |
|---|---:|
| Out | 493 |
| EnvGen | 470 |
| SinOsc | 248 |
| RLPF | 207 |
| Pan2 | 196 |
| BufRateScale | 180 |
| PlayBuf | 177 |
| BufFrames | 167 |
| Balance2 | 130 |
| WhiteNoise | 123 |
| HPF | 102 |
| Compander | 95 |
| LFNoise2 | 91 |
| Saw | 91 |
| LPF | 78 |
| PinkNoise | 78 |
| Impulse | 73 |
| LFTri | 70 |
| BufDur | 69 |
| BPF | 59 |
| DynKlank | 57 |
| FreeVerb | 53 |
| Pulse | 53 |
| DelayC | 52 |
| LFSaw | 48 |
| RHPF | 45 |
| Amplitude | 44 |
| BrownNoise | 43 |
| Mix | 42 |
| Splay | 41 |
| LFCub | 39 |
| Warp1 | 38 |
| LeakDC | 36 |
| LFNoise1 | 36 |
| MouseX | 36 |
| LocalIn | 35 |
| Line | 33 |
| Dust | 32 |
| Select | 30 |
| DetectSilence | 29 |

## Idioms (personalities)

| idiom | files |
|---|---:|
| pdef | 235 |
| ndef | 1 |
| synth | 168 |
| hybrid | 31 |
| none | 24 |

## Header-key coverage (personalities)

51 of 459 have a leading header block with keys.

| key | files |
|---|---:|
| description | 50 |
| gestures | 50 |
| instruments | 50 |
| pitch | 50 |
| rhythm | 50 |
| sound | 50 |
| affinity | 13 |
| family | 13 |
| register | 13 |
| seats | 13 |
| internals | 12 |
| prints | 12 |
| Defaults | 1 |

## Hooks defined (personalities)

| hook | files |
|---|---:|
| `~init` | 454 |
| `~next` | 424 |
| `~deinit` | 395 |
| `~onEvent` | 194 |
| `~nextMidiOut` | 105 |
| `~onHit` | 82 |
| `~onResync` | 33 |
| `~curtainNext` | 31 |
| `~idleNext` | 31 |
| `~onHalf` | 31 |
| `~onRoomState` | 31 |
| `~pieceNext` | 31 |
| `~tuningNext` | 31 |
| `~onBar` | 30 |
| `~onChord` | 30 |
| `~onPhrase` | 30 |
| `~onSection` | 30 |
| `~onTick` | 30 |
| `~midiControllerValue` | 29 |
| `~onBeat` | 29 |
| `~onKey` | 29 |
| `~onScale` | 29 |
| `~onMoving` | 28 |

## Model fields read (personalities, top 30)

| field | files |
|---|---:|
| accelMassFiltered | 391 |
| ptn | 270 |
| rrateMassFiltered | 187 |
| accelMass | 179 |
| com | 155 |
| rrateMass | 92 |
| gyroYFiltered | 81 |
| gyroZFiltered | 42 |
| gyroXFiltered | 30 |
| midiOut | 30 |
| midiChannel | 29 |
| rrateMassThreshold | 24 |
| accelMassAmp | 5 |
| isHit | 2 |
| rrateXMassFiltered | 2 |
| name | 1 |
| rrateMassThresholdSpec | 1 |

## Sample use (personalities)

193 of 459 (42.0%) call `Buffer.read`/`readChannel`/`alloc`.

## Size percentiles (personalities)

| | p10 | p25 | p50 | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|---:|
| bytes | 2130 | 2616 | 3263 | 4819 | 8090 | 32366 |
| lines | 74 | 90 | 118 | 161 | 238 | 724 |
