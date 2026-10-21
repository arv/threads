// What the lowering moves, as it runs: parameter defaults that move into the
// body (an owned parameter's, or one with temporaries), the declarations of a
// body around them, function declarations and closures next to an owned
// local, a class field's initializer that constructs its class again, a
// renamed var, a default that throws after an owned parameter, destructured
// defaults, a closure in a default, a labelled loop, a logical assignment and
// a class's extends. main logs each result, and how many blocks are still
// allocated.
import {Channel, f64, heapStats, log, struct, type Struct} from '@arv/threads';

const P = struct({x: f64});
type P = Struct<typeof P>;

function read(p: P): number {
  return p.x + 1;
}

// an arrow whose concise body is a closure: the default still runs (0)
const later =
  (p: P = new P()) =>
  () =>
    p.x;

// defaults run left to right (true)
function ordered(a: P = new P(), b: P = a): boolean {
  return a === b;
}

// a destructured default after one that moved reads it (2)
function pattern(a: P = new P(), {x} = {x: a.x + 2}): number {
  return x;
}

// a default with temporaries (1)
function counted(n = read(new P())): number {
  return n;
}

// a moved default reads the outer read, not the body's (1 + 5)
function shadowed(n = read(new P())): number {
  const read = () => 5;
  return n + read();
}

// ... nor the body's var (1 + 5)
function shadowedVar(n = read(new P())): number {
  // eslint-disable-next-line no-var
  var read = () => 5;
  return n + read();
}

// a function declaration next to an owned local reads a const after it (7 + 3)
function hoisted(): number {
  const p = new P();
  p.x = 3;
  const k = 7;
  function get() {
    return k;
  }
  return get() + p.x;
}

// a field initializer whose call constructs another C (1 each, nothing left)
let depth = 0;
function make(p: P): number {
  if (depth++ < 3) new C();
  return p.x + 1;
}
class C {
  value = make(new P());
}

// a body var renamed apart from what a moved default reads still moves its
// count out (4, nothing left)
function fresh(): P {
  return new P();
}
function renamedResult(p: P = fresh()): P {
  // eslint-disable-next-line no-var
  var fresh = new P();
  fresh.x = p.x + 4;
  return fresh;
}

// a closure before an owned local reads a const after it (7 + 3)
function closureFirst(): number {
  const read = () => n;
  const p = new P();
  p.x = 3;
  const n = 7;
  return read() + p.x;
}

// an owned parameter is released when a default after it throws (nothing
// left)
function fail(): number {
  throw new Error('fail');
}
function throwsAfter(a: P = new P(), b = fail()): number {
  return a.x + b;
}

// a destructured default frees what it allocates, in a parameter and in a
// local (1 each, nothing left)
function destructured({x = read(new P())}: {x?: number} = {}): number {
  return x;
}
function destructuredLocal(o: {x?: number}): number {
  const {x = read(new P())} = o;
  return x;
}

// a closure in an earlier default sees a pattern's binding after it (7)
function patternSeen(
  get = () => x,
  a: P = new P(),
  {x} = {x: 7 + a.x},
): number {
  return get();
}

// a loop under two labels, continued by the outer one (2)
function labelled(): number {
  let n = 0;
  outer: for (const p = new P(); p.x < 2; p.x++) {
    n++;
    continue outer;
  }
  return n;
}

// a logical assignment's skipped right side releases nothing (1, nothing
// left)
function logical(): number {
  let n = 0;
  for (let i = 0; i < 3; i++) n ||= read(new P());
  return n;
}

// a class's `extends` expression is converted as any other: a struct passed
// as unknown is boxed ('object')
let received: unknown;
function base(value: unknown) {
  received = value;
  return class {};
}
class Extended extends base(new P()) {}

// Issue #59: var is function-scoped, even in a conditional or repeated block.
function nestedVar(run = true): number {
  if (run) {
    // eslint-disable-next-line no-var
    var p = new P();
    p.x = 7;
  }
  const q = new P();
  return run ? p!.x + q.x : q.x;
}
function loopVar(): number {
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-var
    var p = new P();
    p.x = i;
  }
  const q = new P();
  return p!.x + q.x;
}

function varAlias(): number {
  // eslint-disable-next-line no-var
  var p = new P();
  p.x = 31;
  const alias = p;
  {
    // eslint-disable-next-line no-var
    var p = new P();
    p.x = 99;
  }
  return alias.x;
}
const varChannel = new Channel<P>(2);
function varReceive(): number {
  varChannel.send(new P());
  varChannel.send(new P());
  varChannel.close();
  // eslint-disable-next-line no-var
  for (var p of varChannel) p.x = 37;
  const q = new P();
  return p!.x + q.x;
}

