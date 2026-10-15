import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, describe, expect, it} from 'vite-plus/test';
import {registration} from '../runtime/compiled.ts';
import {compile, toJavaScript} from './compile.ts';
import {API} from './index.ts';

const checker = fileURLToPath(new URL('.', import.meta.url));
const api = new API({cwd: checker});
const dirs: string[] = [];
afterAll(() => {
  api.close();
  for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
});

function program(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-methods-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({type: 'module'}),
  );
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        lib: ['es2022'],
        allowImportingTsExtensions: true,
        paths: {
          '@arv/threads': [path.join(checker, '../runtime/threads.d.ts')],
        },
        noEmit: true,
      },
      include: ['*.ts'],
    }),
  );
  for (const [name, source] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), source);
  const result = compile(path.join(dir, 'tsconfig.json'), {
    runtime: '@arv/threads',
    api,
    check: true,
    types: true,
  });
  return {dir, result};
}

function run(files: Record<string, string>, erased = false) {
  const {dir, result} = program(files);
  expect(result.typeDiagnostics).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  for (const file of result.files) {
    const compiled = toJavaScript(file).code;
    const source = files[path.basename(file.fileName)]!;
    fs.writeFileSync(
      path.join(dir, path.basename(file.fileName, '.ts') + '.js'),
      (erased
        ? stripTypeScriptTypes(source) +
          registration(source, '@arv/threads', compiled).tail
        : compiled
      ).replaceAll(/(['"])\.\/([^'"]+)\.ts\1/g, '$1./$2.js$1'),
    );
  }
  const executed = spawnSync(
    process.execPath,
    [
      path.join(checker, '../run.ts'),
      path.join(dir, 'main.js'),
      '--pool=2',
      '--heap=8',
      '--check',
    ],
    {encoding: 'utf8', timeout: 20_000},
  );
  expect(executed.stderr).toBe('');
  expect(executed.status).toBe(0);
  return {output: executed.stdout, result};
}

describe('struct methods', () => {
  it.each(['result', 'parameter'])(
    'rejects incompatible reference representations in method %ss',
    direction => {
      const {result} = program({
        'main.ts': `import {struct, f64, type Struct} from '@arv/threads';
const Leaf = struct({value: f64}); type Leaf = Struct<typeof Leaf>;
const A = struct({method(${direction === 'parameter' ? 'value: Leaf' : ''}): unknown { return undefined; }});
type A = Struct<typeof A>;
const B = struct({method(${direction === 'parameter' ? 'value: unknown' : ''}): ${direction === 'parameter' ? 'unknown' : 'Leaf'} { return ${direction === 'parameter' ? 'value' : 'new Leaf()'}; }});
function use(a: A) {}
use(new B());
`,
      });
      expect(result.typeDiagnostics).toEqual([]);
      expect(result.diagnostics.some(d => d.code === 96033)).toBe(true);
    },
  );

  it.each(['make', 'take', 'symbol', 'computed'])(
    'rejects incompatible reference layouts in %s methods',
    key => {
      const name =
        key === 'symbol'
          ? '[Symbol.iterator]'
          : key === 'computed'
            ? '[name]'
            : key;
      const parameter = key === 'take';
      const {result} = program({
        'main.ts': `import {struct, f64, type Struct} from '@arv/threads';
const name: string = 'make';
const XY = struct({x: f64, y: f64}); type XY = Struct<typeof XY>;
const YX = struct({y: f64, x: f64}); type YX = Struct<typeof YX>;
const A = struct({${name}(${parameter ? 'v: XY' : ''}): ${parameter ? 'number' : 'XY'} { return ${parameter ? 'v.x' : 'new XY()'}; }});
type A = Struct<typeof A>;
const B = struct({${name}(${parameter ? 'v: YX' : ''}): ${parameter ? 'number' : 'YX'} { return ${parameter ? 'v.x' : 'new YX()'}; }});
function use(a: A) {}
use(new B());
`,
      });
      expect(result.typeDiagnostics).toEqual([]);
      expect(result.diagnostics.some(d => d.code === 96033)).toBe(true);
    },
  );

  it.each([false, true])(
    'dispatches compatible recursive struct methods when erased=%s',
    erased => {
      const {output} = run(
        {
          'main.ts': `import {struct, f64, ref, log} from '@arv/threads';
interface Left { value: number; next: Left | null; echo(value: Left): Left; }
interface Right { value: number; next: Right | null; echo(value: Right): Right; }
const Left = struct<Left>({value: f64, next: ref<Left>(), echo(value: Left): Left { return value; }}, 'compatible/Left');
const Right = struct<Right>({value: f64, next: ref<Right>(), echo(value: Right): Right { return value; }}, 'compatible/Right');
function read(value: Left): number { return value.echo(value).value; }
export function main() {
  const left = new Left(), right = new Right();
  left.value = 7; right.value = 9;
  log(read(left), read(right));
}
`,
        },
        erased,
      );
      expect(output.trim()).toBe('7 9');
    },
  );

  it.each([false, true])(
    'preserves reference defaults and undefined when erased=%s',
    erased => {
      const {output} = run(
        {
          'main.ts': `import {struct, f64, ref, log, type Struct} from '@arv/threads';
const Leaf = struct({value: f64, constructor(value = 7) { this.value = value; }}, 'defaults/Leaf');
type Leaf = Struct<typeof Leaf>;
const Holder = struct({leaf: ref<Leaf>(), constructor(leaf: Leaf | null = new Leaf()) { this.leaf = leaf; }}, 'defaults/Holder');
const C = struct({read(leaf: Leaf | null = new Leaf()): number { return leaf === null ? -1 : leaf.value; }}, 'defaults/C');
let calls = 0;
function missing(): undefined { calls++; return undefined; }
function forward(c: Struct<typeof C>, leaf?: Leaf | null) {
  const value = leaf;
  const boxed: unknown = value;
  const roundTrip = boxed as Leaf | null | undefined;
  const held = new Holder(value).leaf;
  log(c.read(value), held === null ? undefined : held.value, c.read(roundTrip), value === undefined, value === null);
}
function boxedRead(c: unknown, leaf?: unknown): number {
  return (c as {read(leaf?: unknown): number}).read(leaf);
}
export function main() {
  const c = new C();
  log(c.read(), c.read(undefined), c.read(missing()), c.read(null), boxedRead(c), calls);
  forward(c); forward(c, null); forward(c, new Leaf(9));
}
`,
        },
        erased,
      );
      expect(output.trim()).toBe(
        '7 7 7 -1 7 1\n7 7 7 true false\n-1 undefined -1 false true\n9 9 9 false false',
      );
    },
  );

  it('returns synchronous generic method values unchanged', () => {
    const {output, result} = run({
      'main.ts': `import {struct, f64, log} from '@arv/threads';
const Leaf = struct({value: f64});
const C = struct({identity<T>(value: T): T { return value; }});
function boxed(value: unknown, input: unknown): unknown {
  return (value as {identity(input: unknown): unknown}).identity(input);
}
export function main() {
  const c = new C(), leaf = new Leaf(), object = {value: 9};
  leaf.value = 42;
  log(c.identity(7), typeof c.identity(7), c.identity(object) === object,
    c.identity(leaf).value, boxed(c, object) === object);
}
`,
    });
    expect(output.trim()).toBe('7 number true 42 true');
    expect(
      result.files.find(f => f.fileName.endsWith('main.ts'))!.code,
    ).not.toContain('"async":true');
  });

  it('preserves an existing promise returned by a synchronous method', () => {
    expect(
      run({
        'main.ts': `import {struct, log} from '@arv/threads';
const original = Promise.resolve(7);
const C = struct({
  read(): Promise<number> { return original; },
  maybe(flag: boolean): number | Promise<number> { return flag ? original : 7; },
});
function boxed(value: unknown): boolean {
  return (value as {read(): unknown}).read() === original;
}
export function main() {
  const c = new C(), read = c.read;
  log(c.read() === original, read.call(c) === original, boxed(c),
    c.maybe(false), c.maybe(true) === original);
}
`,
      }).output.trim(),
    ).toBe('true true true 7 true');
  });

  it('supports Symbol.iterator in direct, extracted, boxed, and worker calls', () => {
    const {output, result} = run({
      'range.ts': `import {struct, f64, type Struct} from '@arv/threads';
export const Range = struct({
  start: f64, end: f64,
  constructor(start: number, end: number) { this.start = start; this.end = end; },
  [Symbol.iterator](): ArrayIterator<number> { return [this.start, this.end].values(); },
});
export type Range = Struct<typeof Range>;
`,
      'main.ts': `import {log, spawn} from '@arv/threads';
import {Range} from './range.ts';
function sum(range: Range): number { let n = 0; for (const value of range) n += value; return n; }
function boxed(value: unknown): string { return [...(value as Iterable<number>)].join(','); }
export function main() {
  const range = new Range(3, 7);
  const iterate = range[Symbol.iterator];
  const alias: typeof Symbol.iterator = Symbol.iterator;
  log([...range].join(','), sum(range), spawn(sum, range).join(), boxed(range), Array.from(range).join(','));
  log(range[Symbol.iterator]().next().value, iterate.call(range).next().value,
    range[alias]().next().value);
}
`,
    });
    expect(output.trim()).toBe('3,7 10 10 3,7 3,7\n3 3 3');
    expect(
      result.files.find(f => f.fileName.endsWith('main.ts'))!.code,
    ).toContain(', Symbol.iterator)(');
  });

  it('evaluates computed symbol names once and preserves distinct symbol identities', () => {
    expect(
      run({
        'main.ts': `import {struct, log} from '@arv/threads';
let keys = 0;
function iteratorKey(): typeof Symbol.iterator { keys++; return Symbol.iterator; }
const first = Symbol('same'), second = Symbol('same');
const C = struct({
  [iteratorKey()](): ArrayIterator<number> { return [3, 7].values(); },
  [first](): number { return 1; },
  [second](): number { return 2; },
});
export function main() { const c = new C(); log(keys, [...c].join(','), c[first](), c[second]()); }
`,
      }).output.trim(),
    ).toBe('1 3,7 1 2');
  });

  it('retains the receiver captured by an escaped iterator', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, log} from '@arv/threads';
interface Range extends Iterable<number> { value: number; }
const Range = struct<Range, [value: number]>({
  value: f64,
  constructor(value) { this.value = value; },
  [Symbol.iterator](): IterableIterator<number> {
    let done = false;
    return {
      next: (): IteratorResult<number> => {
        if (done) return {done: true, value: undefined};
        done = true;
        return {done: false, value: this.value};
      },
      [Symbol.iterator]() { return this; },
    };
  },
});
function saved(): Iterator<number> { return new Range(42)[Symbol.iterator](); }
export function main() { const iterator = saved(); log(iterator.next().value, iterator.next().done); }
`,
      }).output.trim(),
    ).toBe('42 true');
  });

  it('rejects replacing symbol methods', () => {
    const {result} = program({
      'main.ts': `import {struct} from '@arv/threads';
const C = struct({[Symbol.iterator](): ArrayIterator<number> { return [].values(); }});
export function main() { new C()[Symbol.iterator] = () => [].values(); }
`,
    });
    expect(result.typeDiagnostics).toEqual([]);
    expect(result.diagnostics.map(d => d.code)).toEqual([96041]);
  });

  it('supports computed string, numeric, and dynamic symbol method names', () => {
    expect(
      run({
        'main.ts': `import {struct, log} from '@arv/threads';
function text(): string { return 'read'; }
function number(): number { return 7; }
function symbol(): symbol { return Symbol.for('tests/computed'); }
const S = struct({[text()](n: number): number { return n + 1; }});
const N = struct({[number()](n: number): number { return n + 2; }, 1e2(): number { return 5; }});
const Y = struct({[symbol()](n: number): number { return n + 3; }});
export function main() {
  const s = new S(), n = new N(), y = new Y();
  const sk: string = text(), nk: number = number(), yk: symbol = symbol();
  const read = s[sk], numeric = n[nk], symbolic = y[yk];
  log(s.read(1), s[sk](1), n[7](1), n['7'](1), n[nk](1), y[yk](1), n[100]());
  log(read.call(s, 1), numeric.call(n, 1), symbolic.call(y, 1));
}
`,
      }).output.trim(),
    ).toBe('2 2 3 3 3 4 5\n2 3 4');
  });

  it('coerces computed names once in source order, including __proto__', () => {
    expect(
      run({
        'main.ts': `import {struct, log} from '@arv/threads';
let order = '';
const key = {
  [Symbol.toPrimitive](hint: string) { order += hint + ','; return '__proto__'; },
};
function first(): string { order += 'first,'; return key as unknown as string; }
function second(): number { order += 'second,'; return 2; }
const C = struct({[first()](): number { return 1; }, [second()](): number { return 2; },
  ['extra' as string](): number { return 3; },
});
export function main() {
  const c = new C();
  log(order, c['__proto__'](), c[2](), c.extra());
  order = '';
  const extracted = c[key as unknown as string], direct = c[key as unknown as string]();
  log(order, extracted.call(c), direct);
}
`,
      }).output.trim(),
    ).toBe('first,string,second, 1 2 3\nstring,string, 1 1');
  });

  it('preserves reference arguments and results through dynamic keys and worker calls', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, log, spawn, type Struct} from '@arv/threads';
const Leaf = struct({value: f64}); type Leaf = Struct<typeof Leaf>;
function name(): 'link' | 'other' { return 'link'; }
const C = struct({[name()](leaf: Leaf): Leaf { return leaf; }}); type C = Struct<typeof C>;
function read(c: C, leaf: Leaf): number { const key: string = name(); return c[key](leaf).value; }
function boxed(value: unknown, leaf: unknown): number {
  return ((value as {[key: string]: (leaf: unknown) => unknown})['link'](leaf) as {value: number}).value;
}
export function main() {
  const c = new C(), leaf = new Leaf(); leaf.value = 42;
  const key: string = name(), link = c[key];
  log(read(c, leaf), spawn(read, c, leaf).join(), link.call(c, leaf).value, boxed(c, leaf));
}
`,
      }).output.trim(),
    ).toBe('42 42 42 42');
  });

  it('keeps the original receiver alive when property-key coercion replaces it', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, log, type Struct} from '@arv/threads';
