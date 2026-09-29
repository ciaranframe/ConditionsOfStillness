// Admin: Ciaran's iPad at the desk. Everything the runner knows, and every Command it takes.
// Renders View (runner/src/view.ts) verbatim; Command field names follow runner/src/server.ts.
import { html, render, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { connect } from './ws.js';
import {
  StatusStrip, Tag, useKeys, useClock, stateBorder, battColor, fmtBatt, fmtDb,
  TONE, MUTED, DIM, BORDER, MINUS,
} from './ui.js';

const WRISTS = ['ZL', 'ZR', 'CL', 'CR'];
const SLOT_WRIST = { 1: 'ZL', 2: 'ZL', 3: 'ZR', 4: 'ZR', 5: 'CL', 6: 'CL', 7: 'CR', 8: 'CR' };   // scenes.ts slotsOf; 9 is audition
const ARM_MS = 3000;
const SEND_EVERY_MS = 100;        // sliders: at most 10 commands a second
const LOG_KEEP = 200, LOG_SHOW = 40;
const TRIM_MIN = -30, TRIM_MAX = 6;

/** Linear amplitude → "−14 dB" / "−inf" (same rounding as view.ts dbfs). */
function dbfs(linear) {
  if (!(linear > 0)) return `${MINUS}inf`;
  const n = Math.round(20 * Math.log10(linear));
  return n < 0 ? `${MINUS}${-n} dB` : `${n} dB`;
}

/** A slider sender: leading edge at once, then at most one send per 100 ms per key, the last value always delivered. */
function useThrottle(send) {
  const st = useRef({});
  return (key, cmd) => {
    const s = st.current[key] ?? (st.current[key] = { last: 0, timer: null, pending: null });
    const now = Date.now();
    if (now - s.last >= SEND_EVERY_MS && !s.timer) { s.last = now; send(cmd); return; }
    s.pending = cmd;
    if (!s.timer) {
      s.timer = setTimeout(() => { s.timer = null; s.last = Date.now(); if (s.pending) { send(s.pending); s.pending = null; } }, Math.max(0, SEND_EVERY_MS - (now - s.last)));
    }
  };
}

/** A fader's own value while the hand is on it, so the 10 Hz view does not pull it back mid-drag. */
function useHeld() {
  const [held, setHeld] = useState({});
  const timers = useRef({});
  const hold = (key, v) => { clearTimeout(timers.current[key]); setHeld((h) => ({ ...h, [key]: v })); };
  const release = (key) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setHeld((h) => { const n = { ...h }; delete n[key]; return n; }), 600);
  };
  return [held, hold, release];
}

function SceneList({ view, armed, disabled, onTap }) {
  const cur = view.sceneIndex;
  return html`<div class="scene-list">
    ${view.scenes.map((s) => {
      const now = s.index === cur, isNext = s.index === cur + 1;
      const isArmed = armed && armed.kind === 'jump' && armed.index === s.index;
      return html`<button key=${s.index} class=${`scene-row ${now ? 'now' : ''} ${isArmed ? 'armed' : ''}`} disabled=${disabled}
          onClick=${() => onTap(s.index)} aria-label=${`Jump to scene ${s.id}`}>
        <div class="row-id">${s.id}</div>
        <div class="row-text">
          <div class="row-name">${s.name}</div>
          <div class="row-sub">${isArmed ? 'TAP AGAIN TO JUMP' : s.summary}</div>
        </div>
        ${now ? html`<div class="row-tag now">NOW</div>` : isNext ? html`<div class="row-tag next">NEXT</div>` : null}
      </button>`;
    })}
    ${view.scenes.length === 0 && html`<div class="empty">no scenes loaded</div>`}
  </div>`;
}

