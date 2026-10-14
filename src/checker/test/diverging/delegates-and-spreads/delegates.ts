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
