// the pool's ring of threads waiting for a worker, on one thread (nothing takes
// them): what happens when it is full
import {describe, expect, it} from 'vite-plus/test';
import {own, runtime} from './test-heap.ts';

// the control words, as runtime.ts lays them out
const C_RING_HEAD = 8,
  C_RING_TAIL = 9,
  C_PENDING = 10,
  C_LIVE = 13,
  RING = 1024;
const word = (i: number) => Atomics.load(runtime.I32, i);

function noop() {}

describe('the ring', () => {
  it('refuses a thread when it is full, and is as it was', () => {
    own.fns({noop});
    for (let i = 0; i < RING; i++) own.spawn(noop);
    expect(word(C_RING_TAIL) - word(C_RING_HEAD)).toBe(RING);
    expect(() => own.spawn(noop)).toThrow(/too many threads waiting/);
    // no slot was claimed for the thread refused (a worker would wait on it
    // for good), and it is not counted live (main would wait for it for good)
    expect(word(C_RING_TAIL) - word(C_RING_HEAD)).toBe(RING);
    expect(word(C_PENDING)).toBe(RING);
    expect(word(C_LIVE)).toBe(RING);
  });
});
