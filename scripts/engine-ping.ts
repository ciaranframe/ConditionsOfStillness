// Ask a Conditions engine (or any AirKit) for roster, seats, state and [COS] status.
// Usage: node scripts/engine-ping.ts [langPort=57120]
import { createSocket } from 'node:dgram';
import { encodeMessage, flattenPacket } from './lib/osc.ts';

const port = Number(process.argv[2] ?? 57120);
const sock = createSocket('udp4');
sock.on('message', (buf) => {
  for (const m of flattenPacket(Buffer.from(buf))) console.log(m.address, m.args.map(String).join(' '));
});
sock.on('error', (e) => { console.error(String(e)); sock.close(); });
sock.bind(0, () => {
  for (const a of ['/airkit/getRoster', '/airkit/getSeats', '/airkit/getState', '/airkit/cos/getStatus']) {
    sock.send(encodeMessage(a, []), port, '127.0.0.1');
  }
  setTimeout(() => sock.close(), 1500);
});
