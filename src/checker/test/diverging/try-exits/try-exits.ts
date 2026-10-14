// A send in a try block that leaves early (return, throw, break): its catch and
// its finally see the value sent; the fork forgets it.
import { Channel } from "threads";

declare function use(...values: unknown[]): void;

export function returnThenFinally(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); return; } finally { use(xs); }          // error: may have been sent
}
export function throwThenCatch(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); throw new Error("x"); } catch { use(xs); }  // error
}
export function breakThenFinally(ch: Channel<number[]>) {
  const xs = [1];
  for (;;) { try { ch.send(xs); break; } finally { use(xs); } }  // error
}
export function returnThenCatchThenAfter(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); return; } catch {}
  use(xs);                                                    // error: reached through the catch
}
export function sentOnlyOnTheWayOut(ch: Channel<number[]>, flag: boolean) {
  const xs = [1];
  try { if (flag) { ch.send(xs); return; } } finally {}
  use(xs);                                                    // fine: the path that sent left
}