const C = struct({value: f64, read(): number { return this.value; }});type C = Struct<typeof C>;
const Holder = struct({current: ref<C>()});
const holder = new Holder();
function make(value: number): C { const c = new C(); c.value = value; return c; }
const key = {[Symbol.toPrimitive]() { holder.current = make(20); return 'read'; }};
export function main() {
  holder.current = make(1);
  log(holder.current![key as unknown as 'read'](), holder.current!.value);
}
`,
      }).output.trim(),
    ).toBe('1 20');
  });

  it('infers fields and this, and calls methods across workers without boxing', () => {
    const {output, result} = run({
      'counter.ts': `import {struct, f64, type Struct} from '@arv/threads';
export const Counter = struct({
  value: f64,
  add(n: number) { this.value += n; return this.value; },
  snapshot(): number[] { return [this.value]; },
  self() { return this; },
  closure(): () => number { return () => this.value; },
});
export type Counter = Struct<typeof Counter>;
`,
      'main.ts': `import {log, spawn} from '@arv/threads';
import {Counter} from './counter.ts';
function bump(c: Counter): number { return c.add(3); }
function narrowed(c: unknown): number { return c instanceof Counter ? c.add(1) : 0; }
export function main() {
  const c = new Counter();
  c.add(2);
  log(spawn(bump, c).join());
  log((c['add'])(4), c.snapshot().join(','), c.closure()(), c.self() === c);
  log(narrowed(c));
}
`,
    });
    expect(output.trim().split('\n')).toEqual(['5', '9 9 9 true', '10']);
    const code = result.files.find(f => f.fileName.endsWith('main.ts'))!.code;
    expect(code).toContain('__structMethod(c, "add")(c, 2)');
    expect(code).not.toContain('__box(c).add');
  });

  it('supports explicit recursive types, reference arguments and results, and boxed calls', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, log, type Struct} from '@arv/threads';
interface Node {
  value: number;
  next: Node | null;
  link(other: Node): Node;
  self(): Node;
}
const Node = struct<Node>({
  value: f64, next: ref<Node>(),
  link(other: Node): Node { this.next = other; return this.next!; },
  self(): Node { return this; },
});
function boxed(value: unknown): number {
  const n = value as {value: number; self(): unknown; link(other: unknown): unknown};
  return (n.link(n.self()) as {value: number}).value;
}
export function main() {
  const a = new Node(), b = new Node();
  b.value = 42;
  log(a.link(b).value, a.self() === a, boxed(b));
  const link = a.link, bound = link.bind(a);
  log(link.call(a, b).value, bound(b).value);
  const name: 'link' = 'link';
  log(a[name](b).value);
  a.next = null; b.next = null;
}
`,
      }).output.trim(),
    ).toBe('42 true 42\n42 42\n42');
  });

  it('keeps a receiver alive when arguments replace it, and when an arrow escapes', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, log, type Struct} from '@arv/threads';
