// What an iteration gives, delegated (yield*) or spread ([...x], f(...x)): a
// counted value lands in an IteratorResult, an ordinary array or an arguments
// list. The fork skips every yield* and every spread.
import { Channel, SharedMap, SharedSet, f64, ref, struct, type Struct } from "threads";

interface Node { value: number; next: Node | null }
const Node = struct<Node>({ value: f64, next: ref<Node>() });
// a map's or set's values are its own type's when that type is a cell (Shared<T>)
const Body = struct({ x: f64 });
type Body = Struct<typeof Body>;

declare function log(...values: unknown[]): void;
declare function ambient(): Generator<Node, void, void>;
declare const nodes: Iterable<Node>;

export function* relay(ch: Channel<Node>) { yield* ch; }                  // error
export async function* relayAsync(ch: Channel<Node>) { yield* ch; }       // error
export function* outer() { yield* ambient(); }                             // error
export function* viaIterable() { yield* nodes; }                           // error
export function* values(m: SharedMap<string, Body>) { yield* m.values(); } // error
export function* entries(m: SharedMap<string, Body>) { yield* m; }         // error: the entries hold values

export function* numbers(): Generator<number, void, void> { yield 1; }
export function* delegatesToProgram() { yield* numbers(); }                // fine: its own yields are checked
export function* delegatesToArray() { yield* [1, 2]; }                     // fine
export function* keys(m: SharedMap<string, Body>) { yield* m.keys(); }     // fine: strings

export function spreads(ch: Channel<Node>, m: SharedMap<string, Body>, s: SharedSet<Body>) {
  const all = [...ch];                                                     // error
  const vs = [...m.values()];                                              // error
  const ss = [...s];                                                       // error
  log(...ch);                                                              // error
  const ks = [...m.keys()];                                                // fine
  const cs = [..."abc"];                                                   // fine
  return [all.length, vs.length, ss.length, ks, cs];
}

declare function returnsNode(): Generator<number, Node, void>;
export function* delegatedResult() { return yield* returnsNode(); }        // error: its result, a Node, is this one's
declare const structural: { [Symbol.iterator](): { next(): IteratorResult<Node> } };
export const fromStructural = () => [...structural];                       // error
export function rests(ch: Channel<Node>) {
  const [...taken] = ch;                                                   // error
  let more: Node[] = [];
  [...more] = ch;                                                          // error
  const [...letters] = "abc";                                              // fine
  return [taken.length, more.length, letters];
}
// an iterator whose type arguments are not what it yields
declare class Cursor<A, B> implements IterableIterator<B> {
  a: A;
  next(): IteratorResult<B>;
  [Symbol.iterator](): Cursor<A, B>;
}
declare const cursor: Cursor<number, Node>;
export const fromCursor = () => [...cursor];                               // error
export function* viaCursor() { yield* cursor; }                            // error
declare function finishes(): Generator<number, Node, void>;
export const fromFinishes = () => [...finishes()];                         // fine: the Node is the result, which is not iterated
// a generic generator of this program: its body sees only T
declare function aNode(): Node;
export function* pass<T>(x: T) { yield x; }
export function* passes() { yield* pass(aNode()); }                        // error: T is Node here
export function* passesNumbers() { yield* pass(1); }                       // fine
// an async generator awaits its result
declare function later(): AsyncGenerator<number, Promise<Node>, void>;
export async function* awaitedResult() { return yield* later(); }          // error
// a unique symbol of the program's named as a well-known one is not that one
declare const asyncIterator: unique symbol;
declare const lookalike: {
  [asyncIterator](): AsyncIterator<number>;
  [Symbol.iterator](): Iterator<Node>;
};
export async function* viaLookalike() { yield* lookalike; }                // error: what it iterates is the Iterator<Node>
// the rest of a destructuring, in an array typed wider: what is iterated goes in
export function widened(ch: Channel<Node>) {
  let plain: { value: number }[] = [];
  [...plain] = ch;                                                         // error
  const [...also]: { value: number }[] = ch;                               // error
  return [plain, also];
}
