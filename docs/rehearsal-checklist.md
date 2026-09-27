# First-rehearsal checklist
1. Router up; laptop on its fixed IP; `./run.sh`; Admin opens on the iPad at http://<laptop-ip>:3000/admin.
2. Sticks on: each appears in STICKS HEARD with its id; assign each to a wrist (ZL ZR CL CR) — STICKS reads 4 / 4.
3. Footswitch plugged in: PEDAL reads OK; press each switch and check the last event in the PEDAL panel; fix `cast.yaml` if a switch is unmapped.
4. AIRKIT OK, AUDIO OK, CPU under 70 %.
5. NEXT from STANDBY to A; hear the crossfade; NEXT to B; BACK to A. Watch the FADING tags.
6. Audition a patch on one wrist from Admin; turn it off.
7. PANIC, then RESUME.
8. Batteries above 50 % before the run.

## Recovery drills
Run these once in the room, mid-scene, with the sticks moving and the sound audible.
1. Kill the runner mid-scene (Ctrl-C the runner, or `kill` its process): `run.sh` restarts it and it comes back in the same scene. A healthy engine keeps sounding through the restart — nothing is reloaded whose seat already matches.
2. Restart the engine (quit sclang; `run.sh` restarts it): AIRKIT goes OFFLINE, then OK; the scene comes back within a few seconds after the engine has booted.
3. Reload the Admin page on the iPad (and the Perform page): both reconnect and show the same scene, nothing changes in the sound.
4. PANIC, then press the footswitch (and NEXT on Perform): nothing happens — the log says `cue ignored — PANIC, resume from Admin`; Admin's BACK/NEXT and scene rows are disabled.
5. RESUME from Admin: the current scene comes back; the footswitch cues again.
