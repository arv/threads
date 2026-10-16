import {
  Channel,
  Condition,
  Lock,
  share,
  heapStats,
  log,
  struct,
  ref,
  type Shared,
  collectCycles,
  select,
} from '@arv/threads';

const Holder = struct({
  ch: ref<Channel<number>>(),
  lock: ref<Lock>(),
  condition: ref<Condition>(),
  value: ref<Shared<{n: number}>>(),
});
function allocated() {
  const h = new Holder();
  h.ch = new Channel<number>(1);
  h.ch.close();
  h.lock = new Lock();
  {
    using _held = h.lock.hold();
  }
  h.condition = new Condition();
  h.condition.notifyAll();
  h.value = share({n: 42});
}
function returnedChannel(): Channel<number> {
  return new Channel<number>(1);
}
function returnedValue(): Shared<{n: number}> {
  return share({n: 7});
}
function replacedReceiver(): void {
  let a = new Channel<number>(1);
  a.send(((a = new Channel<number>(1)), 5));
}
function loopback(): void {
  const channels = new Channel<Channel<number>>(1);
  channels.send(new Channel<number>(1));
  const ch = channels.recv()!;
  ch.close();
  const locks = new Channel<Lock>(1);
  locks.send(new Lock());
  const l = locks.recv()!;
  {
    using _held = l.hold();
  }
  const conditions = new Channel<Condition>(1);
  conditions.send(new Condition());
  const c = conditions.recv()!;
  c.notifyAll();
  const values = new Channel<Shared<{n: number}>>(1);
  values.send(returnedValue());
  const _value = values.recv()!;
}
export function main() {
  const start = heapStats();
  for (let k = 0; k < 10000; k++) {
    const ch = returnedChannel();
    const c = new Condition();
    const l = new Lock();
    const _v = returnedValue();
    ch.send(k);
    select(ch);
    ch.close();
    c.notifyOne();
    {
      using _held = l.hold();
    }
    allocated();
    replacedReceiver();
    loopback();
  }
  collectCycles();
  const end = heapStats();
  log(
    `cells left ${end.allocated - start.allocated - (end.freed - start.freed)} bounded ${end.heapBytes - start.heapBytes < 1 << 20}`,
  );
}
