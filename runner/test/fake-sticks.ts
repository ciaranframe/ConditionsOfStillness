// Fake AirSticks: /<id>/IMUFusedData at `hz` and /<id>/Battery every 2 s to one UDP target.
import { createSocket } from 'node:dgram';
import { encodeMessage } from '../../scripts/lib/osc.ts';

export interface FakeSticksOptions { target: { host: string; port: number }; ids: string[]; hz?: number; moving?: Set<string>; battery?: [number, number] }
export function startFakeSticks(opts: FakeSticksOptions) {
  const sock = createSocket('udp4');
  sock.on('error', () => {});
  let moving = new Set(opts.moving ?? []);
  let t = 0;
  const hz = opts.hz ?? 50;
  const imu = setInterval(() => {
    t += 1 / hz;
    for (const id of opts.ids) {
      const az = moving.has(id) ? -9.8 + 4 * Math.sin(2 * Math.PI * 4 * t) : -9.8;
      sock.send(encodeMessage(`/${id}/IMUFusedData`, [0, 0, az, 0, 0, 0, 1], 'fffffff'), opts.target.port, opts.target.host);
    }
  }, 1000 / hz);
  const batt = setInterval(() => {
    for (const id of opts.ids) sock.send(encodeMessage(`/${id}/Battery`, opts.battery ?? [3.9, 81], 'ff'), opts.target.port, opts.target.host);
  }, 2000);
  return {
    setMoving: (ids: Iterable<string>) => { moving = new Set(ids); },
    close: () => { clearInterval(imu); clearInterval(batt); sock.close(); },
  };
}
