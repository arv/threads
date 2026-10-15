// What threads-check compiles differently from the fork, which gets these
// wrong (compile.test.ts tests them, and emit-compare.ts knows they differ).
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
