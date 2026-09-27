import { EventEmitter } from 'node:events';

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogLine { t: string; at: number; level: LogLevel; msg: string }

const stamp = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

/** Ring buffer of the last `max` lines; also prints to stdout. Admin shows the tail. */
export class Log extends EventEmitter {
  private lines: LogLine[] = [];
  private max: number;
  private now: () => number;
  private print: (s: string) => void;
  constructor(max = 500, now: () => number = Date.now, print: (s: string) => void = (s) => console.log(s)) {
    super();
    this.max = max;
    this.now = now;
    this.print = print;
  }
  line(msg: string, level: LogLevel = 'info'): void {
    const at = this.now();
    const l: LogLine = { t: stamp(new Date(at)), at, level, msg };
    this.lines.push(l);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    this.print(`${l.t} ${level === 'info' ? '' : level.toUpperCase() + ' '}${msg}`);
    this.emit('line', l);
  }
  recent(n = this.max): LogLine[] { return this.lines.slice(-n); }
}
