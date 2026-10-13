import {spawn} from './own.ts';
import type {SpawnArgs} from './own.ts';
// a page's side of threads: start() makes the pool of Web Workers on the memory
// threads/heap made, and run(f, ...args) runs f on a thread and resolves with
// its result. the page's own thread never blocks (it cannot: Atomics.wait is
// not allowed there), so it waits for threads asynchronously
import {
  attach,
  threadBegin,
  shutdown,
  resetPool,
  $waitBegin,
} from './runtime.ts';
import type {Message} from './runtime.ts';

const sab = globalThis.__escapeSab;
const workers: Worker[] = [];
let started: Promise<void> | null = null,
  // fails the start that is under way: its workers are terminated as they
  // load, and never report ready
  failStart: ((e: Error) => void) | null = null,
  stopped = false,
  // one more for each pool stopped: a run that began on a pool that is gone
  // fails rather than spawn on the next
  generation = 0;
// the runs waiting for a thread, to fail should the pool stop meanwhile
const waiting = new Set<(e: Error) => void>();
const STOPPED = 'threads: the pool was stopped';

// how start() makes the pool
type Options = {
  workers?: number;
  check?: boolean;
  onLog?: (text: string) => void;
};

export function start({
  workers: count = navigator.hardwareConcurrency ?? 8,
  check = false,
  onLog = text => console.log(text.replace(/\n$/, '')),
}: Options = {}) {
  if (started) return started;
  if (!sab)
    throw new Error(
      'threads: import "@arv/threads/heap" first in the page\'s entry module',
    );
  const onMessage: (m: Message) => void = m => {
    if (m.type === 'out') onLog(m.text);
    // every pool thread is busy: one more worker
    else if (m.type === 'grow') add();
    else if (m.type === 'crash')
      console.error(`threads: a worker crashed: ${m.message}`);
  };
  const add = () =>
    new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL('./threads-worker.ts', import.meta.url), {
        type: 'module',
        name: 'threads',
      });
      workers.push(w);
      w.onmessage = ({data: m}: MessageEvent<Message>) =>
        m.type === 'ready' ? resolve() : onMessage(m);
      w.onerror = e =>
        reject(new Error(`threads: a worker failed to start: ${e.message}`));
      w.postMessage({sab, opts: {check}});
    });
  // the runtime set the heap up when it loaded; a pool that was stopped left
  // it shut down, with the words of workers that are gone
  if (stopped) resetPool(sab);
  stopped = false;
  attach(sab, {check}, onMessage, onLog);
  threadBegin(1);
  // between tasks the page holds no uncounted address (REFCOUNT.md): quiescent
  $waitBegin();
  started = Promise.race([
    Promise.all(Array.from({length: count}, add)).then(() => {}),
    new Promise<never>((_, reject) => {
      failStart = reject;
    }),
  ]);
  started.catch(() => {}); // those awaiting it see the rejection
  return started;
}

// f must be a top-level function of a module the plugin compiled (other than
// the page's entry, which workers do not load)
export async function run<A extends unknown[], R>(
  f: (...args: A) => R,
  ...args: SpawnArgs<A>
) {
  const g = generation;
  await start();
  if (generation !== g) throw new Error(STOPPED);
  const result = spawn(f, ...args).joinAsync();
  $waitBegin();
  // stop() fails what waits: a thread its worker took with it never finishes.
  // (the join may still settle, late, from a worker that ran on: nothing then
  // reports it)
  result.catch(() => {});
  let fail!: (e: Error) => void;
  const stops = new Promise<never>((_, reject) => {
    waiting.add((fail = reject));
  });
  try {
    return await Promise.race([result, stops]);
  } finally {
    waiting.delete(fail);
  }
}

// stops the pool: its workers are terminated, with the threads they ran, and
// the runs waiting for one fail. start() starts a new pool on the same heap
export function stop() {
  shutdown(sab!);
  for (const w of workers.splice(0)) w.terminate();
  for (const fail of waiting) fail(new Error(STOPPED));
  waiting.clear();
  failStart?.(new Error(STOPPED));
  failStart = null;
  generation++;
  stopped = true;
  started = null;
}
