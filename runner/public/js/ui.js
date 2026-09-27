// Pieces both pages share: the status strip, the state tag, colours, the clock and the cue keys.
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';

// Colour is status only.
export const TONE = { ok: '#2fbf6b', warn: '#f0b429', bad: '#e5484d', inert: '#3a3a3a' };
export const GREY = '#5a5a5a', MUTED = '#b8b8b8', DIM = '#8a8a8a', SURFACE = '#0e0e0e', BORDER = '#3a3a3a';
export const MINUS = '−';

export const toneColor = (tone) => TONE[tone] ?? TONE.inert;
export const fmtClock = (d = new Date()) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
/** A dB value with one decimal and a real minus sign: "−3.0 dB", "0.0 dB", "+2.5 dB". */
export const fmtDb = (db) => { const v = Math.round(db * 10) / 10; return `${v < 0 ? MINUS : v > 0 ? '+' : ''}${Math.abs(v).toFixed(1)} dB`; };
export const stateTone = (s) => ({ OK: 'ok', FADING: 'warn', LOADING: 'warn', SILENT: 'inert', 'NO SIGNAL': 'bad', PANIC: 'bad' })[s] ?? 'inert';
/** The border a wrist's card carries: amber while it changes, red when it is lost or panicked, else inert. */
export const stateBorder = (s) => (s === 'FADING' || s === 'LOADING' ? TONE.warn : s === 'NO SIGNAL' || s === 'PANIC' ? TONE.bad : BORDER);
export const battColor = (pct) => (pct != null && pct < 20 ? TONE.warn : MUTED);
export const fmtBatt = (pct) => (pct == null ? '—' : `${pct}%`);

/** Solid status cells with black text, then the inert clock cell. `cells` is View.status (already in order). */
export function StatusStrip({ cells, clock }) {
  const all = [...cells.map((c) => ({ label: c.key, value: c.value, tone: c.tone })), { label: 'CLOCK', value: clock, tone: 'clock' }];
  return html`<div class="strip" style=${`grid-template-columns: repeat(${all.length}, minmax(0, 1fr))`}>
    ${all.map((c) => {
      const style = c.tone === 'clock' ? `background:${SURFACE};color:#fff;border-color:${BORDER}`
        : c.tone === 'inert' ? `background:${TONE.inert};color:#fff;border-color:${TONE.inert}`
        : `background:${toneColor(c.tone)};color:#000;border-color:${toneColor(c.tone)}`;
      return html`<div class="cell" style=${style}><div class="cell-label">${c.label}</div><div class="cell-value">${c.value}</div></div>`;
    })}
  </div>`;
}

export function Tag({ state, pct }) {
  const bg = state === 'SILENT' ? GREY : toneColor(stateTone(state));
  const text = state === 'FADING' && pct != null ? `FADING ${Math.round(pct * 100)}%` : state;
  return html`<span class="tag" style=${`background:${bg}`}>${text}</span>`;
}

/** Space / → = next, ← = back; ignored while typing in a field. `send` is read through a ref, so it may change every render. */
export function useKeys(send) {
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => {
    const h = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag && /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) latest.current({ type: 'cue', action: 'next' }); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); if (!e.repeat) latest.current({ type: 'cue', action: 'back' }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

/** The clock string, ticking every 250 ms. */
export function useClock() {
  const [clock, setClock] = useState(fmtClock());
  useEffect(() => { const t = setInterval(() => setClock(fmtClock()), 250); return () => clearInterval(t); }, []);
  return clock;
}

export const ChevronLeft = () => html`<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>`;
export const ChevronRight = () => html`<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>`;
