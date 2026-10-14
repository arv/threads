// A Thread or a Scope stays on the thread that made it: neither is a cell, and the runtime refuses
// to send or share one, or to store one in a struct's field.
import { Channel, f64, go, partition, ref, scope, share, SharedMap, spawn, struct, type Scope, type Sending, type Thread } from "threads";

function inner(): number { return 1; }
function joiner(t: Thread<number>): number { return t.join(); }
function spawner(s: Scope): void { s.spawn(inner); }
function outer(): Thread<number> { return spawn(inner); }
async function later(): Promise<Thread<number>> { return spawn(inner); }
function holder(h: { ts: Thread<number>[] }): void { h.ts[0]!.join(); }

export function sent(ch: Channel<Thread<number>>, m: SharedMap<string, Thread<number>>) {
  spawn(joiner, spawn(inner));               // error: a thread's argument
  spawn(spawner, scope(s => s));             // error: a Scope, kept past its body
  go(holder, { ts: [spawn(inner)] });        // error: in a goroutine's argument, nested
  ch.send(spawn(inner));                     // error: a channel's message
  m.set("t", spawn(inner));                  // error: a map's value
  share([spawn(inner)]);                     // error: shared
  spawn(outer).join();                       // error: a thread's result, which moves to the joiner
  spawn(later);                              // error: an async thread's result
}

interface Holder { t: Thread<number> | null; x: number }
const Holder = struct<Holder>({ t: ref<Thread<number>>(), x: f64 }); // error: no field holds a Thread (as the fork says)

export function fine(ts: Sending<Thread<number>[]>, s: Scope) {
  const kept = [spawn(inner), s.spawn(inner)]; // fine: an ordinary array on this thread
  partition(ts, 2);                          // fine: split on this thread
  spawn(inner).join();                       // fine: joined where it was spawned
  return kept.map(t => t.join());
}