const Counter = struct({
  value: f64,
  add(n: number): number { this.value += n; return this.value; },
  closure(): () => number { return () => this.value; },
});
type Counter = Struct<typeof Counter>;
function make(value: number): Counter { const c = new Counter(); c.value = value; return c; }
function saved(): () => number { const c = make(21); return c.closure(); }
export function main() {
  let c = make(1);
  log(c.add((c = make(20), 2)), c.value, saved()());
  log(c[(c = make(30), 'add')](2), c.value);
}
`,
      }).output.trim(),
    ).toBe('3 20 21\n22 30');
  });

  it('separates same-named, same-shaped declarations in different modules', () => {
    expect(
      run({
        'a.ts': `import {struct, f64} from '@arv/threads';
export const Counter = struct({value: f64, read(): number { return this.value + 1; }});`,
        'b.ts': `import {struct, f64} from '@arv/threads';
export const Counter = struct({value: f64, read(): number { return this.value + 2; }});`,
        'main.ts': `import {log} from '@arv/threads';
import {Counter as A} from './a.ts'; import {Counter as B} from './b.ts';
export function main() { log(new A().read(), new B().read()); }`,
      }).output.trim(),
    ).toBe('1 2');
  });

  it('supports async methods, explicit receivers, defaults, and method-to-method calls', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, log} from '@arv/threads';
interface Counter {
  value: number;
  add(n?: number): number;
  later(): Promise<Counter>;
}
const Counter = struct<Counter>({
  value: f64,
  add(this: Counter, n = 2): number { this.value += n; return this.value; },
  async later(): Promise<Counter> {
    await Promise.resolve();
    this.add();
    return this;
  },
});
async function boxed(value: unknown): Promise<number> {
  const c = value as {later(): Promise<unknown>};
  return ((await c.later()) as {value: number}).value;
}
function transient(): Promise<Counter> {
  const c = new Counter();
  return c.later();
}
export async function main() {
  const c = new Counter();
  log((await c.later()).value, await boxed(c));
  log((await transient()).value);
}
`,
      }).output.trim(),
    ).toBe('2 4\n2');
  });

  it('releases an async receiver when its awaited call rejects', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, heapStats, log} from '@arv/threads';
