// A pipe (pipe.ts) between two threads: what one end writes, the other reads,
// in order and whole, through a ring smaller than what goes through it, and
// then 0 once the writer has closed it
import {Worker} from 'node:worker_threads';
import {expect, it} from 'vite-plus/test';
import {Pipe} from './pipe.ts';

it('carries more than it holds, in order, and then says it is closed', async () => {
  const pipe = new Pipe(1 << 10);
  const n = 100_000;
  // the writer, on a thread of its own: bytes i & 0xff, in writes of 1 to
  // 3000 bytes
  const writer = new Worker(
    `const {workerData: {sab, n, url}} = require('node:worker_threads');
    import(url).then(({Pipe}) => {
      const pipe = new Pipe(sab), bytes = new Uint8Array(3000);
      for (let at = 0, size = 1; at < n; at += size, size = size % 3000 + 1) {
        size = Math.min(size, n - at);
        for (let i = 0; i < size; i++) bytes[i] = (at + i) & 0xff;
        pipe.writeFrom(bytes, 0, size);
      }
      pipe.close();
    });`,
    {
      eval: true,
      workerData: {
        sab: pipe.sab,
        n,
        url: new URL('./pipe.ts', import.meta.url).href,
      },
    },
  );
  const got = new Uint8Array(n + 1);
  let at = 0;
  for (;;) {
    const read = pipe.readInto(got, at, Math.min(777, got.length - at));
    if (read === 0) break;
    at += read;
  }
  await new Promise(r => writer.once('exit', r));
  expect(at).toBe(n);
  expect(got.subarray(0, n).every((b, i) => b === (i & 0xff))).toBe(true);
});
