import {
  Channel,
  Condition,
  Lock,
  SharedMap,
  SharedSet,
  type Shared,
  share,
  select,
  selectAsync,
  log,
  struct,
  type Sending,
  ref,
} from '@arv/threads';

function escapedValueOf(): unknown {
  const ch = new Channel<number>(1);
  ch.send(7);
  ch.close();
  return ch.valueOf();
}
function inheritedReceiver(): boolean {
  const value = escapedValueOf();
  const recycled = new Channel<number>(1);
  recycled.send(99);
  recycled.close();
  return value instanceof Channel && value.recv() === 7;
}
function boxedReceiver(source: Channel<Lock> | number): boolean {
  if (!(source instanceof Channel)) return false;
  const value = source.recv()!;
  {
    using _ = value.hold();
  }
  return value instanceof Lock;
}
function boxedLoop(source: Channel<Lock> | number): boolean {
  if (!(source instanceof Channel)) return false;
  for (const value of source) {
    using _ = value.hold();
    return value instanceof Lock;
  }
  return false;
}
function boxedReceivers(): boolean {
  const a = new Channel<Lock>(1),
    b = new Channel<Lock>(1);
  a.send(new Lock());
  b.send(new Lock());
  a.close();
  b.close();
  return boxedReceiver(a) && boxedLoop(b);
}
function nativeSelectSource(): Channel<unknown> {
  const source = new Channel<Lock | Shared<{n: number}> | null | undefined>(4);
  source.send(new Lock());
  source.send(share({n: 7}));
  source.send(null);
  source.send(void 0);
  source.close();
  return source;
}
type Selected = [number, unknown, boolean];
function validSelectedValues(
  lock: Selected,
  blob: Selected,
  nullable: Selected,
  missing: Selected,
  closed: Selected,
): boolean {
  return (
    lock[1] instanceof Lock &&
    lock[2] &&
    (blob[1] as {n: number}).n === 7 &&
    blob[2] &&
    nullable[1] === null &&
    nullable[2] &&
    missing[1] === void 0 &&
    missing[2] &&
    closed[1] === void 0 &&
    !closed[2]
  );
}
function nativeSyncSelectValues(): boolean {
  const ch = nativeSelectSource();
  return validSelectedValues(
    select(ch),
    select(ch),
    select(ch),
    select(ch),
    select(ch),
  );
}
async function nativeSelectValues(): Promise<boolean> {
  const ch = nativeSelectSource();
  return validSelectedValues(
    await selectAsync(ch),
    await selectAsync(ch),
    await selectAsync(ch),
    await selectAsync(ch),
    await selectAsync(ch),
  );
}
function nullSends(): boolean {
  const ch = new Channel<Lock | null | undefined>(2);
  ch.send(null);
  ch.send(void 0);
  const widened: Channel<unknown> = ch;
  return widened.recv() === null && widened.recv() === void 0;
}
async function asyncNullSends(): Promise<boolean> {
  const ch = new Channel<Lock | null | undefined>(2);
  await ch.sendAsync(null);
  await ch.sendAsync(void 0);
  const widened: Channel<unknown> = ch;
  return (
    (await widened.recvAsync()) === null &&
    (await widened.recvAsync()) === void 0
  );
}
function closedReceive(): boolean {
  const ch = new Channel<Lock>();
  ch.close();
  return ch.recv() === void 0;
}
async function asyncClosedReceive(): Promise<boolean> {
  const ch = new Channel<Lock>();
  ch.close();
  return (await ch.recvAsync()) === void 0;
}
function conditionalReceives(flag: boolean): boolean {
  const locks = new Channel<Lock>(1),
    numbers = new Channel<number>(1);
  locks.send(new Lock());
  numbers.send(12);
  const value = (flag ? locks : numbers).recv();
  return flag ? value instanceof Lock : value === 12;
}
function conditionalIteration(flag: boolean): boolean {
  const locks = new Channel<Lock>(1),
    numbers = new Channel<number>(1);
  locks.send(new Lock());
  numbers.send(12);
  locks.close();
  numbers.close();
  for (const value of flag ? locks : numbers)
    return flag ? value instanceof Lock : value === 12;
  return false;
}
function fallback(maybe: Channel<number> | null): boolean {
  const ch = new Channel<number>(2);
  ch.send(1);
  ch.send(2);
  return (maybe || ch).recv() === 1 && (maybe ?? ch).recv() === 2;
}
function widenedCallbacks(): boolean {
  const map = new SharedMap<string, Lock>();
  map.set('lock', new Lock());
  const set = new SharedSet<Lock>();
  set.add(new Lock());
  let fromMap = false,
    fromSet = false;
  map.forEach((value: unknown) => {
    fromMap = value instanceof Lock;
  });
  set.forEach((value: unknown) => {
    fromSet = value instanceof Lock;
  });
  return fromMap && fromSet;
}
function makeLock(): Lock {
  return new Lock();
}
function computedCallback(): boolean {
  const map = new SharedMap<string, Lock>();
  const value = map.getOrInsertComputed('lock', makeLock);
  {
    using _ = value.hold();
  }
  map.clear();
  return value instanceof Lock;
}
function keyLookups(): boolean {
  const key = new Lock(),
    map = new SharedMap<Lock, number>(),
    set = new SharedSet<Lock>();
  map.set(key, 3);
  set.add(key);
  const result = map.get(key) === 3 && map.has(key) && set.has(key);
  return result && map.delete(key) && set.delete(key);
}
function computedKeyCallback(): boolean {
  const key = new Lock(),
    map = new SharedMap<Lock, Lock>();
  const value = map.getOrInsertComputed(key, key => {
    using _ = key.hold();
    return new Lock();
  });
  {
    using _ = value.hold();
  }
  return map.has(key);
}
function cellDataMap(): boolean {
  const map = new SharedMap<string, {$cell: number; nested: {n: number}}>();
  map.set('data', {$cell: 1, nested: {n: 9}});
  const value = map.get('data')!;
  return value.$cell === 1 && value.nested.n === 9;
}
function nullishMapEntries(): boolean {
  const map = new SharedMap<Lock | null | undefined, Lock | null | undefined>();
  map.set(null, null);
  map.set(void 0, void 0);
  const set = new SharedSet<Lock | null | undefined>();
  set.add(null);
  set.add(void 0);
  return (
    map.size === 2 &&
    set.size === 2 &&
    map.has(null) &&
    map.has(undefined) &&
    map.get(null) === null &&
    map.get(undefined) === undefined &&
    set.has(null) &&
    set.has(undefined)
  );
}
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
    results.nativeSyncSelectValues = nativeSyncSelectValues();
  } catch (e) {
    results.nativeSyncSelectValues = String(e);
  }
  try {
    results.nativeSelectValues = await nativeSelectValues();
  } catch (e) {
    results.nativeSelectValues = String(e);
  }
  try {
    results.cellDataMap = cellDataMap();
  } catch (e) {
    results.cellDataMap = String(e);
  }
  try {
    results.inheritedReceiver = inheritedReceiver();
  } catch (e) {
    results.inheritedReceiver = String(e);
  }
  try {
    results.boxedReceivers = boxedReceivers();
  } catch (e) {
    results.boxedReceivers = String(e);
  }
  try {
    results.nullSends = nullSends();
  } catch (e) {
    results.nullSends = String(e);
  }
  try {
    results.asyncNullSends = await asyncNullSends();
  } catch (e) {
    results.asyncNullSends = String(e);
  }
  try {
    results.closedReceive = closedReceive();
  } catch (e) {
    results.closedReceive = String(e);
  }
  try {
    results.asyncClosedReceive = await asyncClosedReceive();
  } catch (e) {
    results.asyncClosedReceive = String(e);
  }
  try {
    results.nullishMapEntries = nullishMapEntries();
  } catch (e) {
    results.nullishMapEntries = String(e);
  }
  try {
    results.keyLookups = keyLookups();
  } catch (e) {
    results.keyLookups = String(e);
  }
  try {
    results.computedKeyCallback = computedKeyCallback();
  } catch (e) {
    results.computedKeyCallback = String(e);
  }
  try {
    results.conditionalReceives =
      conditionalReceives(true) && conditionalReceives(false);
  } catch (e) {
    results.conditionalReceives = String(e);
  }
  try {
    results.conditionalIteration =
      conditionalIteration(true) && conditionalIteration(false);
  } catch (e) {
    results.conditionalIteration = String(e);
  }
  try {
    results.fallback = fallback(null);
  } catch (e) {
    results.fallback = String(e);
  }
  try {
    results.widenedCallbacks = widenedCallbacks();
  } catch (e) {
    results.widenedCallbacks = String(e);
  }
  try {
    results.computedCallback = computedCallback();
  } catch (e) {
    results.computedCallback = String(e);
  }
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
