// OSC 1.0 codec. Copied from the Glimmer show engine (code/show-engine/src/osc/codec.ts,
// Ciaran Frame, 2026) so this repo has no dependency on the Glimmer checkout. Keep in sync by hand.

export type OscArg = number | string | boolean | null | Uint8Array | bigint;

export interface OscMessage {
  address: string;
  args: OscArg[];
  /** Type tag string without the leading comma, e.g. "fs". */
  types: string;
}

export interface OscBundle {
  timetag: bigint;
  elements: Array<OscMessage | OscBundle>;
}

export function isBundle(x: OscMessage | OscBundle): x is OscBundle {
  return 'elements' in x;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function readString(buf: Buffer, offset: number): [string, number] {
  const end = buf.indexOf(0, offset);
  if (end < 0) throw new Error('osc: unterminated string');
  const s = buf.toString('utf8', offset, end);
  return [s, offset + pad4(end - offset + 1)];
}

function writeString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const out = Buffer.alloc(pad4(b.length + 1));
  b.copy(out);
  return out;
}

export function decodeMessage(buf: Buffer): OscMessage {
  let off = 0;
  const [address, o1] = readString(buf, off);
  off = o1;
  if (off >= buf.length) return { address, args: [], types: '' };
  if (buf[off] !== 0x2c) {
    // No type tag string: treat the rest as no args (some old senders).
    return { address, args: [], types: '' };
  }
  const [tags, o2] = readString(buf, off);
  off = o2;
  const types = tags.slice(1);
  const args: OscArg[] = [];
  for (const t of types) {
    switch (t) {
      case 'i':
        args.push(buf.readInt32BE(off));
        off += 4;
        break;
      case 'f':
        args.push(buf.readFloatBE(off));
        off += 4;
        break;
      case 'd':
        args.push(buf.readDoubleBE(off));
        off += 8;
        break;
      case 'h':
        args.push(buf.readBigInt64BE(off));
        off += 8;
        break;
      case 't':
        args.push(buf.readBigUInt64BE(off));
        off += 8;
        break;
      case 's':
      case 'S': {
        const [s, o] = readString(buf, off);
        args.push(s);
        off = o;
        break;
      }
      case 'b': {
        const len = buf.readInt32BE(off);
        off += 4;
        args.push(new Uint8Array(buf.subarray(off, off + len)));
        off += pad4(len);
        break;
      }
      case 'c':
        args.push(String.fromCodePoint(buf.readInt32BE(off)));
        off += 4;
        break;
      case 'r':
        args.push(buf.readUInt32BE(off));
        off += 4;
        break;
      case 'm':
        args.push(new Uint8Array(buf.subarray(off, off + 4)));
        off += 4;
        break;
      case 'T':
        args.push(true);
        break;
      case 'F':
        args.push(false);
        break;
      case 'N':
        args.push(null);
        break;
      case 'I':
        args.push(Infinity);
        break;
      default:
        throw new Error(`osc: unsupported type tag "${t}"`);
    }
  }
  return { address, args, types };
}

export function decodeBundle(buf: Buffer): OscBundle {
  const [tag, o] = readString(buf, 0);
  if (tag !== '#bundle') throw new Error('osc: not a bundle');
  const timetag = buf.readBigUInt64BE(o);
  let off = o + 8;
  const elements: OscBundle['elements'] = [];
  while (off + 4 <= buf.length) {
    const size = buf.readInt32BE(off);
    off += 4;
    elements.push(decodePacket(buf.subarray(off, off + size)));
    off += size;
  }
  return { timetag, elements };
}

export function decodePacket(buf: Buffer): OscMessage | OscBundle {
  if (buf.length === 0) throw new Error('osc: empty packet');
  return buf[0] === 0x23 /* '#' */ ? decodeBundle(buf) : decodeMessage(buf);
}

/** Flatten a packet into its messages (bundles are executed immediately). */
export function flattenPacket(buf: Buffer): OscMessage[] {
  const out: OscMessage[] = [];
  const walk = (p: OscMessage | OscBundle) => {
    if (isBundle(p)) p.elements.forEach(walk);
    else out.push(p);
  };
  walk(decodePacket(buf));
  return out;
}

/** Encode a message; arg types inferred (number → f unless integer-tagged via `types`). */
export function encodeMessage(address: string, args: OscArg[] = [], types?: string): Buffer {
  const tags = types ?? args.map(inferTag).join('');
  const parts: Buffer[] = [writeString(address), writeString(',' + tags)];
  tags.split('').forEach((t, i) => {
    const a = args[i];
    switch (t) {
      case 'i': {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Math.trunc(Number(a)));
        parts.push(b);
        break;
      }
      case 'f': {
        const b = Buffer.alloc(4);
        b.writeFloatBE(Number(a));
        parts.push(b);
        break;
      }
      case 'd': {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(Number(a));
        parts.push(b);
        break;
      }
      case 'h': {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(BigInt(a as bigint | number));
        parts.push(b);
        break;
      }
      case 's':
        parts.push(writeString(String(a)));
        break;
      case 'b': {
        const bytes = a as Uint8Array;
        const b = Buffer.alloc(4 + pad4(bytes.length));
        b.writeInt32BE(bytes.length);
        b.set(bytes, 4);
        parts.push(b);
        break;
      }
      case 'T':
      case 'F':
      case 'N':
      case 'I':
        break;
      default:
        throw new Error(`osc: cannot encode type "${t}"`);
    }
  });
  return Buffer.concat(parts);
}

function inferTag(a: OscArg): string {
  if (typeof a === 'number') return Number.isInteger(a) && Math.abs(a) < 2 ** 31 && !Object.is(a, -0) ? 'i' : 'f';
  if (typeof a === 'string') return 's';
  if (typeof a === 'boolean') return a ? 'T' : 'F';
  if (a === null) return 'N';
  if (typeof a === 'bigint') return 'h';
  return 'b';
}

export function encodeBundle(elements: Buffer[], timetag = 1n): Buffer {
  const head = Buffer.alloc(8);
  head.writeBigUInt64BE(timetag);
  const parts: Buffer[] = [writeString('#bundle'), head];
  for (const e of elements) {
    const len = Buffer.alloc(4);
    len.writeInt32BE(e.length);
    parts.push(len, e);
  }
  return Buffer.concat(parts);
}
