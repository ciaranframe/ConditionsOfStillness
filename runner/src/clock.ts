// Monotonic milliseconds for every age and timeout in the runner. Wall-clock jumps (NTP, DST)
// would make a stick look dead for the size of the jump; performance.now() does not jump.
// Injectable everywhere it is used so tests can drive time by hand.
import { performance } from 'node:perf_hooks';
export function monotonicMs(): number { return performance.now(); }
