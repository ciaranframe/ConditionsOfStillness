// Perform: the performer's laptop page. Where are we, what comes next, is every stick alive — readable from the stage.
// Renders View (runner/src/view.ts) verbatim; sends only cue commands.
import { html, render, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { connect } from './ws.js';
import { StatusStrip, Tag, useKeys, useClock, stateBorder, battColor, fmtBatt, DIM, ChevronLeft, ChevronRight } from './ui.js';

const WRISTS = ['ZL', 'ZR', 'CL', 'CR'];
const FLASH_MS = 300;

function Perform() {
  const [view, setView] = useState(null);
  const [online, setOnline] = useState(false);
  const [flash, setFlash] = useState(null);           // 'next' | 'back' for 300 ms after a cue lands
  const clock = useClock();
  const link = useRef(null);
  if (!link.current) link.current = connect({ onView: setView, onLog: () => {}, onStatus: setOnline });
  const send = (cmd) => link.current.send(cmd);

  // The pedal flash: a new lastCue.at lights the button for that action. The cue already in the first view is not new.
  const seenAt = useRef(undefined);
  const lastCue = view ? view.lastCue : undefined;
  useEffect(() => {
    if (lastCue === undefined) return;
    const at = lastCue ? lastCue.at : null;
    const first = seenAt.current === undefined;
    const changed = at !== seenAt.current;
    seenAt.current = at;
    if (first || !changed || !lastCue || (lastCue.action !== 'next' && lastCue.action !== 'back')) return;
    setFlash(lastCue.action);
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [lastCue ? lastCue.at : null, lastCue === undefined]);

  const standby = view ? view.standby : true;
  const next = view ? view.next : null;
  const prev = view ? view.prev : null;
  const canAct = online && !!view && !view.panicked;
  const canNext = canAct && !!next;
  const canBack = canAct && !standby;
  useKeys((cmd) => { if (cmd.action === 'next' ? canNext : canBack) send(cmd); });

  const offline = !online && html`<div class="offline-bar" role="alert">RUNNER OFFLINE — reconnecting</div>`;
  if (!view) return html`${offline}<div class="connecting">CONNECTING TO THE RUNNER…</div>`;

  const { scene, panicked, wrists, sceneCount } = view;
  const idText = standby || !scene ? 'STANDBY' : scene.id;
  return html`
    ${offline}
    <${StatusStrip} cells=${view.status.filter((c) => c.key !== 'CPU')} clock=${clock} />
    <div class="scene-row">
      <div class=${`panel scene ${panicked ? 'bad' : ''}`}>
        <div class="label">SCENE</div>
        <div class="scene-line">
          <div class=${`scene-id ${idText === 'STANDBY' ? 'standby' : ''}`}>${idText}</div>
          <div class="scene-meta">
            <div class="scene-name">${standby || !scene ? 'Before the first cue' : scene.name}</div>
            <div class="sub">${standby || !scene ? `${sceneCount} scenes` : `${scene.n} of ${sceneCount} · fade ${scene.fade.toFixed(1)} s`}</div>
            ${panicked && html`<div class="panic-line">PANIC — resume from Admin</div>`}
          </div>
        </div>
      </div>
      <div class="side">
        <div class="panel next-panel">
          <div class="label">NEXT</div>
          ${next
            ? html`<div class="pair"><div class="next-id">${next.id}</div><div class="next-name">${next.name}</div></div>`
            : html`<div class="end-name">END OF PIECE</div>`}
        </div>
        <div class="panel prev-panel">
          <div class="label">PREVIOUS</div>
          ${prev
            ? html`<div class="pair"><div class="prev-id">${prev.id}</div><div class="prev-name">${prev.name}</div></div>`
            : html`<div class="pair"><div class="prev-id">—</div></div>`}
        </div>
      </div>
    </div>
    <div class="sticks">
      ${WRISTS.map((w) => {
        const s = wrists[w];
        const silent = s.patch === 'silence' && !s.incoming;
        return html`<div class="panel stick" key=${w} style=${`border-color:${stateBorder(s.state)}`}>
          <div class="stick-head"><div class="stick-name">${s.label}</div><div class="who">${s.who}</div></div>
          <div class="patch" style=${`color:${silent ? DIM : '#fff'}`}>${s.incoming ? `${s.patch} → ${s.incoming}` : s.patch}</div>
          <div class="stick-foot">
            <${Tag} state=${s.state} pct=${s.fadePct} />
            <div class="batt" style=${`color:${battColor(s.battery)}`}>${fmtBatt(s.battery)}</div>
          </div>
          ${s.state === 'FADING' && html`<div class="bar"><div style=${`width:${Math.round((s.fadePct ?? 0) * 100)}%`}></div></div>`}
        </div>`;
      })}
    </div>
    <div class="buttons">
      <button class=${`btn btn-back ${flash === 'back' ? 'flash' : ''}`} disabled=${!canBack}
        onClick=${() => send({ type: 'cue', action: 'back' })} aria-label="Back one scene">
        <${ChevronLeft} /><span>BACK TO ${prev ? prev.id : '—'}</span>
      </button>
      <button class=${`btn btn-primary btn-next ${flash === 'next' ? 'flash' : ''}`} disabled=${!canNext}
        onClick=${() => send({ type: 'cue', action: 'next' })} aria-label="Go to next scene">
        <span>${next ? `NEXT: SCENE ${next.id}` : 'END OF PIECE'}</span>${next && html`<${ChevronRight} />`}
      </button>
    </div>`;
}

render(html`<${Perform} />`, document.getElementById('app'));