const C = struct({
  value: f64,
  async fail(): Promise<number> {
    await Promise.resolve();
    if (this.value === 0) throw new Error('failed');
    return this.value;
  },
});
function transient(): Promise<number> { const c = new C(); return c.fail(); }
export async function main() {
  const before = heapStats();
  try { await transient(); } catch (e) { log((e as Error).message); }
  const after = heapStats();
  log(after.allocated - before.allocated, after.freed - before.freed);
}
`,
      }).output.trim(),
    ).toBe('failed\n1 1');
  });

  it('releases new references returned through extracted and bound methods', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, heapStats, log, type Struct} from '@arv/threads';
const Leaf = struct({value: f64});
type Leaf = Struct<typeof Leaf>;
const Factory = struct({make(): Leaf { return new Leaf(); }});
export function main() {
  const factory = new Factory(), make = factory.make, bound = make.bind(factory);
  const before = heapStats();
  log(make.call(factory).value, bound().value);
  const after = heapStats();
  log(after.allocated - before.allocated, after.freed - before.freed);
}
`,
      }).output.trim(),
    ).toBe('0 0\n2 2');
  });

  it('rejects closures as fields, generators, reserved names, and local declarations', () => {
    const {result} = program({
      'main.ts': `import {struct, f64} from '@arv/threads';
const Bad = struct({value: f64, read: () => 1});
const Generator = struct({*read() { yield 1; }});
const Reserved = struct({$cell() {}});
function local() { return struct({read() { return 1; }}); }
`,
    });
    expect(result.diagnostics.map(d => d.code)).toEqual([
      96015, 96040, 96040, 96040,
    ]);
  });

  it('rejects replacing methods by property or element access', () => {
    const {result} = program({
      'main.ts': `import {struct} from '@arv/threads';
const C = struct({read() { return 1; }});
export function main() {
  const c = new C();
  c.read = () => 2;
  c['read'] = () => 3;
}`,
    });
    expect(result.diagnostics.map(d => d.code)).toEqual([96041, 96041]);
  });

  it('calls methods on inline array elements and preserves nested function receivers', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, SharedArray, log} from '@arv/threads';