function SceneHeader({ view }) {
  const { scene, next, standby, panicked } = view;
  return html`<div class=${`panel scene-head ${panicked ? 'bad' : ''}`}>
    <div class="head-group">
      <div class="label">SCENE</div>
      ${standby || !scene
        ? html`<div class="head-id standby">STANDBY</div><div class="head-text"><div class="head-name">Before the first cue</div><div class="head-sub">${view.sceneCount} scenes${panicked ? html` · <span class="head-alert">PANIC</span>` : ''}</div></div>`
        : html`<div class="head-id">${scene.id}</div><div class="head-text"><div class="head-name">${scene.name}</div>
            <div class="head-sub">fade ${scene.fade.toFixed(1)} s · ${scene.n} of ${view.sceneCount}${panicked ? html` · <span class="head-alert">PANIC</span>` : ''}</div></div>`}
    </div>
    <div class="head-group next">
      <div class="label">NEXT</div>
      ${next ? html`<div class="head-next-id">${next.id}</div><div class="head-next-name">${next.name}</div>` : html`<div class="head-next-name">END OF PIECE</div>`}
    </div>
  </div>`;
}

function StickStrip({ w, view, online, trim, onTrim, onTrimEnd, pickerOpen, onPicker, onAudition, onReload }) {
  const s = view.wrists[w];
  const silent = s.patch === 'silence' && !s.incoming;
  const auditioning = view.audition && view.audition.wrist === w ? view.audition.patch : null;
  const meterPct = Math.min(100, (s.rms * 100) / 0.5);           // −6 dBFS RMS fills it
  return html`<div class="panel strip-card" style=${`border-color:${stateBorder(s.state)}`}>
    <div class="stick-head"><div class="stick-name">${s.label}</div><div class="who">${s.who}</div></div>
    <div class="patch" style=${`color:${silent ? DIM : '#fff'}`}>${s.incoming ? `${s.patch} → ${s.incoming}` : s.patch}</div>
    <div class="stick-foot">
      <${Tag} state=${s.state} pct=${s.fadePct} />
      <div class="batt" style=${`color:${battColor(s.battery)}`}>${fmtBatt(s.battery)}</div>
      ${s.ipMismatch && html`<div class="batt" style=${`color:${TONE.warn}`}>IP?</div>`}
    </div>
    <div class="bar" style=${s.state === 'FADING' ? '' : 'visibility:hidden'}><div style=${`width:${Math.round((s.fadePct ?? 0) * 100)}%`}></div></div>
    <div class="detail" title=${s.detail}>${auditioning ? `audition ${auditioning} · ` : ''}${s.detail}</div>
    <div class="faders">
      <div class="meter-col">
        <div class="meter" aria-label="Level meter"><div style=${`height:${meterPct.toFixed(1)}%`}></div></div>
        <div class="small">${dbfs(s.peak)}</div>
      </div>
      <div class="trim-col">
        <label class="small" for=${`trim-${w}`}>TRIM</label>
        <div class="trim-well">
          <input id=${`trim-${w}`} class="vfader" type="range" min=${TRIM_MIN} max=${TRIM_MAX} step="0.5" value=${trim}
            disabled=${!online} aria-label=${`${s.label} trim in dB`}
            onInput=${(e) => onTrim(w, Number(e.currentTarget.value))} onChange=${() => onTrimEnd(w)} />
        </div>
        <div class="trim-readout">${fmtDb(trim)}</div>
      </div>
    </div>
    <div class="strip-buttons">
      <button class=${`btn ${auditioning ? 'live' : ''}`} disabled=${!online} onClick=${() => onPicker(pickerOpen ? null : w)}
        aria-label="Audition a patch on this stick">${auditioning ? 'AUDITIONING' : 'AUDITION'}</button>
      <button class="btn" disabled=${!online} onClick=${() => onReload(w)} aria-label="Reload this stick's patch">RELOAD</button>
    </div>
    ${pickerOpen && html`<div class="picker" role="listbox" aria-label=${`Audition on ${s.label}`}>
      <button class=${`picker-off ${!auditioning ? 'current' : ''}`} onClick=${() => onAudition(w, null)}>off</button>
      ${view.roster.map((name) => html`<button key=${name} class=${auditioning === name ? 'current' : ''} onClick=${() => onAudition(w, name)}>${name}</button>`)}
      ${view.roster.length === 0 && html`<div class="empty">no roster from the engine</div>`}
    </div>`}
  </div>`;
}

function LogTail({ lines }) {
  const shown = lines.slice(-LOG_SHOW).reverse();   // column-reverse: newest at the bottom, stays pinned there
  return html`<div class="panel log" aria-label="Runner log">
    ${shown.map((l, i) => html`<div key=${`${l.at}-${i}`} class=${l.level === 'warn' ? 'warn' : l.level === 'error' ? 'error' : ''}>${l.t}  ${l.msg}</div>`)}
  </div>`;
}

