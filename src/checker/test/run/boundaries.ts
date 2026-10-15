import {
  Channel,
  Condition,
  Lock,
  SharedMap,
  SharedSet,
  type Shared,
  share,
  log,
  struct,
  type Sending,
  ref,
} from '@arv/threads';

function channelUnion(flag: boolean): Channel<Lock> | Channel<Condition> {
  if (flag) {
    const ch = new Channel<Lock>(1);
    ch.send(new Lock());
    return ch;
  }
  const ch = new Channel<Condition>(1);
  ch.send(new Condition());
  return ch;
}
function unionReceivers(flag: boolean): boolean {
  const ch = channelUnion(flag);
  const value = ch.recv()!;
  if (value instanceof Lock) {
    using _ = value.hold();
    return flag;
  }
  value.notifyAll();
  return !flag;
}
async function asyncUnionReceivers(flag: boolean): Promise<boolean> {
  const ch = channelUnion(flag);
  const value = (await ch.recvAsync())!;
  if (value instanceof Lock) {
    using _ = await value.holdAsync();
    return flag;
  }
  value.notifyAll();
  return !flag;
}
function parenthesizedReceive(): boolean {
  const ch = new Channel<Lock>(2);
  ch.send(new Lock());
  ch.send(new Lock());
  // oxfmt-ignore
  const value = ((ch)).recv()!;
  // oxfmt-ignore
  const second = ((ch.recv))()!;
  {
    using _ = value.hold();
  }
  {
    using _ = second.hold();
  }
  return value instanceof Lock && second instanceof Lock;
}
function callbacks(): number {
  const map = new SharedMap<{id: number}, {n: number}>();
  map.set({id: 2}, {n: 3});
  let total = 0;
  map.forEach((value, key) => {
    total += value.n + key.id;
  });
  const set = new SharedSet<{n: number}>();
  set.add({n: 4});
  set.forEach((a, b) => {
    total += a.n + b.n;
  });
  function visit(this: {offset: number}, value: Shared<{n: number}>) {
    total += value.n + this.offset;
  }
  set.forEach(visit, {offset: 1});
  return total;
}
function maps(): number {
  const map = new SharedMap<string, {n: number}>();
  map.set('get', {n: 1});
  return (
    map.get('get')!.n +
    map.getOrInsert('insert', {n: 2}).n +
    map.getOrInsertComputed('computed', () => ({n: 3})).n +
    map.getOrInsertComputed('computed', () => ({n: 100})).n
  );
}
function countedMap(): boolean {
  const map = new SharedMap<string, Lock>();
  map.set('lock', new Lock());
  const lock = map.get('lock')!;
  {
    using _ = lock.hold();
  }
  return (
    map.get('missing') === undefined &&
    map.getOrInsert('lock', new Lock()) === lock
  );
}
function countedIterator() {
  const ch = new Channel<Lock>(1);
  ch.send(new Lock());
  ch.close();
  return ch[Symbol.iterator]();
}
function iteratorValue(): boolean {
  const it = countedIterator();
  const value = it.next().value;
  if (!(value instanceof Lock)) return false;
  {
    using _ = value.hold();
  }
  return true;
}
function iterator() {
  const ch = new Channel<number>(1);
  ch.send(4);
  ch.close();
  return ch[Symbol.iterator]();
}
function computedIterator() {
  const ch = new Channel<number>(1);
  ch.send(5);
  ch.close();
  const key: typeof Symbol.iterator = Symbol.iterator;
  return ch[key]();
}
function asyncIterator() {
  const ch = new Channel<number>(1);
  ch.send(6);
  ch.close();
  return ch[Symbol.asyncIterator]();
}
function temporaryChannel(): Channel<number> {
  const ch = new Channel<number>(1);
  ch.send(7);
  ch.close();
  return ch;
}
function iterators(): number {
  const it = iterator(),
    computed = computedIterator(),
    temp = temporaryChannel()[Symbol.iterator]();
  const recycled = new Channel<number>(1);
  recycled.send(90);
  recycled.close();
  return it.next().value! + computed.next().value! + temp.next().value!;
}
async function asyncIterators(): Promise<number> {
  const it = asyncIterator();
  const recycled = new Channel<number>(1);
  await recycled.sendAsync(90);
  recycled.close();
  return (await it.next()).value!;
}
function nullableValue(value: Sending<{n: number} | null>) {
  return share(value);
}
function nullable(): boolean {
  return nullableValue(null) === null && nullableValue({n: 11})!.n === 11;
}
function calleeEffects(): boolean {
  let trace = '';
  const first = ((trace += 'callee'), share)({n: ((trace += 'arg'), 5)});
  const source = {
    get apply() {
      trace += 'getter';
      return share;
    },
  };
  const second = source.apply({n: ((trace += 'arg'), 7)});
  return trace === 'calleearggetterarg' && first.n + second.n === 12;
}
function mixed(flag: boolean): number {
  const value = share(flag ? new Lock() : {n: 8});
  if (value instanceof Lock) {
    using _ = value.hold();
    return 1;
  }
  return value.n;
}
function narrowed(): number {
  const o: {value: unknown} = {value: new Lock()};
  if (o.value instanceof Lock) {
    {
      using _ = o.value.hold();
    }
    const l = o.value;
    {
      using _ = l.hold();
    }
    return 1;
  }
  return 0;
}
function unknownValues(): boolean {
  const ch = new Channel<unknown>(2);
  ch.send(new Lock());
  ch.send(share({n: 9}));
  const lock = ch.recv(),
    value = ch.recv();
  if (!(lock instanceof Lock)) return false;
  {
    using _ = lock.hold();
  }
  return (value as {n: number}).n === 9;
}
function unionValues(): number {
  const ch = new Channel<Lock | number>(2);
  ch.send(new Lock());
  ch.send(10);
  const lock = ch.recv();
  if (!(lock instanceof Lock)) return -1;
  {
    using _ = lock.hold();
  }
  return ch.recv() as number;
}
async function asyncUnknown(): Promise<boolean> {
  const ch = new Channel<unknown>(1);
  await ch.sendAsync(new Condition());
  const v = await ch.recvAsync();
  return v instanceof Condition;
}
function unknownIteration(): boolean {
  const ch = new Channel<unknown>(1);
  ch.send(new Lock());
  ch.close();
  for (const v of ch) return v instanceof Lock;
  return false;
}
interface Node {
  next: Node | null;
}
const Node = struct<Node>({next: ref<Node>()});
export function allocatingStore(root: Node): void {
  root.next!.next = new Node();
}
export async function main() {
  const results: Record<string, unknown> = {};
  try {
    results.unionReceivers = unionReceivers(true) && unionReceivers(false);
  } catch (e) {
    results.unionReceivers = String(e);
  }
  try {
    results.asyncUnionReceivers =
      (await asyncUnionReceivers(true)) && (await asyncUnionReceivers(false));
  } catch (e) {
    results.asyncUnionReceivers = String(e);
  }
  try {
    results.parenthesizedReceive = parenthesizedReceive();
  } catch (e) {
    results.parenthesizedReceive = String(e);
  }
  try {
    results.callbacks = callbacks();
  } catch (e) {
    results.callbacks = String(e);
  }
  try {
    results.nullable = nullable();
  } catch (e) {
    results.nullable = String(e);
  }
  try {
    results.calleeEffects = calleeEffects();
  } catch (e) {
    results.calleeEffects = String(e);
  }
  try {
    results.countedMap = countedMap();
  } catch (e) {
    results.countedMap = String(e);
  }
  try {
    results.iteratorValue = iteratorValue();
  } catch (e) {
    results.iteratorValue = String(e);
  }
  try {
    results.maps = maps();
  } catch (e) {
    results.maps = String(e);
  }
  try {
    results.iterators = iterators();
  } catch (e) {
    results.iterators = String(e);
  }
  try {
    results.asyncIterators = await asyncIterators();
  } catch (e) {
    results.asyncIterators = String(e);
  }
  try {
    results.mixed = mixed(false) + mixed(true);
  } catch (e) {
    results.mixed = String(e);
  }
  try {
    results.narrowed = narrowed();
  } catch (e) {
    results.narrowed = String(e);
  }
  try {
    results.unknown = unknownValues();
  } catch (e) {
    results.unknown = String(e);
  }
  try {
    results.union = unionValues();
  } catch (e) {
    results.union = String(e);
  }
  try {
    results.asyncUnknown = await asyncUnknown();
  } catch (e) {
    results.asyncUnknown = String(e);
  }
  try {
    results.unknownIteration = unknownIteration();
  } catch (e) {
    results.unknownIteration = String(e);
  }
  log(JSON.stringify(results));
}