const Counter = struct({
  value: f64,
  add(n: number) { this.value += n; return this.value; },
  read() {
    const __self = 40;
    function ordinary(this: {n: number}) { return this.n; }
    const local = new class { value = 1; twice = this.value * 2; }();
    return __self + ordinary.call({n: 1}) + local.twice - 2 + this.value;
  },
});

export function main() {
  const values = new SharedArray(Counter, 2);
  values[1].add(1);
  log(values[0].read(), values[1].read());
}
`,
      }).output.trim(),
    ).toBe('41 42');
  });
});

describe('struct constructors', () => {
  it('applies reference defaults for omitted and explicitly undefined arguments', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, log, type Struct} from '@arv/threads';
const Leaf = struct({value: f64, constructor(value = 11) { this.value = value; }});
type Leaf = Struct<typeof Leaf>;
const Holder = struct({
  leaf: ref<Leaf>(),
  constructor(leaf: Leaf | null = new Leaf()) { this.leaf = leaf; },
});
let calls = 0;
function missing(): undefined { calls++; return undefined; }
export function main() {
  const Box = Holder as unknown as new (leaf?: unknown) => {leaf: {value: number}};
  log(new Holder().leaf!.value, new Holder(undefined).leaf!.value,
    new Holder(missing()).leaf!.value, new Holder(null).leaf === null,
    new Box(undefined).leaf.value, calls);
}
`,
      }).output.trim(),
    ).toBe('11 11 11 true 11 1');
  });

  it('infers arguments, zeroes fields before initialization, and runs in other workers', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, bool, spawn, log, type Struct} from '@arv/threads';