function Slots({ view }) {
  return html`<div class="panel box">
    <div class="label">SLOTS</div>
    <div class="slots">
      ${view.slots.map((sl) => {
        const w = SLOT_WRIST[sl.slot];
        const fading = w && view.wrists[w].state === 'FADING';
        const stale = sl.live && sl.tickAgeMs > 1000;
        const border = stale ? TONE.bad : fading ? TONE.warn : BORDER;
        const color = sl.name === 'silence' || !sl.name ? DIM : sl.live ? '#fff' : MUTED;
        return html`<div class="slot" key=${sl.slot} style=${`border-color:${border}`}>
          <div class="slot-top"><div>${sl.slot}</div><div>${sl.stick}</div></div>
          <div class="slot-name" style=${`color:${color}`}>${sl.name || '—'}</div>
          <div class="small">tick ${sl.tickAgeMs < 0 ? '—' : `${Math.round(sl.tickAgeMs)} ms`}</div>
        </div>`;
      })}
    </div>
  </div>`;
}

function Engine({ view }) {
  const e = view.engine;
  const streaming = WRISTS.filter((w) => view.wrists[w].alive).length;
  const rows = [
    ['airkit', e.online ? `online · ${e.port}` : `offline · ${e.port}`, e.online ? null : TONE.bad],
    ['runner', `${view.standby || !view.scene ? 'standby' : `scene ${view.scene.id}`} · pedal ${view.pedal.state.toLowerCase()}`, view.pedal.state === 'OK' ? null : TONE.warn],
    ['server cpu', e.online ? `${Math.round(e.cpu)}%` : '—', null],
    ['limiter', e.online ? (e.limiterOn ? 'on' : 'off') : '—', null],
    ['sticks', `${streaming} of 4 streaming`, streaming === 4 ? null : streaming > 0 ? TONE.warn : TONE.bad],
    ['devices', e.online ? String(e.deviceCount) : '—', null],
  ];
  return html`<div class="panel box">
    <div class="label">ENGINE</div>
    ${rows.map(([k, v, c]) => html`<div class="kv" key=${k}><div>${k}</div><div style=${c ? `color:${c}` : ''}>${v}</div></div>`)}
  </div>`;
}

function Master({ value, online, onInput, onEnd }) {
  return html`<div class="panel box master">
    <div class="box-head"><label class="label" for="master">MASTER</label><div class="master-readout">${fmtDb(value)}</div></div>
    <input id="master" type="range" min=${TRIM_MIN} max=${TRIM_MAX} step="0.5" value=${value} disabled=${!online}
      onInput=${(e) => onInput(Number(e.currentTarget.value))} onChange=${onEnd} />
  </div>`;
}

function Pedal({ pedal }) {
  const tone = pedal.state === 'OK' ? TONE.ok : TONE.warn;
  return html`<div class="panel box">
    <div class="label">PEDAL</div>
    <div class="kv"><div>state</div><div style=${`color:${tone}`}>${pedal.state}</div></div>
    <div class="kv"><div>port</div><div>${pedal.port ?? '—'}</div></div>
    <div class="kv"><div>last</div><div>${pedal.lastEvent ? pedal.lastEvent.desc : '—'}</div></div>
  </div>`;
}

function Heard({ view, online, onAssign }) {
  return html`<div class="panel box heard">
    <div class="label">STICKS HEARD</div>
    <div class="heard-list">
      ${view.heard.map((h) => html`<div class="heard-row" key=${`${h.id}@${h.ip}`}>
        <div class="heard-text">
          <div>${h.id} · ${h.ip}</div>
          <div class="dim">${Math.round(h.rateHz)} Hz · ${fmtBatt(h.batteryPct)} · ${h.wrist ? view.wrists[h.wrist].label : 'unmapped'}${h.conflict ? ' · ' : ''}${h.conflict && html`<span class="conflict">conflict</span>`}</div>
        </div>
        <select value=${h.wrist ?? ''} disabled=${!online} aria-label=${`Assign stick ${h.id}`}
          onChange=${(e) => onAssign(h, e.currentTarget.value || null)}>
          ${WRISTS.map((w) => html`<option value=${w}>${w}</option>`)}
          <option value="">none</option>
        </select>
      </div>`)}
      ${view.heard.length === 0 && html`<div class="empty">no sticks heard</div>`}
    </div>
  </div>`;
}