// A forward capture is held after initialization, including parameter defaults.
function forwardLocal(): () => number {
  const get = () => p.x;
  const p = new P();
  p.x = 11;
  return get;
}
function forwardDefault(get = () => p.x, p: P = new P()): () => number {
  p.x = 13;
  return get;
}
function forwardList(): () => number {
  const get = () => p.x,
    p = new P();
  p.x = 17;
  return get;
}
function forwardNested(): () => number {
  const make = () => () => p.x;
  const p = new P();
  p.x = 19;
  return make();
}
function forwardHead(): () => number {
  for (let get = () => p.x, p = new P(); ;) {
    p.x = 41;
    return get;
  }
}

function forwardHoisted(): () => number {
  const get = make();
  const p = new P();
  p.x = 29;
  return get;
  function make() {
    function inner() {
      return p.x;
    }
    return inner;
  }
}
function invokeLater(make: () => () => number): number {
  const get = make();
  const q = new P();
  q.x = 99;
  return get() + q.x - 99;
}
function forwardLoop(): number[] {
  const gets: (() => number)[] = [];
  for (let i = 0; i < 2; i++) {
    const get = () => p.x;
    const p = new P();
    p.x = i + 20;
    gets.push(get);
  }
  return gets.map(get => get());
}

// The assignment writes the original receiver, whose address must stay live.
function replaceReceiver(p: P = new P(), q: P = new P()): number {
  p.x = ((p = new P()), (q = new P()), 7);
  return q.x;
}
function assignmentReceiver(): number {
  return replaceReceiver();
}

// An owned for-head must preserve each let binding, and release on every exit.
function iterationBindings(): number[] {
  const callbacks: (() => number)[] = [];
  for (let p = new P(), i = 0; i < 2; i++) callbacks.push(() => i + p.x);
  return callbacks.map(f => f());
}
function iterationAssignment(): number {
  let result = 0;
  outer: for (let p = new P(), i = 0; i < 3; i++, p = new P()) {
    p.x = i + 1;
    result += p.x;
    if (i === 1) continue outer;
  }
  for (let p = new P(); ;) {
    p = new P();
    if (p.x !== 0) return -1;
    break;
  }
  return result;
}
function iterationReturn(): P {
  for (let p = new P(); ;) return p;
}
function iterationThrow(): number {
  try {
    for (let p = new P(), i = 0; i < 2; p = new P(), fail()) i += 1 + p.x;
  } catch {
    return 23;
  }
  return 0;
}

// a result, or the error it throws (the fork's emit throws for some)
function attempt(f: () => unknown): unknown {
  try {
    return f();
  } catch (e) {
    return (e as Error).name;
  }
}

export function main() {
  const results = [
    attempt(() => later()()),
    attempt(ordered),
    attempt(pattern),
    attempt(counted),
    attempt(shadowed),
    attempt(shadowedVar),
    attempt(hoisted),
    attempt(() => (new Extended(), typeof received)),
  ];
  // the closure later() made holds its p until it is collected: the blocks
  // are counted from here. heapStats() counts every worker's blocks, so this
  // runs with no other worker (compile.test.ts)
  results.push(attempt(() => invokeLater(forwardLocal)));
  results.push(attempt(() => invokeLater(forwardDefault)));
  results.push(attempt(() => invokeLater(forwardList)));
  results.push(attempt(() => invokeLater(forwardNested)));
  results.push(attempt(() => invokeLater(forwardHoisted)));
  results.push(attempt(() => invokeLater(forwardHead)));
  results.push(attempt(forwardLoop));
  results.push(attempt(iterationBindings));
  const before = heapStats();
  results.push(attempt(() => new C().value));
  results.push(attempt(() => renamedResult().x));
  results.push(attempt(closureFirst));
  results.push(attempt(throwsAfter));
  results.push(attempt(destructured));
  results.push(attempt(() => destructuredLocal({})));
  results.push(attempt(patternSeen));
  results.push(attempt(labelled));
  results.push(attempt(logical));
  results.push(attempt(nestedVar));
  results.push(attempt(() => nestedVar(false)));
  results.push(attempt(loopVar));
  results.push(attempt(varAlias));
  results.push(attempt(varReceive));
  results.push(attempt(assignmentReceiver));
  results.push(attempt(iterationAssignment));
  results.push(attempt(() => iterationReturn().x));
  results.push(attempt(iterationThrow));
  const after = heapStats();
  log(
    `${JSON.stringify(results)} blocks left ${after.allocated - before.allocated - (after.freed - before.freed)}`,
  );
}
