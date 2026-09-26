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
      sticks.send(encodeMessage(`/${n}/IMUFusedData`, [0, 0, az, 0, 0, 0, 1], 'fffffff'), LANG, '127.0.0.1');
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
