# First-rehearsal checklist
1. Router up; laptop on its fixed IP; `./run.sh`; Admin opens on the iPad at http://<laptop-ip>:3000/admin.
2. Sticks on: each appears in STICKS HEARD with its id; assign each to a wrist (ZL ZR CL CR) — STICKS reads 4 / 4.
3. Footswitch plugged in: PEDAL reads OK; press each switch and check the last event in the PEDAL panel; fix `cast.yaml` if a switch is unmapped.
4. AIRKIT OK, AUDIO OK, CPU under 70 %.
5. NEXT from STANDBY to A; hear the crossfade; NEXT to B; BACK to A. Watch the FADING tags.
6. Audition a patch on one wrist from Admin; turn it off.
7. PANIC, then RESUME.
8. Batteries above 50 % before the run.

## Recording a take (for patch auditions)
Record a few real gestures per wrist once the sticks are assigned — `take:record` listens on UDP 8001, not the runner's 8000.
1. Either repoint one stick to 8001: from sclang, `NetAddr("<stick ip>", 8888).sendMsg("/Config/RequestStream", <laptop ip as four numbers>, 8001)` (see `airkit/configureAirStickOSC.sc`) — the runner stops hearing that wrist until it is pointed back at 8000 — or stop the runner and record with `--port 8000`.
2. `npm run take:record -- zl-scales-slow --wrist ZL --seconds 30 --what "piano scales slow"`. "waiting for /<id>/IMUFusedData on udp 8001" means the stick is not streaming there yet; a take with no packets writes nothing.
3. Point the stick back at 8000 (or restart the runner) and check it in STICKS HEARD.

## Recovery drills
Run these once in the room, mid-scene, with the sticks moving and the sound audible.
1. Kill the runner mid-scene (Ctrl-C the runner, or `kill` its process): `run.sh` restarts it and it comes back in the same scene. A healthy engine keeps sounding through the restart — nothing is reloaded whose seat already matches.
2. Restart the engine (quit sclang; `run.sh` restarts it): AIRKIT goes OFFLINE, then OK; the scene comes back within a few seconds after the engine has booted.
3. Reload the Admin page on the iPad (and the Perform page): both reconnect and show the same scene, nothing changes in the sound.
4. PANIC, then press the footswitch (and NEXT on Perform): nothing happens — the log says `cue ignored — PANIC, resume from Admin`; Admin's BACK/NEXT and scene rows are disabled.
5. RESUME from Admin: the current scene comes back; the footswitch cues again.
