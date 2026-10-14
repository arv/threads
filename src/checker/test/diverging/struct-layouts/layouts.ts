// A shared struct value used as another struct type: TypeScript relates the two
// by their members, the runtime reads each field at its place. The fork does
// not compare layouts.
import { f64, i32, ref, struct, SharedArray } from "threads";

interface Node { value: number; next: Node | null }
const Node = struct<Node>({ value: f64, next: ref<Node>() });
// Node's fields after one of its own: not laid out as a Node
interface Child extends Node { extra: number }
const Child = struct<Child>({ extra: f64, value: f64, next: ref<Child>() });
// Node's fields first: laid out as a Node, and more
interface Leaf extends Node { depth: number }
const Leaf = struct<Leaf>({ value: f64, next: ref<Leaf>(), depth: f64 });
interface A { x: number; y: number }
interface B { y: number; x: number }
const A = struct<A>({ x: f64, y: f64 });
const B = struct<B>({ y: f64, x: f64 });
interface Count { n: number }
interface Index { n: i32 }                      // the field typed as the i32 it is
const Count = struct<Count>({ n: f64 });
const Index = struct<Index>({ n: i32 });

declare const flag: boolean;
declare function use(...xs: unknown[]): void;

export function asNode(): Node { return new Child(); }                  // error
export function param(n: Node) { return n.value; }
export function call() { return param(new Child()); }                   // error
export function viaConst() { const n: Node = new Child(); return n; }   // error
export function branch() { const n: Node = flag ? new Node() : new Child(); return n; }  // error, the Child
export function swapped(): A { return new B(); }                        // error: x and y swapped
export function kinds(): Count { return new Index(); }                  // error: an i32 for an f64
export function arrays(): SharedArray<Node> { return new SharedArray(Child, 4); }  // error
export function store(n: Node, c: Child) { n.next = c; use(n); }        // error

export function prefix(): Node { return new Leaf(); }                   // fine: Node's fields first
export function same(): Node { return new Node(); }                     // fine
export function nullable(): Node | null { return flag ? new Leaf() : null; }  // fine
export function leafArrays(): SharedArray<Leaf> { return new SharedArray(Leaf, 4); }  // fine
export function downcast(n: Node) { return (n as Leaf).depth; }           // fine: a Leaf lays out a Node's fields first
export function badDowncast(n: Node) { return (n as Child).extra; }       // error: a Child does not
