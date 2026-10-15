// A spread argument's values go into the parameters from its place on, a
// tuple's each into its own and an array's into the rest, and are checked as
// arguments of their types are: an integer's parameter takes integers. The fork
// does not check what a spread passes.
import { type i32 } from "threads";

function take(k: i32): i32 { return k; }
function takeAll(...ks: i32[]): number { return ks.length; }
const halves = [0.5] as const;
const threes = [3] as const;
declare const numbers: number[];

export function spreads() {
  take(...halves);                 // error: a fraction for an i32
  takeAll(...numbers);             // error: numbers for i32s
  return take(...threes);          // fine: an integer
}
// an iteration's values, whatever iterates them
export function iterated() {
  return takeAll(...new Set<number>([0.5]));  // error: numbers for i32s
}
// the places a spread fills: a tuple's length, none for an empty one, an
// unknown number past an optional element or an iteration
function third(a: number, b: number, c: i32): i32 { return c; }
function second(a: number, b: i32, c: number): i32 { return b; }
const pair = [1, 2] as const;
const none = [] as const;
declare const optional: [number?];
declare function maybeSecond(a: number | undefined, b: i32, c?: number): i32;
export function places() {
  third(...pair, ...halves);       // error: the fraction goes to c
  second(...pair, ...halves);      // fine: b takes the 2
  take(...none, 0.5);              // error: the fraction goes to k
  return maybeSecond(...optional, 0.5, 1);  // error: the fraction may go to b
}
// and where a value is sent
import { type Sending } from "threads";
declare function sendFirst(xs: Sending<number[]>, n?: number): void;
declare function use(...values: unknown[]): void;
export function sentPastEmptySpread() {
  const xs = [1];
  sendFirst(...none, xs);
  use(xs);                         // error: xs was sent
}