function ReplayPanel({ view, online, onPlay, onStop }) {
  const [label, setLabel] = useState('');
  const [wrist, setWrist] = useState('ZL');
  const [loop, setLoop] = useState(false);
  const rp = view.replay;
  const takes = view.takes.filter((t) => t.exists);
  const chosen = takes.some((t) => t.label === label) ? label : (takes[0] ? takes[0].label : '');
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  return html`<div class="panel box replay">
    <div class="box-head"><div class="label">REPLAY TAKE</div>
      ${rp && html`<div class="replay-now">${rp.label} → ${view.wrists[rp.wrist].label} ${fmt(rp.elapsedSec)} / ${fmt(rp.seconds)}${rp.loop ? ' ∞' : ''}</div>`}</div>
    ${takes.length === 0 ? html`<div class="empty">no takes in takes/INDEX.md — record one with npm run take:page</div>` : html`
      <div class="replay-row">
        <select value=${rp ? rp.label : chosen} disabled=${!online || !!rp} aria-label="Take to replay" onChange=${(e) => setLabel(e.currentTarget.value)}>
          ${takes.map((t) => html`<option key=${t.label} value=${t.label}>${t.label} · ${t.seconds} s${t.what ? ` · ${t.what}` : ''}</option>`)}
        </select>
      </div>
      <div class="replay-row">
        <select value=${rp ? rp.wrist : wrist} disabled=${!online || !!rp} aria-label="Wrist to replay into" onChange=${(e) => setWrist(e.currentTarget.value)}>
          ${WRISTS.map((w) => html`<option key=${w} value=${w}>${w} · ${view.wrists[w].label}</option>`)}
        </select>
        <label class="replay-loop"><input type="checkbox" checked=${loop} disabled=${!online || !!rp} onChange=${(e) => setLoop(e.currentTarget.checked)} /> LOOP</label>
        ${rp ? html`<button class="btn btn-bad" disabled=${!online} onClick=${onStop} aria-label="Stop the replay">STOP</button>`
             : html`<button class="btn btn-primary" disabled=${!online || !chosen} onClick=${() => onPlay(chosen, wrist, loop)} aria-label="Play the take into the wrist">PLAY</button>`}
      </div>`}
  </div>`;
}

