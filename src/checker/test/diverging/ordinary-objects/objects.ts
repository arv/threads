// An ordinary object where a shared struct goes: TypeScript takes an object
// literal, or an instance of a class, for a struct type declared with an
// interface, by its members, and lets a cast make one of a struct type of any
// kind. The place holds an address in the shared heap, and the runtime cannot
// make one of the object. The fork lets them through.
import { f64, ref, struct, Channel, SharedArray, type Struct } from "threads";

interface Node { value: number; next: Node | null }
const Node = struct<Node>({ value: f64, next: ref<Node>() });
class Plain { value = 1; next: Node | null = null }
const Point = struct({ x: f64 });
type Point = Struct<typeof Point>;

declare const flag: boolean;
declare const handle: unknown;
declare const anything: any;

export function declared() { const n: Node = { value: 1, next: null }; return n; }   // error
export function returned(): Node { return { value: 1, next: null }; }                // error
export function constructed(): Node { return new Plain(); }                           // error
export function stored(n: Node) { n.next = { value: 2, next: null }; }                // error
export function param(n: Node) { return n.value; }
export function passed() { return param({ value: 3, next: null }); }                  // error
export function sent(ch: Channel<Node>) { ch.send({ value: 4, next: null }); }        // error
export function defaulted(n: Node = { value: 5, next: null }) { return n; }           // error
export function cast() { return { x: 1 } as Point; }                                  // error: a cast makes no struct
export function castNode() { return { value: 1, next: null } as Node; }               // error
export function branch(): Node { return flag ? new Node() : { value: 1, next: null }; }  // error: the literal
export function nullable(): Node | null { return flag ? null : new Plain(); }         // error: the Plain

export function made(): Node { return new Node(); }                                   // fine
export function none(): Node | null { return null; }                                  // fine
export function element(a: SharedArray<Node>): Node { return a[0]!; }                 // fine
export function fromHandle(): Node { return handle as Node; }                         // fine: a handle may hold one
export function fromAny(): Node { return anything; }                                  // fine
export function fromEmpty(x: {}): Node { return x as Node; }                          // fine: so may an {}
export function generic<T extends Node>(t: T): Node { return t; }                     // fine
