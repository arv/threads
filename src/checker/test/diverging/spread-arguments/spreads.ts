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