const Point = struct({
  x: f64, y: f64, wasZero: bool,
  constructor(x: number, y = 2) {
    this.wasZero = this.x === 0 && this.y === 0;
    this.x = x; this.y = y;
    this.shift(1);
  },
  shift(n: number) { this.x += n; },
  sum() { return this.x + this.y; },
});
type Point = Struct<typeof Point>;
function make(x: number): number { return new Point(x).sum(); }
function read(p: Point): number { return p.sum(); }
export function main() {
  const p = new Point(3);
  log(p.wasZero, p.sum(), spawn(make, 5).join(), spawn(read, p).join());
}
`,
      }).output.trim(),
    ).toBe('true 6 8 6');
  });

  it('supports explicit instance and argument types, references, spreads, and boxed construction', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, log} from '@arv/threads';
interface Node { value: number; next: Node | null; }
const Node = struct<Node, [value: number, next?: Node | null]>({
  value: f64, next: ref<Node>(),
  constructor(value, next = null) { this.value = value; this.next = next; },
});
const Sum = struct({
  value: f64,
  constructor(...values: number[]) { this.value = values.reduce((a, b) => a + b, 0); },
});
function boxed(K: new (n: number) => unknown): number {
  return (new K(9) as {value: number}).value;
}
function boxedWithNext(next: unknown): number {
  const K = Node as unknown as new (value: number, next: unknown) => {next: {value: number}};
  return new K(10, next).next.value;
}
export function main() {
  const a = new Node(2), b = new Node(3, a);
  const args: [number] = [4];
  log(a.value, b.next!.value, new Node(...args).value, boxed(Node), boxedWithNext(a), new Sum(1, 2, 3).value);
}
`,
      }).output.trim(),
    ).toBe('2 2 4 9 2 6');
  });

  it('releases partially initialized allocations when a constructor throws', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, heapStats, log, type Struct} from '@arv/threads';