function Admin() {
  const [view, setView] = useState(null);
  const [online, setOnline] = useState(false);
  const [log, setLog] = useState([]);
  const [armed, setArmed] = useState(null);          // { kind: 'jump' | 'panic', index?, until }
  const [auditionFor, setAuditionFor] = useState(null);
  const [held, hold, release] = useHeld();
  const clock = useClock();
  const link = useRef(null);
  if (!link.current) {
    link.current = connect({
      onView: setView,
      onLog: (lines) => setLog((old) => { const all = old.concat(lines); return all.length > LOG_KEEP ? all.slice(-LOG_KEEP) : all; }),
      onStatus: (up) => { setOnline(up); if (up) setLog([]); },   // a fresh connection replays the tail: start clean
    });
  }
  const send = (cmd) => link.current.send(cmd);
  const throttled = useThrottle(send);

  // Two-tap arming: the first tap arms for 3 s, a second tap on the same target fires. No browser dialogs.
  const armTimer = useRef(null);
  const disarm = () => { clearTimeout(armTimer.current); setArmed(null); };
  const arm = (kind, index, fire) => {
    if (armed && armed.kind === kind && armed.index === index && Date.now() < armed.until) { disarm(); fire(); return; }
    clearTimeout(armTimer.current);
    setArmed({ kind, index, until: Date.now() + ARM_MS });
    armTimer.current = setTimeout(() => setArmed(null), ARM_MS);
  };
  useEffect(() => () => clearTimeout(armTimer.current), []);

  const standby = view ? view.standby : true;
  const next = view ? view.next : null;
  const panicked = !!view && view.panicked;         // cues are refused while panicked: only RESUME is live
  const canNext = online && !panicked && !!next;
  const canBack = online && !panicked && !!view && !standby;
  useKeys((cmd) => { if (cmd.action === 'next' ? canNext : canBack) send(cmd); });

  const offline = !online && html`<div class="offline-bar" role="alert">RUNNER OFFLINE — reconnecting</div>`;
  if (!view) return html`${offline}<div class="connecting">CONNECTING TO THE RUNNER…</div>`;

  const trimOf = (w) => held[`trim-${w}`] ?? view.wrists[w].trimDb;
  const masterValue = held.master ?? view.masterDb;
  const panicArmed = armed && armed.kind === 'panic';
  const errors = [view.scenesError && `scenes: ${view.scenesError}`, view.castError && `cast: ${view.castError}`].filter(Boolean);

  return html`
    ${offline}
    <${StatusStrip} cells=${view.status} clock=${clock} />
    <div class="cols">
      <div class="col col-scenes">
        <div class="label">SCENES</div>
        <${SceneList} view=${view} armed=${armed} disabled=${!online || panicked}
          onTap=${(i) => { if (online && !panicked) arm('jump', i, () => send({ type: 'jump', index: i })); }} />
        <${Heard} view=${view} online=${online}
          onAssign=${(h, wrist) => { if (wrist || h.wrist) send(wrist ? { type: 'assignStick', wrist, id: h.id } : { type: 'assignStick', wrist: h.wrist, id: null }); }} />
        <${ReplayPanel} view=${view} online=${online}
          onPlay=${(label, wrist, loop) => send({ type: 'replay', label, wrist, loop })}
          onStop=${() => send({ type: 'replayStop' })} />
        <div class="cue-buttons">
          <button class="btn btn-back" disabled=${!canBack} onClick=${() => send({ type: 'cue', action: 'back' })} aria-label="Back one scene">BACK</button>
          <button class="btn btn-primary btn-next" disabled=${!canNext} onClick=${() => send({ type: 'cue', action: 'next' })} aria-label="Next scene">
            ${next ? `NEXT: SCENE ${next.id}` : 'END OF PIECE'}</button>
        </div>
      </div>

      <div class="col col-mid">
        <${SceneHeader} view=${view} />
        ${errors.length > 0 && html`<div class="panel errors">${errors.map((e) => html`<div>${e}</div>`)}</div>`}
        <div class="strips">
          ${WRISTS.map((w) => html`<${StickStrip} key=${w} w=${w} view=${view} online=${online} trim=${trimOf(w)}
            onTrim=${(wr, db) => { hold(`trim-${wr}`, db); throttled(`trim-${wr}`, { type: 'trim', wrist: wr, db }); }}
            onTrimEnd=${(wr) => release(`trim-${wr}`)}
            pickerOpen=${auditionFor === w} onPicker=${setAuditionFor}
            onAudition=${(wr, patch) => { send({ type: 'audition', wrist: wr, patch }); setAuditionFor(null); }}
            onReload=${(wr) => send({ type: 'reload', wrist: wr })} />`)}
        </div>
        <${LogTail} lines=${log} />
      </div>

      <div class="col col-right">
        <${Slots} view=${view} />
        <${Engine} view=${view} />
        <${Master} value=${masterValue} online=${online}
          onInput=${(db) => { hold('master', db); throttled('master', { type: 'master', db }); }}
          onEnd=${() => release('master')} />
        <${Pedal} pedal=${view.pedal} />
        <div class="end-buttons">
          <button class=${`btn btn-bad btn-panic ${panicArmed ? 'armed' : ''}`} disabled=${!online}
            onClick=${() => arm('panic', undefined, () => send({ type: 'panic' }))} aria-label="Panic: silence every stick">
            ${panicArmed ? 'TAP AGAIN TO PANIC' : 'PANIC'}</button>
          ${view.panicked && html`<button class="btn btn-primary" disabled=${!online} onClick=${() => send({ type: 'resume' })} aria-label="Resume the current scene">RESUME</button>`}
          <a class="btn" href="/perform" aria-label="Open the Perform view">PERFORM VIEW</a>
        </div>
      </div>
    </div>`;
}

render(html`<${Admin} />`, document.getElementById('app'));
