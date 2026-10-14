// consume() and struct() under other names: an import alias, a const that holds one.
import { Channel, consume, consume as take, f64, struct as mk } from "threads";

declare function use(...values: unknown[]): void;
const c2 = consume;

export function viaAlias(ch: Channel<number[]>) {
  const xs = [1];
  ch.send(take(xs));
  use(xs);                                   // error: consumed, under another name
}
export function viaConst(ch: Channel<number[]>) {
  const xs = [1];
  ch.send(c2(xs));
  use(xs);                                   // error: consumed, through a const
}

interface Hidden { v: number }
const Hidden = mk<Hidden>({ v: f64 });     // a struct, declared under another name
export function stored(h: Hidden) {
  return [h];                                // error: a struct in an ordinary array
}
