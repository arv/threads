// Counted built-in cells, as the compiler creates and calls them: no boxed
// handles whose finalization would hide a leak until V8 happens to collect.
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {describe, expect, it} from 'vite-plus/test';
import {own, runtime, threads as T} from './test-heap.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const live = () => {
  own.__collect();
  return T.heapStats().allocated - T.heapStats().freed;
};
const count = (p: number) => runtime.I32[(p >> 2) + 1];
const channel = (p: number) =>
  own.cellView(p) as InstanceType<typeof T.Channel>;
const lock = (p: number) => own.cellView(p) as InstanceType<typeof T.Lock>;
const condition = (p: number) =>
  own.cellView(p) as InstanceType<typeof T.Condition>;
const field = (p: number) => (p >> 2) + 2;

describe('counted built-in cells', () => {
  it('transfers boxed cell messages into raw receivers without losing ownership', async () => {
    const ch = own.newCell(T.Channel, 1),
      handle = new T.Lock();
    await channel(ch).sendAsync(handle);
    expect(count(handle.$cell)).toBe(2);
    const raw = (await channel(ch).recvAsync()) as number;
    expect(raw).toBe(handle.$cell);
    expect(count(raw)).toBe(2);
    own.release(raw);
    expect(count(handle.$cell)).toBe(1);
    own.release(ch);
  });

  it("releases a shared value's interned strings and nested shared values", () => {
    const text = 'counted immutable string',
      str = runtime.$internRef(text);
    const child = T.share({n: 1}),
      childAddress = own.__sharedAddress(child)!;
    const p = own.newShared({text, child});
    expect(count(str)).toBe(2);
    expect(count(childAddress)).toBe(2);
    own.release(p);
    expect(count(str)).toBe(1);
    expect(count(childAddress)).toBe(1);
    own.release(str);
    own.__collect();
    expect(runtime.$internFind(text)).toBe(0);
  });

  it('keeps the heap flat when channels, locks, conditions and shared values are dropped in a long loop', () => {
    const before = live(),
      bytes = T.heapStats().heapBytes;
    for (let k = 0; k < 10000; k++) {
      own.release(own.newCell(T.Channel, 4));
      own.release(own.newCell(T.Lock));
      own.release(own.newCell(T.Condition));
      own.release(own.newShared({value: k}));
      own.quiescent();
    }
    expect(live()).toBe(before);
    expect(T.heapStats().heapBytes - bytes).toBeLessThan(128 << 10);
  });

  it('releases a channel buffer, including ordinary messages, cells, and strings', async () => {
    const Leaf = own.sharedStruct('BufferedLeaf', ['value']);
    const before = live(),
      ch = own.newCell(T.Channel, 4),
      leaf = own.newStruct(Leaf);
    await channel(ch).sendAsync(own.countedRef(leaf));
    await channel(ch).sendAsync({nested: {cell: own.cellView(leaf)}});
    own.release(leaf);
    expect(count(leaf)).toBe(2);
    own.release(ch);
    expect(live()).toBe(before);
  });

  it('retains a channel while recvAsync waits after its caller drops it', async () => {
    const before = live(),
      ch = own.newCell(T.Channel, 1);
    const waiting = channel(ch).recvAsync();
    expect(count(ch)).toBe(2);
    own.release(ch);
    expect(own.collectCycles()).toBe(0);
    expect(count(ch)).toBe(1);
    await channel(ch).sendAsync(42);
    expect(await waiting).toBe(42);
    expect(live()).toBe(before);
  });

  it('retains a sender blocked on a full buffer', async () => {
    const before = live(),
      ch = own.newCell(T.Channel, 1);
    await channel(ch).sendAsync(1);
    const waiting = channel(ch).sendAsync(2);
    own.release(ch);
    expect(count(ch)).toBe(1);
    expect(await channel(ch).recvAsync()).toBe(1);
    await waiting;
    // The unread second message is destroyed with the channel.
    expect(live()).toBe(before);
  });

  it('retains every selected channel until the select leaves its watches', async () => {
    const before = live(),
      a = own.newCell(T.Channel, 1),
      b = own.newCell(T.Channel, 1);
    const waiting = T.selectAsync(channel(a), channel(b));
    own.release(a);
    own.release(b);
    expect([count(a), count(b)]).toEqual([1, 1]);
    await channel(b).sendAsync(7);
    expect(await waiting).toEqual([1, 7, true]);
    expect(live()).toBe(before);
  });

  it('keeps a held lock alive until its hold is disposed', () => {
    const before = live(),
      p = own.newCell(T.Lock);
    const held = lock(p).hold();
    own.release(p);
    expect(count(p)).toBe(1);
    held[Symbol.dispose]();
    held[Symbol.dispose]();
    expect(live()).toBe(before);
  });

  it('keeps a condition and its lock alive throughout an asynchronous wait', async () => {
    const before = live(),
      l = own.newCell(T.Lock),
      c = own.newCell(T.Condition);
    const held = lock(l).hold();
    const waiting = condition(c).waitAsync(lock(l));
    own.release(l);
    own.release(c);
    condition(c).notifyAll();
    await waiting;
    expect(count(l)).toBe(1);
    held[Symbol.dispose]();
    expect(live()).toBe(before);
  });

  it('collects a cycle through a buffered message and preserves an externally rooted cycle', async () => {
    const Owner = own.sharedStruct('ChannelCycleOwner', ['channel'], [0]);
    const before = live(),
      p = own.newStruct(Owner),
      ch = own.newCell(T.Channel, 2);
    own.store(field(p), ch);
    await channel(ch).sendAsync(own.countedRef(p));
    expect(own.collectCycles()).toBe(0);
    own.release(p);
    expect(own.collectCycles()).toBe(2);
    expect(live()).toBe(before);
  });

  it('collects cycles through cells nested in ordinary channel messages and immutable values', async () => {
    const Owner = own.sharedStruct('BlobCycleOwner', ['blob'], [0]);
    for (const throughChannel of [true, false]) {
      const before = live(),
        p = own.newStruct(Owner);
      const v = {nested: {cell: own.cellView(p)}};
      const blob = throughChannel
        ? own.newCell(T.Channel, 1)
        : own.newShared(v);
      if (throughChannel) await channel(blob).sendAsync(v);
      own.store(field(p), blob);
      own.release(p);
      expect(own.collectCycles()).toBe(2);
      expect(live()).toBe(before);
    }
  });

  it('weakly caches immutable copies and gives back their counts after finalization', async () => {
    const p = own.newShared({key: 'copy'});
    (() => {
      const a = own.box(p),
        b = own.box(p);
      expect(a).toBe(b);
      expect(a).toEqual({key: 'copy'});
      expect(count(p)).toBe(2);
    })();
    own.release(p);
    for (let k = 0; k < 100 && runtime.I32[p >> 2] !== runtime.K_FREE; k++) {
      gc();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(runtime.I32[p >> 2]).toBe(runtime.K_FREE);
  });
});
