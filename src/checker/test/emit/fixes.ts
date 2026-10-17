// What threads-check compiles differently from the fork, which gets these
// wrong (compile.test.ts tests them).
import {f64, SharedArray, struct, type Struct} from 'threads';

const Node = struct({value: f64});
type Node = Struct<typeof Node>;

function read(n: Node): number {
  return n.value;
}

// an arrow whose concise body is a closure, with an owned parameter's
// default: the default still runs
export const later =
  (p: Node = new Node()) =>
  () =>
    p.value;

// defaults run left to right: b's sees a's
export function ordered(a: Node = new Node(), b: Node = a): boolean {
  return a === b;
}

// a default with temporaries of its own runs in the body, which declares them
export function counted(n = read(new Node())): number {
  return n;
}

// the array is read before the index that assigns it
export function receiver(a: SharedArray<number>, b: SharedArray<number>) {
  return a[((a = b), 0)];
}

// a scalar element type's expression still runs
let calls = 0;
export function made(n: number): SharedArray<number> {
  return new SharedArray((calls++, Number), n);
}
export const madeCalls = () => calls;

// a class's heritage is a full expression: the array it reads before the
// index that assigns it is released
let first = new SharedArray(Number, 1);
const second = new SharedArray(Number, 1);
export let element = 0;
class Base {}
export class Derived extends ((element = first[((first = second), 0)]), Base) {}

// a default that moves after an optional parameter: the parameter stays
// optional, so the types still strip
export function afterOptional(o?: Node, p: Node = new Node(), q: Node = p) {
  return q === p && o === undefined;
}

// #59: the fork releases this var when the inner block ends. Its owner now
// starts at function entry and is released on function exit.
export function functionVar(): number {
  {
    // eslint-disable-next-line no-var
    var p = new Node();
    p.value = 7;
  }
  const q = new Node();
  return p.value + q.value;
}

// #59: forward captures wait for the binding to initialize before holding it.
export function forwardCapture(): () => number {
  const get = () => p.value;
  const p = new Node();
  return get;
}
export function forwardParameter(get = () => p.value, p: Node = new Node()) {
  return get;
}

// #59: evaluating the address alone does not keep the receiver alive when
// the right side replaces its last owner. Hold it through the full expression.
export function assignmentReceiver(p: Node, q: Node): number {
  p.value = ((p = new Node()), (q = new Node()), 7);
  return q.value;
}

// #59: leave let declarations in the for head. Separate owners are visible
// to the finally without destroying JavaScript's per-iteration environments.
export function iterationBindings(): number[] {
  const callbacks: (() => number)[] = [];
  for (let p = new Node(), i = 0; i < 2; i++) callbacks.push(() => i + p.value);
  return callbacks.map(f => f());
}
