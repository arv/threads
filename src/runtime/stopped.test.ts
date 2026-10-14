// a pool shut down, as a page's stop() leaves it until the next start() resets
// it: a spawn throws, as on a pool that was reset, and leaves the pool, the
// heap and the page's thread as they were. a file of its own: the pool stays
// shut down
import {expect, it} from 'vite-plus/test';
import {own, runtime, threads as T} from './test-heap.ts';

const sab = globalThis.__escapeSab!;
// the control words and thread 1's quiescent state, as runtime.ts lays them out
const C_BUSY = 2,
  C_AQ_LEN = 28,
  QS_1 = 2048 + 8 + 5,
  IDLE = 1;
const word = (i: number) => Atomics.load(runtime.I32, i);
// live blocks of the heap
const live = () => {
  const s = T.heapStats();
  return s.allocated - s.freed;
};

function count(o: {n: number}) {
  return o.n;
}
async function asyncNoop() {}

own.fns({count, asyncNoop});
runtime.shutdown(sab);

it('a spawn on a pool that was shut down throws, and changes nothing', () => {
  // the page's thread, as stop() leaves it: quiescent until start() again
  runtime.$waitBegin();
  expect(word(QS_1)).toBe(IDLE);
  const before = live();
  const args = {n: 1};
  expect(() => own.spawn(count, args)).toThrow(/the pool was stopped/);
  expect(() => own.spawn(asyncNoop)).toThrow(/the pool was stopped/);
  // nothing queued, or counted live (a join would wait for good), the page
  // still idle, nothing allocated, and the arguments not moved
  expect(runtime.counters(sab)).toMatchObject({live: 0, queued: 0});
  expect(word(C_AQ_LEN)).toBe(0);
  expect(word(QS_1)).toBe(IDLE);
  expect(live()).toBe(before);
  expect(args.n).toBe(1);
});

it('the runtime queues no thread on a pool that was shut down', () => {
  // as a worker that spawns as the page stops the pool, past spawn's own check
  const t = runtime.$allocBlock(32);
  expect(() => runtime.spawnThread(t)).toThrow(/the pool was stopped/);
  expect(() => runtime.spawnAsync(t)).toThrow(/the pool was stopped/);
  expect(runtime.counters(sab)).toMatchObject({live: 0, queued: 0});
  expect(word(C_AQ_LEN)).toBe(0);
  // the claims are released: a reset waits for none
  expect(word(C_BUSY)).toBe(0);
  runtime.$freeBlock(t, 32);
});
