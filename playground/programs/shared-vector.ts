// A growable vector of numbers in shared memory, written in user space: nothing
// here is built into the runtime or the compiler. A SharedArray has a fixed
// length, so the vector is a shared struct holding the length and a SharedArray
// with room to spare. Pushing past the room copies into an array twice as big
// and stores it in the struct. A thread that read the old array a moment before
// keeps a valid one: the old array's count drops only once every thread has
// passed a quiescent point, and then it is freed.
//
// Reads and writes are plain and unordered between threads, as with any struct.
// One thread pushes at a time: several writers share a lock, here a channel
// holding one token, Go's way.
import {
  bool,
  Channel,
  f64,
  heapStats,
  log,
  ref,
  scope,
  SharedArray,
  struct,
  type Struct,
  type Thread,
} from '@arv/threads';

// The constructor and methods are local to each worker; only these three
// fields use shared storage. Construction starts with zero length and growth count,
// then allocates the backing array. The explicit identity also lets the
// example run with types erased. Scope it to this module so the playground's
// compiled and erased variants can coexist. Compiled builds normalize the URL
// in this identity to the same source-module key in page and worker bundles.
const SharedVector = struct(
  {
    length: f64,
    grows: f64,
    data: ref<SharedArray<number>>(),

    constructor(capacity = 8) {
      if (!Number.isInteger(capacity) || capacity < 1)
        throw new RangeError('capacity must be a positive integer');
      this.data = new SharedArray(Number, capacity);
    },

    /** Appends x, growing the vector when it is full. One thread at a time. */
    push(x: number): void {
      let data = this.data!;
      if (this.length === data.length) {
        const bigger = new SharedArray(Number, data.length * 2);
        for (let i = 0; i < this.length; i++) bigger[i] = data[i];
        // the old array is freed once no thread can still be reading it
        this.data = bigger;
        this.grows++;
        data = bigger;
      }
      data[this.length] = x;
      this.length++;
    },

    /** Element i. */
    at(i: number): number {
      const data = this.data!;
      if (!(i >= 0 && i < this.length && i < data.length))
        throw new RangeError(
          `index ${i} is out of range for a vector of ${this.length}`,
        );
      return data[i];
    },

    /** The elements, copied into an ordinary array. */
    toArray(): number[] {
      const data = this.data!,
        out: number[] = [];
      for (let i = 0; i < this.length; i++) out.push(data[i]);
      return out;
    },

    /** Iterate a snapshot, copied when iteration starts. */
    [Symbol.iterator](): ArrayIterator<number> {
      return this.toArray().values();
    },
  },
  `${import.meta.url}#SharedVector`,
);
type SharedVector = Struct<typeof SharedVector>;

// ---- a demo: writers pushing into one vector while a reader reads it ----

const Flag = struct({stop: bool});
type Flag = Struct<typeof Flag>;
const PER_WRITER = 20000;

// pushes first, first + 1, ... count values, taking the lock for each
function writer(
  v: SharedVector,
  lock: Channel<number>,
  first: number,
  count: number,
) {
  for (let k = 0; k < count; k++) {
    lock.recv(); // take the token: no one else pushes now
    v.push(first + k);
    lock.send(0); // give it back
  }
}

// reads the newest element until told to stop, while the vector grows under it:
// how many reads, and how many values that no writer pushed
function reader(v: SharedVector, flag: Flag, max: number): number {
  let reads = 0,
    bad = 0;
  while (!flag.stop) {
    const data = v.data!,
      n = Math.min(v.length, data.length);
    if (n === 0) continue;
    const x = data[n - 1];
    if (!(Number.isInteger(x) && x >= 0 && x < max)) bad++;
    reads++;
  }
  // two numbers in one: a thread's result is one value
  return reads * 1e6 + bad;
}

export function main(threadCounts: readonly number[]) {
  // The default constructor capacity is eight.
  // One thread: a million pushes, growing the backing array as needed.
  const t0 = performance.now(),
    one = new SharedVector();
  for (let i = 0; i < 1_000_000; i++) one.push(i);
  log(
    `one thread: 1000000 pushes in ${(performance.now() - t0).toFixed(0)} ms, ${one.grows} grows, ` +
      `capacity ${one.data!.length}, element 999999 is ${one.at(999_999)}`,
  );

  for (const threads of threadCounts) {
    // A constructor argument chooses the initial capacity for this run.
    const v = new SharedVector(16),
      lock = new Channel<number>(1),
      flag = new Flag(),
      total = threads * PER_WRITER;
    lock.send(0); // the token
    const before = heapStats(),
      t1 = performance.now();
    let result = 0;
    scope(s => {
      const r = s.spawn(reader, v, flag, total);
      const ws: Thread<void>[] = [];
      for (let t = 0; t < threads; t++)
        ws.push(s.spawn(writer, v, lock, t * PER_WRITER, PER_WRITER));
      for (const w of ws) w.join();
      flag.stop = true;
      result = r.join();
    });
    const ms = performance.now() - t1;
    // every value pushed exactly once
    const seen = new Uint8Array(total);
    let missing = 0,
      twice = 0;
    for (const x of v) {
      if (seen[x]++) twice++;
    }
    for (let x = 0; x < total; x++) if (!seen[x]) missing++;
    const after = heapStats();
    log(
      `${threads} writer${threads === 1 ? '' : 's'} and a reader: ${v.length} pushes in ${ms.toFixed(0)} ms, ` +
        `${v.grows} grows, ${missing} missing, ${twice} twice; reader: ${Math.floor(result / 1e6)} reads, ` +
        `${result % 1e6} bad; heap grew ${(after.heapBytes - before.heapBytes) >> 10} KiB`,
    );
  }
}
