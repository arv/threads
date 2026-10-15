// What the lowering moves, as it runs: parameter defaults that move into the
// body (an owned parameter's, or one with temporaries), the declarations of a
// body around them, function declarations next to an owned local, and a class
// field's initializer that constructs its class again. main logs each
// result, and how many blocks are still allocated.
import {f64, heapStats, log, struct, type Struct} from '@arv/threads';

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
  ];
  // the closure later() made holds its p until it is collected: the blocks
  // are counted from here
  const before = heapStats();
  results.push(attempt(() => new C().value));
  const after = heapStats();
  log(
    `${JSON.stringify(results)} blocks left ${after.allocated - before.allocated - (after.freed - before.freed)}`,
  );
}
