// A send in a try block that leaves early (return, throw, break): its catch and
// its finally see the value sent; the fork forgets it.
import { Channel, consume } from "threads";

declare function use(...values: unknown[]): void;

export function returnThenFinally(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); return; } finally { use(xs); }          // error: may have been sent, by a throw before it
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
export function finallyOverrides(ch: Channel<number[]>) {
  let xs = [1];
  try {
    try { ch.send(xs); return; } finally { xs = [2]; return; }
  } catch { use(xs); }                                        // fine: the finally's return carries the new xs
}
export function nestedFinally(ch: Channel<number[]>) {
  const xs = [1];
  try {
    try { ch.send(xs); return; } finally { use(1); }
  } finally { use(xs); }                                      // error: the inner return goes on out, sent
}
export function finallySendsOnBreak(ch: Channel<number[]>) {
  const xs = [1];
  for (;;) { try { break; } finally { ch.send(xs); } }
  use(xs);                                                    // error: the break goes on after the finally
}
export function finallyReassignsOnBreak(ch: Channel<number[]>) {
  let xs = [1];
  for (;;) { try { ch.send(xs); break; } finally { xs = [2]; } }
  use(xs);                                                    // fine: the finally gives xs a new value
}
export function finallyReturnsInsteadOfBreak(ch: Channel<number[]>) {
  const xs = [1];
  for (;;) { try { ch.send(xs); break; } finally { return; } }
  use(xs);                                                    // fine: not reached
}
export function breakThroughTwoFinallies(ch: Channel<number[]>) {
  const xs = [1];
  outer: for (;;) {
    try { for (;;) { try { break outer; } finally { use(1); } } } finally { ch.send(xs); }
  }
  use(xs);                                                    // error: sent by the outer finally
}
export function continueThroughFinally(ch: Channel<number[]>, flag: boolean) {
  const xs = [1];
  while (flag) { try { continue; } finally { ch.send(xs); } }  // error: sent again next time round
  use(xs);                                                    // error: may have been sent
}
export function finallyOfATryThatNeverEnds(ch: Channel<number[]>) {
  const xs = [1];
  outer: { try { for (;;) {} } finally { ch.send(xs); break outer; } }
  use(xs);                                                    // fine: not reached
}
export function finallyThrowsOfATryThatNeverEnds(ch: Channel<number[]>) {
  const xs = [1];
  try {
    try { for (;;) {} } finally { ch.send(xs); use(1); }
  } catch { use(xs); }                                        // fine: nothing gets here
}
// what may throw after a value is consumed (no call that sends it, which
// would throw itself): an await's rejection, a constructor; consume() and
// import() do not throw
declare const done: Promise<void>;
declare class Thing {}
declare const kept: { value: unknown };
export async function rejected() {
  const xs = [1];
  try { kept.value = consume(xs); await done; return; } catch { use(xs); }  // error: a rejection comes here
}
export function constructed() {
  const xs = [1];
  try { kept.value = consume(xs); new Thing(); return; } catch { use(xs); }  // error: the constructor may throw
}
export function neitherThrows() {
  const xs = [1]; let held: unknown;
  try { held = consume(xs); void import("./try-exits.ts"); return; } catch { use(xs, held); }  // fine
}
declare function tag(strings: TemplateStringsArray, ...values: unknown[]): string;
export function tagged() {
  const xs = [1];
  try { kept.value = consume(xs); tag`x`; return; } catch { use(xs); }  // error: the tag may throw
}
// a try that completes normally goes on after its finally as its block ended,
// not as it began
export function sentInTryThenAfter(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); } finally {}
  use(xs);                                                    // error: was sent
}
export function sentInTryThenFinallyThenAfter(ch: Channel<number[]>) {
  const xs = [1];
  try { ch.send(xs); } finally { use(1); }
  use(xs);                                                    // error: was sent
}
// a throw that no call makes (a getter's, a division's) may reach a finally
// that nothing else does: the finally is checked all the same
declare const getter: { readonly value: number };
export function getterThenForever(ch: Channel<number[]>) {
  const xs = [1];
  try { void getter.value; for (;;) {} } finally { ch.send(xs); use(xs); }  // error
}
export function divisionThenForever(ch: Channel<number[]>, n: bigint) {
  const xs = [1];
  try { void (1n / n); for (;;) {} } finally { ch.send(xs); use(xs); }  // error
}
// such a throw may also come in a try that completes, before what it does
export function getterThenReassigned(ch: Channel<number[]>) {
  let xs = [1];
  ch.send(xs);
  try { void getter.value; xs = [2]; } finally { use(xs); }  // error: the getter may throw before xs is new
  use(xs);                                                    // fine: the try completed, xs is new
}
// what such a throw reaches the finally with goes where the finally goes
export function implicitThenBreak(ch: Channel<number[]>) {
  let xs = [1];
  ch.send(xs);
  outer: { try { void getter.value; xs = [2]; } finally { break outer; } }
  use(xs);                                                    // error: the getter may throw before xs is new
}
export function implicitThenReturn(ch: Channel<number[]>) {
  let xs = [1];
  ch.send(xs);
  try {
    try { void getter.value; xs = [2]; } finally { return; }
  } finally { use(xs); }                                      // error: so may the return
}
// a throw no call makes comes where it may: after what the block did before
export function consumedThenGetter() {
  let xs = [1];
  try { consume(xs); void getter.value; xs = [2]; } finally { use(xs); }  // error: the getter may throw before xs is new
}
export function consumedInCatchThenGetter() {
  let xs = [1];
  try { throw 0; } catch { consume(xs); void getter.value; xs = [2]; } finally { use(xs); }  // error
}
export function writtenAfterConsume() {
  const xs = [1];
  try { kept.value = consume(xs); return; } catch { use(xs); }  // error: a setter may throw
}
// what is not evaluated where it is written throws nothing there
export function declarationsOnly(ch: Channel<number[]>) {
  const xs = [1];
  ch.send(xs);
  outer: { try { let unused: number; interface X { value: number } const f = () => getter.value; for (;;) {} } finally { break outer; } }
  use(xs);                                                    // fine: not reached
}
// each evaluation that may throw does so after what came before it: a
// destructuring's property reads and iterator steps, after the defaults
// before them, and the iterator's closing; a substitution's conversion; a
// spread argument's iteration; a compound assignment's read, before its right
// side; the place of an assignment, before its value; leaving a for-of loop;
// defining a class or an enum; disposing of a `using` declaration's value
declare const pair: { a?: unknown; b: unknown };
declare const items: unknown[];
declare function many(...values: unknown[]): void;
declare class Many { constructor(...values: unknown[]); }
declare const counter: { n: number };
declare const boxes: { box: { value: unknown } };
declare const resource: Disposable;
export function declaredObjectPattern() {
  let xs = [1];
  try { const { a = consume(xs), b } = pair; xs = [2]; } finally { use(xs); }  // error: b's getter may throw
}
export function declaredArrayPattern() {
  let xs = [1];
  try { const [a = consume(xs), b] = items; xs = [2]; } finally { use(xs); }  // error: the next step may throw
}
export function declaredArrayClose() {
  let xs = [1];
  try { const [a = consume(xs)] = items; xs = [2]; } finally { use(xs); }  // error: closing the iterator may throw
}
export function substitutions() {
  let xs = [1];
  try { consume(xs); `${pair}${(xs = [2], 0)}`; } finally { use(xs); }  // error: pair's conversion may throw
}
export function spreadArgument() {
  let xs = [1];
  try { consume(xs); many(...items, (xs = [2], 0)); } finally { use(xs); }  // error: the spread may throw
}
export function spreadConstructorArgument() {
  let xs = [1];
  try { consume(xs); new Many(...items, (xs = [2], 0)); } finally { use(xs); }  // error
}
export function compoundRead() {
  let xs = [1];
  try { consume(xs); counter.n += (xs = [2], 1); } finally { use(xs); }  // error: n's getter may throw
}
export function assignedObjectPattern() {
  let xs = [1]; let a: unknown; let b: unknown;
  try { ({ a = consume(xs), b } = pair); xs = [2]; } finally { use(xs, a, b); }  // error
}
export function assignedArrayPattern() {
  let xs = [1]; let a: unknown; let b: unknown;
  try { [a = consume(xs), b] = items; xs = [2]; } finally { use(xs, a, b); }  // error
}
export function assignedArrayClose() {
  let xs = [1]; let a: unknown;
  try { [a = consume(xs)] = items; xs = [2]; } finally { use(xs, a); }  // error
}
export function placeBeforeValue() {
  let xs = [1];
  try { consume(xs); boxes.box.value = (xs = [2], 0); } finally { use(xs); }  // error: boxes.box may throw
}
export function leftForOf() {
  let xs = [1];
  try { for (const item of items) { consume(xs); break; } xs = [2]; } finally { use(xs); }  // error: closing the iterator may throw
}
export function definedClass() {
  let xs = [1];
  try { consume(xs); class Late { static value = getter.value; } xs = [2]; } finally { use(xs); }  // error
}
export function disposed() {
  let xs = [1];
  try { { using held = resource; consume(xs); } xs = [2]; } finally { use(xs); }  // error: disposing may throw
}
export function definedEnum() {
  let xs = [1];
  try { consume(xs); enum Late { A = getter.value } xs = [2]; } finally { use(xs); }  // error: its member may throw
}
