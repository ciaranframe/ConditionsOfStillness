// One reconnecting WebSocket to the runner. The page never talks to the engine directly.
// Protocol (runner/src/server.ts): the server sends {type:'view'}, {type:'log'} and {type:'ack'} frames;
// the page sends Commands. Acks are ignored here: the next view frame shows what happened.
const RETRY_MS = 1000;

export function connect({ onView, onLog, onStatus }) {
  let ws = null, open = false;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const dial = () => {
    try { ws = new WebSocket(url); } catch { setTimeout(dial, RETRY_MS); return; }
    ws.onopen = () => { open = true; onStatus(true); };
    ws.onclose = () => { open = false; onStatus(false); setTimeout(dial, RETRY_MS); };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'view') onView(m.view);
      else if (m.type === 'log') onLog(m.lines);
    };
  };
  dial();
  return {
    send: (cmd) => { if (!open) return false; ws.send(JSON.stringify(cmd)); return true; },
    isOpen: () => open,
  };
}