const Leaf = struct({value: f64});
type Leaf = Struct<typeof Leaf>;
const Broken = struct({
  child: ref<Leaf>(),
  constructor() { this.child = new Leaf(); throw new Error('broken'); },
});
export function main() {
  const before = heapStats();
  try { new Broken(); } catch (e) { log((e as Error).message); }
  const after = heapStats();
  log(after.allocated - before.allocated, after.freed - before.freed);
}
`,
      }).output.trim(),
    ).toBe('broken\n2 2');
  });

  it('preserves references published before a constructor throws', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, ref, log} from '@arv/threads';
interface Item { value: number; }
interface Holder { item: Item | null; }
const Holder = struct<Holder>({item: ref<Item>()});
const Item = struct<Item, [holder: Holder]>({
  value: f64,
  constructor(holder) { this.value = 42; holder.item = this; throw new Error('published'); },
});
export function main() {
  const holder = new Holder();
  try { new Item(holder); } catch {}
  log(holder.item!.value);
  holder.item = null;
}
`,
      }).output.trim(),
    ).toBe('42');
  });

  it('discards constructor return values and keeps inline array elements zeroed', () => {
    expect(
      run({
        'main.ts': `import {struct, f64, heapStats, SharedArray, log} from '@arv/threads';
const Leaf = struct({value: f64});
const Item = struct({
  value: f64,
  constructor(n = 7) { this.value = n; if (n) return new Leaf(); return {value: 99}; },
});
export function main() {
  const before = heapStats();
  log(new Item().value, new Item(0).value);
  const after = heapStats();
  log(after.allocated - before.allocated, after.freed - before.freed);
  const items = new SharedArray(Item, 1);
  log(items[0].value);
}
`,
      }).output.trim(),
    ).toBe('7 0\n3 3\n0');
  });

  it('checks inferred constructor arguments and rejects asynchronous initializers', () => {
    const {result} = program({
      'main.ts': `import {struct, f64} from '@arv/threads';
const Item = struct({value: f64, constructor(value: number) { this.value = value; }});
new Item(); new Item('wrong');
const Async = struct({async constructor() {}});
const Generator = struct({*constructor() { yield 1; }});
const Generic = struct({constructor<T>(value: T) {}});
const Field = struct({constructor: f64});
`,
    });
    expect(result.typeDiagnostics.map(d => d.code)).toEqual([2554, 2345]);
    expect(result.diagnostics.map(d => d.code)).toEqual([
      96040, 96040, 96040, 96042,
    ]);
  });
});
