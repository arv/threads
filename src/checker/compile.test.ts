// compile (compile.ts, transform.ts): what it emits for the corners of the
// lowering (test/emit), the source map back to the original, the types
// stripped, and threads-check compile writing a project.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decode, encode} from '@jridgewell/sourcemap-codec';
import {API} from 'typescript/sync';
import {afterAll, describe, expect, it} from 'vite-plus/test';
import {compile, composeMaps, toJavaScript} from './compile.ts';
import type {CompiledFile} from './compile.ts';

const checker = fileURLToPath(new URL('.', import.meta.url));
const api = new API({cwd: checker});
afterAll(() => api.close());

const corners = (() => {
  const result = compile(path.join(checker, 'test/emit/tsconfig.json'), {
    runtime: 'threads',
    api,
  });
  return result.files.find(f => f.fileName.endsWith('corners.ts'))!;
})();
const js = toJavaScript(corners).code;
const fixes = (() => {
  const result = compile(path.join(checker, 'test/emit/tsconfig.json'), {
    runtime: 'threads',
    api,
  });
  return toJavaScript(result.files.find(f => f.fileName.endsWith('fixes.ts'))!)
    .code;
})();
// a project of these files, in a directory of its own
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
});
const runtimeTypes = path.join(checker, '../runtime/threads.d.ts');
function project(files: Record<string, string>, options: object = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-compile-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        lib: ['es2022'],
        paths: {threads: [runtimeTypes]},
        ...options,
      },
      include: ['*.ts', '*.js'],
    }),
  );
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const APP = `import {f64, struct, type Struct} from 'threads';\nconst P = struct({x: f64});\nexport function main(): number {\n  return new P().x;\n}\n`;
// the JavaScript of one function
const fn = (name: string) => {
  const start = js.indexOf(`function ${name}(`);
  return js.slice(start, js.indexOf('\n}\n', start) + 2);
};

describe('compile', () => {
  it('imports the helpers it uses and registers the top-level functions', () => {
    expect(js).toMatch(
      /^import \{ F64 as __F64, I32 as __I32, U8 as __U8, capture as __capture, .*register as __register, .*\} from "threads";$/m,
    );
    expect(js).toMatch(
      /__register\(import\.meta\.url, \{[^}]*\blabeled,[^}]*\breceiveOne\b/,
    );
  });

  it('lays out struct fields and SharedArray elements', () => {
    expect(js).toContain(
      'const Node = __sharedStruct("Node", [\n\t"value",\n\t"next",\n\t"name",\n\t"on"\n], [1], "frsb");',
    );
    const elements = fn('elements');
    // checked, and (in a counting loop over its length) unchecked
    expect(elements).toContain(
      'i >>> 0 === i && i < __I32[nodes + 4 >> 2] ? nodes + 16 + i * 40 : __outOfBounds[i]',
    );
    expect(elements).toContain('t += __F64[(nodes + 16 + j * 40 >> 3) + 1]');
  });

  it('counts references: owned locals released, returns moved, borrows retained', () => {
    const returns = fn('returns');
    expect(returns).toContain('let b = __newStruct(Node);');
    expect(returns).toContain(
      'return which ? (_a = b, b = 0, _a) : (_b = c, c = 0, _b);',
    );
    expect(returns).toMatch(
      /\} finally \{\n\t\t\t__release\(c\);\n\t\t\}\n\t\} finally \{\n\t\t__release\(b\);/,
    );
    expect(fn('logical')).toMatch(
      /x \|\| \(\w+ = __retain\(other\), \w+ = x, x = \w+, __release\(\w+\), x\);/,
    );
    expect(fn('receive')).toContain('finally {\n\t\t\t__release(n);');
    expect(fn('quiescent')).toContain('__quiescent();\n\t\t\tcontinue;');
    expect(fn('moves')).toContain('s.spawn(receiveOne, __countedRef(n));');
    expect(fn('closures')).toContain('__capture(inner, list, head);');
  });

  it('maps what it lowered back to the original', () => {
    const {code, map} = toJavaScript(corners);
    const lines = code.split('\n');
    const at = lines.findIndex(l =>
      l.includes('__storeStr((n >> 2) + 6, "a")'),
    );
    const column = lines[at]!.indexOf('__storeStr');
    const segment = decode(map.mappings)
      [at]!.filter(s => s[0] <= column)
      .at(-1)!;
    const source = map.sourcesContent![0]!.split('\n')[segment[2]!]!;
    expect(source.trim()).toBe("n.name = 'a';");
  });

  it('keeps a column the intermediate code maps to nothing unmapped', () => {
    const map = (mappings: number[][][]) => ({
      version: 3 as const,
      file: 'x.js',
      sources: ['x.ts'],
      sourcesContent: [''],
      names: [],
      mappings: encode(mappings as never),
    });
    // the outer map's columns 4 (to an unmapped column) and 8 (unmapped)
    const composed = composeMaps(
      map([[[0, 0, 0, 0], [4, 0, 0, 4], [8]]]),
      map([[[0, 0, 0, 0], [3]]]),
    );
    expect(decode(composed.mappings)).toEqual([[[0, 0, 0, 0], [4], [8]]]);
  });

  it('leaves a file that does not use the runtime as it is', () => {
    const file: CompiledFile = compile(
      path.join(checker, 'test/emit/tsconfig.json'),
      {runtime: 'not-the-runtime', api},
    ).files[0]!;
    expect(file.changed).toBe(false);
    expect(file.registered).toEqual([]);
  });

  it('strips the types with OXC, and leaves `using` as it is written', () => {
    const file: CompiledFile = {
      fileName: 'x.ts',
      code: 'import type {T} from "t";\nexport function f(x: T): number {\n  using r = x as any;\n  return 1;\n}\n',
      map: {version: 3, sources: ['x.ts'], names: [], mappings: ''},
      changed: false,
      registered: [],
    };
    expect(toJavaScript(file).code).toBe(
      'export function f(x) {\n\tusing r = x;\n\treturn 1;\n}\n',
    );
  });
});

describe('compile, where the fork does not', () => {
  it("runs an owned parameter's default around a concise body that is a closure", () => {
    expect(fixes).toContain(
      'export const later = (p) => {\n\tp = p === void 0 ? __newStruct(Node) : __retain(p);',
    );
  });

  it('runs the defaults left to right when one moves into the body', () => {
    expect(fixes).toContain('export function ordered(a, b) {');
    expect(fixes).toMatch(
      /a = a === void 0 \? __newStruct\(Node\) : __retain\(a\);\n\ttry \{\n\t\tif \(b === void 0\) \{\n\t\t\tb = a;/,
    );
  });

  it('runs a default with temporaries in the body, which declares them', () => {
    expect(fixes).toContain(
      'export function counted(n) {\n\tvar _a, _b;\n\tif (n === void 0) {\n\t\tn = (_b = read(_a = __newStruct(Node)), __release(_a), _b);',
    );
  });

  it('reads an array before the index that assigns it, and holds it', () => {
    expect(fixes).toContain(
      '_a = __retain(a), _d = (_b = __retain(b), _c = a, a = _b, __release(_c), 0), _d >>> 0 === _d && _d < __I32[_a + 4 >> 2] ? __F64[(_a + 16 >> 3) + _d] : __outOfBounds[_d]), __release(_a)',
    );
  });

  it("runs a class's heritage as a full expression, which releases what it holds", () => {
    expect(fixes).toContain('_f = (_e = (element = (_a = __retain(first),');
    expect(fixes).toContain('Base), __release(_a), _a = 0, _e);');
    expect(fixes).toContain('export class Derived extends _f {}');
  });

  it('keeps a parameter whose default moves optional, after an optional one', () => {
    expect(fixes).toContain('export function afterOptional(o, p, q) {');
  });

  it("runs a scalar element type's expression", () => {
    expect(fixes).toContain('__newSharedArray((calls++, Number, 8), n)');
  });

  // The fork comparison harness was removed in #62. Keep its new known
  // differences here, with executable counterparts in test/run/moved.ts.
  it('releases a nested var at function exit', () => {
    expect(fixes).toMatch(
      /function functionVar\(\) \{\n\tvar [^\n]+;\n\tvar p = 0;\n\ttry \{/,
    );
    expect(fixes).toMatch(/finally \{\n\t\t__release\(p\);\n\t\}\n\}/);
  });

  it('rejects parameter defaults that reference body-only var bindings', () => {
    const dir = project(
      {
        'app.ts': `import {f64, struct} from '@arv/threads';
      const P = struct({x: f64});
      function f(get = () => p.x) { var p = new P(); return get; }
      export {f};`,
      },
      {paths: {'@arv/threads': [runtimeTypes]}},
    );
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: '@arv/threads',
      api,
      check: true,
      types: true,
    });
    expect(result.typeDiagnostics.map(d => d.code)).toEqual([2552]);
    expect(result.typeDiagnostics[0]!.message).toContain(
      "Cannot find name 'p'",
    );
  });

  it('holds forward captures only after initialization, in locals and defaults', () => {
    expect(fixes).toContain('const get = (_a = () => __F64[(p >> 3) + 1]');
    expect(fixes).toMatch(
      /for \(const __closure[^ ]* of __holds[^)]*\) __capture\(__closure[^,]*, p\)/,
    );
    expect(fixes).toContain('export function forwardParameter(get, p)');
  });

  it('holds an assignment receiver while the right side replaces it', () => {
    expect(fixes).toContain('__F64[((_a = __retain(p)) >> 3) + 1] =');
    expect(fixes).toContain('__release(_a);');
  });

  it('keeps owned let declarations in the loop head', () => {
    expect(fixes).toContain(
      'for (let p = _a = __newStruct(Node), i = 0; i < 2; i++)',
    );
    expect(fixes).toContain('finally {\n\t\t\t__release(_a);');
  });

  it('puts the import on a line of its own after a directive', () => {
    for (const eol of ['\n', '\r\n']) {
      const dir = project({'app.ts': `"use client"${eol}${APP}`});
      const [file] = compile(path.join(dir, 'tsconfig.json'), {
        runtime: 'threads',
        api,
      }).files;
      expect(file!.code).toMatch(
        new RegExp(
          `^"use client"${eol}\\n?import \\{ [^\\n]* \\} from "threads";\\n`,
        ),
      );
      expect(() => toJavaScript(file!)).not.toThrow();
    }
  });

  it("reports a module kind the runtime's helpers cannot be imported into, and compiles none of its files", () => {
    const dir = project({'app.ts': APP}, {module: 'commonjs'});
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: 'threads',
      api,
    });
    expect(result.diagnostics.map(d => d.code).sort((a, b) => a - b)).toEqual([
      96014, 96039,
    ]);
    expect(result.files).toEqual([]);
  });

  it('reports a CommonJS file, and compiles it not at all', () => {
    const options = {module: 'nodenext', moduleResolution: 'nodenext'};
    const dir = project(
      {
        'app.ts': `import {n} from './tool.cjs';\n${APP}export const m = n;\n`,
        'tool.cts': 'export const n = 1;\n',
        'package.json': '{"type": "module"}\n',
      },
      options,
    );
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: 'threads',
      api,
    });
    expect(
      result.diagnostics.map(d => [path.basename(d.file ?? ''), d.code]),
    ).toEqual([['tool.cts', 96039]]);
    expect(result.files.map(f => path.basename(f.fileName))).toEqual([
      'app.ts',
    ]);
    expect(result.files[0]!.changed).toBe(true);
    // without "type": "module", a .ts is CommonJS too
    fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
    const commonJS = compile(path.join(dir, 'tsconfig.json'), {
      runtime: 'threads',
      api,
    });
    expect(
      commonJS.diagnostics.map(d => path.basename(d.file ?? '')).sort(),
    ).toEqual(['app.ts', 'tool.cts']);
    expect(commonJS.files).toEqual([]);
  });

  it("reports type errors in the project's declaration files", () => {
    const dir = project({
      'app.ts': APP,
      'globals.d.ts': 'declare const x: MissingType;\n',
    });
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: 'threads',
      api,
      types: true,
    });
    expect(
      result.typeDiagnostics.map(d => [path.basename(d.file ?? ''), d.code]),
    ).toEqual([['globals.d.ts', 2304]]);
  });
});

describe('what the lowering moves, as it runs', () => {
  it('preserves defaults, scopes, captures, assignment receivers and loop bindings, and releases their owners', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-moved-'));
    dirs.push(out);
    const compiled = spawnSync(
      process.execPath,
      [
        'cli.ts',
        'compile',
        '-p',
        'test/run',
        '--runtime',
        '@arv/threads',
        '--outDir',
        out,
      ],
      {cwd: checker, encoding: 'utf8', timeout: 60_000},
    );
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
    const r = spawnSync(
      process.execPath,
      [
        path.join(checker, '../run.ts'),
        path.join(out, 'moved.js'),
        '--threads=1',
        // no pool: each pool worker loads moved.js too, and adds the block its
        // module makes (Extended's base) to the shared counts when it settles,
        // which may be between main's two heapStats()
        '--pool=0',
      ],
      {encoding: 'utf8', timeout: 60_000},
    );
    expect(r.stdout.trim(), r.stderr).toBe(
      '[0,true,2,1,6,6,10,"object",11,13,17,19,29,41,[20,21],[0,1],1,4,10,"Error",1,1,7,2,1,7,0,2,31,37,0,6,0,23] blocks left 0',
    );
  }, 60_000);

  it("emits a package's sources for analysis only", () => {
    const dir = project({
      'app.ts': `import {n} from 'pkg';\n${APP}export const m = n;\n`,
    });
    fs.mkdirSync(path.join(dir, 'node_modules/pkg'), {recursive: true});
    fs.writeFileSync(
      path.join(dir, 'node_modules/pkg/package.json'),
      JSON.stringify({name: 'pkg', type: 'module', exports: './index.ts'}),
    );
    fs.writeFileSync(
      path.join(dir, 'node_modules/pkg/index.ts'),
      'export const n: number = 1;\n',
    );
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: 'threads',
      api,
    });
    expect(result.files.map(f => path.basename(f.fileName))).toEqual([
      'app.ts',
    ]);
  });
});

describe('counting lowering review regressions', () => {
  it.each(['const values: Iterable<P> = [];', 'const values: P[] = [];'])(
    'keeps non-channel module receive bindings borrowed: %s',
    values => {
      const dir = project({
        'app.ts': `import {f64, SharedArray, struct, type Struct} from 'threads';
        const P = struct({x: f64});
        type P = Struct<typeof P>;
        ${values}
        for (var p of values) { p.x = 1; }`,
      });
      const result = compile(path.join(dir, 'tsconfig.json'), {
        runtime: 'threads',
        api,
        check: true,
        types: true,
      });
      // Counted array iteration remains unsupported; lowering must not
      // pretend its borrowed element transfers ownership into a module var.
      expect(result.diagnostics.map(d => d.code)).toEqual([96022]);
      expect(result.typeDiagnostics).toEqual([]);
      const code = toJavaScript(result.files[0]!).code;
      expect(code).toContain('for (var p of values)');
      expect(code).not.toContain('__release(p)');
    },
  );
  const cases = [
    {
      name: 'preserves an abstract class with an awaited computed name',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      export abstract class C {
        [root.next!.x = ((root.next = new P()), await Promise.resolve(281))]() {}
      }
      class D extends C {}
      export function main() {
        log(JSON.stringify([C.name, typeof Reflect.get(new D(), 281), root.next!.x]));
      }`,
      expected: '["C","function",0]',
    },
    {
      name: 'preserves shadowing in a module channel var loop body',
      source: `const channel = new Channel<P>(1);
      const value = new P(); value.x = 283;
      channel.send(value); channel.close();
      let observed = 0;
      outer: for (var p of channel) {
        let p = new P(); p.x = 293;
        observed = p.x;
        continue outer;
      }
      const finalValue = p!.x;
      export function main() { log(JSON.stringify([observed, finalValue])); }`,
      expected: '[293,283]',
    },
    {
      name: 'keeps function var receives alive through iterations and a post-loop read',
      source: `const channel = new Channel<P>(2);
      function f() {
        channel.send(new P()); channel.send(new P()); channel.close();
        for (var p of channel) {
          p.x = 233;
          const pressure = new P(); pressure.x = 99;
        }
        const q = new P(); q.x = 99;
        return p!.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[233,0]',
    },
    {
      name: 'keeps a function var receive alive after a caught loop-body exception',
      source: `const channel = new Channel<P>(1);
      function f() {
        channel.send(new P()); channel.close();
        try {
          for (var p of channel) {
            p.x = 239; throw new Error('stop');
          }
        } catch {}
        const q = new P(); q.x = 99;
        return p!.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[239,0]',
    },
    {
      name: 'queues a switch capture declared after its binding in the same clause',
      source: `function f() {
        switch (0) {
          case 0:
            const p = new P(); p.x = 191;
            function get() { return p.x; }
            return get;
        }
        throw new Error('unreachable');
      }
      export function main() {
        const get = f(); const q = new P(); q.x = 99; log(get());
      }`,
      expected: '191',
    },
    {
      name: 'queues switch captures of a binding declared in an earlier clause',
      source: `function f(n: number) {
        switch (n) {
          case 0:
            const p = new P(); p.x = 193;
          case 1:
            function get() { return p.x; }
            return get;
        }
        throw new Error('unreachable');
      }
      export function main() {
        const get = f(0); const q = new P(); q.x = 99; log(get());
      }`,
      expected: '193',
    },
    {
      name: 'protects a reference-field receiver in a computed class method name',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      function f() {
        class C { [root.next!.x = ((root.next = new P()), 197)]() {} }
        return [root.next!.x, typeof Reflect.get(new C(), 197)];
      }
      export function main() {
        collectCycles();
        const before = heapStats();
        const result = f();
        collectCycles();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[[0,"function"],0]',
    },
    {
      name: 'releases reference-field receiver holds when a computed class name throws',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      function fail(): never { throw new Error('fail'); }
      function f() {
        class C { [root.next!.x = ((root.next = new P()), fail())]() {} }
      }
      export function main() {
        collectCycles();
        const before = heapStats();
        let message = "";
        try { f(); } catch (error) { message = (error as Error).message; }
        collectCycles();
        const after = heapStats();
        log(JSON.stringify([message,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '["fail",0]',
    },
    {
      name: 'preserves an awaited computed class name and its module export',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      const before = heapStats();
      export class C {
        [root.next!.x = ((root.next = new P()), await Promise.resolve(199))]() {}
      }
      const observed = [root.next!.x, typeof Reflect.get(new C(), 199)];
      export function main() {
        collectCycles();
        const after = heapStats();
        log(JSON.stringify([observed,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[[0,"function"],0]',
    },
    {
      name: 'preserves a named default class export with an awaited computed name',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      export default class C {
        [root.next!.x = ((root.next = new P()), await Promise.resolve(211))]() {}
      }
      export function main() {
        log(JSON.stringify([C.name, typeof Reflect.get(new C(), 211), root.next!.x]));
      }`,
      expected: '["C","function",0]',
    },
    {
      name: 'preserves an anonymous default class name through awaited computed evaluation',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      export default class {
        [root.next!.x = ((root.next = new P()), await Promise.resolve(223))]() {}
      }
      export async function main() {
        const {default: C} = await import('./app.js');
        log(JSON.stringify([C.name, typeof Reflect.get(new C(), 223), root.next!.x]));
      }`,
      expected: '["default","function",0]',
    },
    {
      name: 'keeps untaken awaits in computed names synchronous',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      const events: number[] = [];
      Promise.resolve().then(() => events.push(2));
      export class C {
        [root.next!.x = ((root.next = new P()), false ? await 0 : 227)]() {}
      }
      events.push(1);
      export function main() { log(JSON.stringify(events)); }`,
      expected: '[1,2]',
    },
    {
      name: 'releases a computed-name receiver when its generator is closed',
      source: `const R = struct({next: ref<P>()});
      const root = new R(); root.next = new P();
      function* f() {
        class C { [root.next!.x = ((root.next = new P()), yield 229)]() {} }
      }
      export function main() {
        collectCycles();
        const before = heapStats();
        const iterator = f(); iterator.next(); iterator.return(undefined);
        collectCycles();
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'preserves the final module channel var and releases overwritten receives',
      source: `const channel = new Channel<P>(2);
      const before = heapStats();
      channel.send(new P()); channel.send(new P()); channel.close();
      for (var p of channel) p.x = 157;
      const q = new P(); q.x = 99;
      const observed = p!.x;
      p = null!;
      const after = heapStats();
      export function main() {
        log(JSON.stringify([observed,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[157,1]',
    },
    {
      name: 'keeps labels and the initial binding of an empty module channel loop',
      source: `var p = new P(); p.x = 179;
      const channel = new Channel<P>(0); channel.close();
      outer: for (var p of channel) { continue outer; }
      const q = new P(); q.x = 99;
      const observed = p.x;
      export function main() { log(observed); }`,
      expected: '179',
    },
    {
      name: 'queues a borrowed optional parameter default before retaining its closure',
      source: `function f(get = () => p!.x, p?: P) { return get; }
      export function main() {
        const p = new P(); p.x = 181;
        const get = f(undefined, p);
        log(get());
      }`,
      expected: '181',
    },
    {
      name: 'moves a default that queues a later borrowed parameter into the body',
      source: `function f(get = () => p.x, p: P) { return get; }
      export function main() {
        const p = new P(); p.x = 163;
        const get = f(undefined, p);
        log(get());
      }`,
      expected: '163',
    },
    {
      name: 'keeps static block var declarations separate from enclosing lexical names',
      source: `function f() {
        const p = new P(); p.x = 241;
        class C { static { var p = new P(); p.x = 99; } }
        return p.x;
      }
      export function main() {
        const before = heapStats(); const result = f(); const after = heapStats();
        log(JSON.stringify([result, after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[241,0]',
    },
    {
      name: 'parameter defaults capture the outer binding instead of a body var',
      source: `const p = new P(); p.x = 269;
      function f(get = () => p.x) { var p = new P(); p.x = 99; return get; }
      export function main() { log(f()()); }`,
      expected: '269',
    },
    {
      name: 'holds atomic struct receivers through replacing operands',
      source: `const A = struct({n: i32});
      function f() {
        let p = new A(); p.n = 7;
        let q = new A(); q.n = 3;
        const old = atomic.add(p, 'n', (p = new A(), q = new A(), q.n = 99, 1));
        return [old, p.n, q.n];
      }
      export function main() {
        const before = heapStats(); const result = f(); const after = heapStats();
        log(JSON.stringify([result, after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[[7,0,99],0]',
    },
    {
      name: 'allows a module closure before its counted binding initializes',
      source: `const get = () => p.x; const p = new P(); p.x = 251;
      export function main() { log(get()); }`,
      expected: '251',
    },
    ...['||=', '??=', '&&='].map(operator => ({
      name: `balances nested RHS ownership in ${operator}`,
      source: `function f() {
        let p: P | null = ${operator === '&&=' ? 'new P()' : 'null'};
        p ${operator} (p = new P()); p!.x = 257;
        const q = new P(); q.x = 99; return p!.x;
      }
      export function main() {
        const before = heapStats(); const result = f(); const after = heapStats();
        log(JSON.stringify([result, after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[257,0]',
    })),
    ...[
      '[((root.next = new P()), collectCycles(), (root.pressure = new P()), (root.pressure.x = 99), 1)]() {}',
      'static { root.next = new P(); collectCycles(); root.pressure = new P(); root.pressure.x = 99; }',
      'static value = ((root.next = new P()), collectCycles(), (root.pressure = new P()), (root.pressure.x = 99));',
    ].map(member => ({
      name: `holds a receiver through immediate class evaluation: ${member}`,
      source: `const R = struct({next: ref<P>(), pressure: ref<P>()}); const root = new R();
      function f() {
        root.next = new P(); collectCycles();
        root.next!.x = (void class { ${member} }, 263);
        collectCycles();
        const result = root.pressure!.x; root.next = null; root.pressure = null; collectCycles(); return result;
      }
      export function main() {
        const before = heapStats(); const result = f(); const after = heapStats();
        log(JSON.stringify([result, after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[99,0]',
    })),
    {
      name: 'retains the value returned by a nested assignment before replacing it',
      source: `function f() {
        let p = new P(); p.x = 1;
        p = (p = new P()); p.x = 167;
        const q = new P(); q.x = 99;
        return p.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[167,0]',
    },
    {
      name: 'sorts copied loop edits in a moved parameter default',
      source: `function f(make = () => {
        for (let get = () => p.x, p = new P(), q = new P();;) {
          p.x = 139; q.x = 1; return get;
        }
      }, owned: P = new P()) { owned.x = 1; return make(); }
      export function main() { log(f()()); }`,
      expected: '139',
    },
    {
      name: 'allows fresh captured static-block var bindings inside a loop',
      source: `export function main() {
        const callbacks: (() => number)[] = [];
        for (let i = 0; i < 2; i++) {
          class C { static {
            var p = new P(); p.x = i;
            const read = () => p.x;
            callbacks.push(read);
          } }
        }
        const q = new P(); q.x = 99;
        log(JSON.stringify(callbacks.map(read => read())));
      }`,
      expected: '[0,1]',
    },
    {
      name: 'releases repeated module var initializers before clearing the binding',
      source: `const before = heapStats();
      for (let i = 0; i < 3; i++) {
        var p: P | undefined = new P(); p.x = i;
      }
      p = undefined;
      const after = heapStats();
      export function main() {
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'preserves a module var value through a declaration without initializer',
      source: `var p = new P(); p.x = 137;
      switch (0) { case 0: var p: P; }
      export function main() { log(p.x); }`,
      expected: '137',
    },
    {
      name: 'preserves module var scope and lifetime through a switch',
      source: `switch (0) {
        case 0:
          var p = new P(); p.x = 131;
          break;
      }
      const q = new P(); q.x = 99;
      export function main() { log(p.x); }`,
      expected: '131',
    },
    {
      name: 'preserves the switch temporal dead zone while evaluating case tests',
      source: `function f() {
        switch (0) {
          case read():
            const p = new P();
            function read() { return p.x; }
        }
      }
      export function main() {
        try { f(); } catch (e) { log(e instanceof ReferenceError); }
      }`,
      expected: 'true',
    },
    {
      name: 'tracks switch owners through nested assignments and a returned binding',
      source: `function f(): P {
        switch (0) {
          case 0:
            let p = new P(); p.x = 1;
            p = (p = new P()); p.x = 127;
            return p;
        }
        throw new Error('unreachable');
      }
      export function main() {
        const before = heapStats();
        const result = f().x;
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[127,0]',
    },
    {
      name: 'captures switch functions exposed by case tests without a matched clause',
      source: `let saved = () => 0;
      function save(get: () => number) { saved = get; return 1; }
      function f() {
        const p = new P(); p.x = 109;
        switch (0) {
          case save(get):
            function get() { return p.x; }
        }
      }
      export function main() {
        f(); const q = new P(); q.x = 99; log(saved());
      }`,
      expected: '109',
    },
    {
      name: 'captures hoisted functions on default entry without case tests',
      source: `function f() {
        const p = new P(); p.x = 113;
        switch (0) {
          default:
            return get;
            function get() { return p.x; }
        }
      }
      export function main() {
        const get = f(); const q = new P(); q.x = 99; log(get());
      }`,
      expected: '113',
    },
    {
      name: 'evaluates a derived receiver exactly once before replacing its owner',
      source: `export function main() {
        let a = new SharedArray(P, 2), q = new SharedArray(P, 2);
        let i = 0;
        a[i++].x = ((a = new SharedArray(P, 2)), (q = new SharedArray(P, 2)), 7);
        log(JSON.stringify([i, q[0].x, q[1].x]));
      }`,
      expected: '[1,0,0]',
    },
    {
      name: 'evaluates a switch discriminant outside its owned bindings',
      source: `function f() {
        const p = 0;
        switch (p) {
          case 0:
            const get = () => p.x;
            const p = new P(); p.x = 103;
            return get;
        }
        throw new Error('unreachable');
      }
      export function main() { log(f()()); }`,
      expected: '103',
    },
    {
      name: 'releases switch owners on a fallthrough break or a throwing initializer',
      source: `function fail(): P { throw new Error('fail'); }
      function f(n: number) {
        switch (n) {
          case 0:
          case 1:
            const p = new P(); p.x = 107;
          default:
            const q = n ? fail() : new P(); q.x = 1;
            break;
        }
      }
      export function main() {
        const before = heapStats();
        f(0);
        try { f(1); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'holds a struct array element while its array owner is replaced',
      source: `function f() {
        let a = new SharedArray(P, 1), q = new SharedArray(P, 1);
        a[0].x = ((a = new SharedArray(P, 1)), (q = new SharedArray(P, 1)), 7);
        return q[0].x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[0,0]',
    },
    {
      name: 'holds a referenced child while its parent is replaced',
      source: `const Parent = struct({next: ref<P>()});
      function f() {
        let p = new Parent(); p.next = new P();
        let q = new P();
        p.next!.x = ((p = new Parent()), (q = new P()), 7);
        return q.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[0,0]',
    },
    {
      name: 'holds a child while the reference field itself is replaced',
      source: `const Parent = struct({next: ref<P>()});
      function f() {
        const p = new Parent(); p.next = new P();
        let q = new P();
        p.next!.x = ((p.next = new P()), (q = new P()), 7);
        return q.x;
      }
      export function main() { log(f()); }`,
      expected: '0',
    },
    {
      name: 'releases a derived receiver when its right side throws',
      source: `function fail(): never { throw new Error('fail'); }
      function f() {
        let a = new SharedArray(P, 1);
        a[0].x = ((a = new SharedArray(P, 1)), fail());
      }
      export function main() {
        const before = heapStats();
        try { f(); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'prepares forward capture queues for a switch lexical scope',
      source: `function f() {
        switch (0) {
          case 0:
            const get = () => p.x;
            const p = new P(); p.x = 89;
            return get;
        }
        throw new Error('unreachable');
      }
      export function main() { log(f()()); }`,
      expected: '89',
    },
    {
      name: 'shares forward capture queues and bindings across switch clauses',
      source: `function f(n: number) {
        switch (n) {
          case 0:
            function get() { return p.x; }
          case 1:
            const p = new P(); p.x = 97;
          default:
            return get;
        }
      }
      export function main() { log(f(0)()); }`,
      expected: '97',
    },
    {
      name: 'captures hoisted switch functions when entering a later clause',
      source: `function f(n: number) {
        switch (n) {
          case 0:
            function get() { return p.x; }
          case 1:
            const p = new P(); p.x = 97;
          default:
            return get;
        }
      }
      export function main() { const get = f(1); const q = new P(); q.x = 99; log(get()); }`,
      expected: '97',
    },
    {
      name: 'declares borrowed var capture queues at function scope',
      source: `function f(source: P) {
        { const early = () => p.x; var p = source; early(); }
        return () => p.x;
      }
      export function main() {
        const p = new P(); p.x = 101;
        const before = heapStats();
        log(f(p)());
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '101\n0',
    },
    {
      name: 'moves a returned const after splitting a queued declaration',
      source: `function f(): P {
        const get = () => p.x, p = new P(), q = new P();
        q.x = 43;
        get();
        return q;
      }
      export function main() { log(f().x); }`,
      expected: '43',
    },
    {
      name: 'declares local capture queues when a default is lowered again',
      source: `function f(make = () => {
        const get = () => p.x;
        const p = new P();
        p.x = 47;
        return get;
      }, q: P = new P()) {
        q.x = 1;
        return make();
      }
      export function main() { log(f()()); }`,
      expected: '47',
    },
    {
      name: 'declares parameter capture queues when a default is lowered again',
      source: `function f(make = (get = () => p.x, p: P = new P()) => {
        p.x = 53;
        return get;
      }, q: P = new P()) {
        q.x = 1;
        return make();
      }
      export function main() { log(f()()); }`,
      expected: '53',
    },
    {
      name: 'declares loop capture queues when a default is lowered again',
      source: `function f(make = () => {
        for (let get = () => p.x, p = new P();;) {
          p.x = 59;
          return get;
        }
      }, q: P = new P()) {
        q.x = 1;
        return make();
      }
      export function main() { log(f()()); }`,
      expected: '59',
    },
    {
      name: 'reuses an owned parameter for var redeclarations',
      source: `function f(p: P): number {
        const x = p.x;
        var p = new P();
        p.x = 99;
        return x;
      }
      export function main() {
        const p = new P();
        p.x = 61;
        const before = heapStats();
        const result = f(p);
        const after = heapStats();
        log(JSON.stringify([result, p.x,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[61,61,0]',
    },
    {
      name: 'reuses a default parameter owner when a var moves out',
      source: `function f(p: P = new P()): P {
        p.x = 67;
        const x = p.x;
        var p = new P();
        p.x = x;
        return p;
      }
      export function main() {
        const before = heapStats();
        const result = f().x;
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[67,0]',
    },
    {
      name: 'keeps nested labels on a borrowed for head with a capture queue',
      source: `function f(source: P): number {
        let n = 0;
        outer: inner: for (let get = () => p.x, p = source, i = 0; i < 2; i++) {
          n += get();
          continue outer;
        }
        return n;
      }
      export function main() {
        const p = new P();
        p.x = 31;
        log(f(p));
      }`,
      expected: '62',
    },
    {
      name: 'keeps queues for an IIFE default retried before an owned default',
      source: `function f(get = (() => {
        const p = new P(); p.x = 71;
        function read() { return p.x; }
        return read;
      })(), q: P = new P()) { q.x = 1; return get(); }
      export function main() { log(f()); }`,
      expected: '71',
    },
    {
      name: 'releases an assignment receiver when its right side throws',
      source: `function fail(): never { throw new Error('fail'); }
      function f() { let p = new P(); p.x = ((p = new P()), fail()); }
      export function main() {
        const before = heapStats();
        try { f(); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'clears receiver holds before a local catch and on repeated throws',
      source: `function fail(): never { throw new Error('fail'); }
      export function main() {
        let p = new P();
        const before = heapStats();
        for (let i = 0; i < 3; i++) {
          try { const n = p.x = ((p = new P()), fail()); log(n); } catch {
            const after = heapStats();
            if (after.allocated - before.allocated !== after.freed - before.freed)
              throw new Error('leaked receiver');
          }
        }
        log(p.x);
      }`,
      expected: '0',
    },
    {
      name: 'clears receiver holds before finally handles an exception',
      source: `function fail(): never { throw new Error('fail'); }
      export function main() {
        let p = new P();
        const before = heapStats();
        try {
          for (let i = 0; i < 3; i++) {
            try { p.x = ((p = new P()), fail()); } finally {
              const after = heapStats();
              if (after.allocated - before.allocated !== after.freed - before.freed)
                throw new Error('leaked receiver');
              if (i < 2) continue;
            }
          }
        } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'releases receiver holds in concise arrow returns',
      source: `function fail(): never { throw new Error('fail'); }
      const f = (p: P) => p.x = ((p = new P()), fail());
      export function main() {
        const p = new P();
        const before = heapStats();
        try { f(p); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'releases a receiver after a rejected await without changing its order',
      source: `async function f() {
        let p = new P();
        p.x = ((p = new P()), await Promise.reject(new Error('fail')));
      }
      export async function main() {
        const before = heapStats();
        try { await f(); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'releases a receiver when a generator is closed while yielding',
      source: `function* f() {
        let p = new P();
        p.x = ((p = new P()), yield 0);
      }
      export function main() {
        const before = heapStats();
        const iterator = f();
        iterator.next();
        iterator.return(undefined);
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'discards receiver cleanup temps when parameter lowering retries',
      source: `function fail(): never { throw new Error('fail'); }
      function f(p: P, get = () => 1, n = p.x = ((p = new P()), fail())) {
        return get() + n;
      }
      export function main() {
        const p = new P();
        const before = heapStats();
        try { f(p); } catch {}
        const after = heapStats();
        log(after.allocated - before.allocated - (after.freed - before.freed));
      }`,
      expected: '0',
    },
    {
      name: 'stages var initializers that also assign the same binding',
      source: `function f(): number {
        var p = new P(); p.x = 79;
        const alias = p;
        var p = (p = new P()); p.x = 83;
        const q = new P(); q.x = 99;
        return alias.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[79,0]',
    },
    {
      name: 'stages nested assignments before replacing the binding',
      source: `function f(): number {
        let p = new P(); p.x = 79;
        const alias = p;
        p = (p = new P()); p.x = 83;
        const q = new P(); q.x = 99;
        return alias.x;
      }
      export function main() {
        const before = heapStats();
        const result = f();
        const after = heapStats();
        log(JSON.stringify([result,
          after.allocated - before.allocated - (after.freed - before.freed)]));
      }`,
      expected: '[79,0]',
    },
    {
      name: 'flushes the function capture queue for a hoisted var loop head',
      source: `function f(): () => number {
        const get = () => p.x;
        for (var p = new P();;) { p.x = 73; break; }
        return get;
      }
      export function main() {
        const get = f();
        const q = new P(); q.x = 99;
        log(get() + q.x - 99);
      }`,
      expected: '73',
    },
  ];
  it.each(cases)(
    '$name',
    ({source, expected}) => {
      const dir = project(
        {
          'app.ts': `import {atomic, Channel, collectCycles, f64, i32, heapStats, log, ref, SharedArray, struct, type Struct} from '@arv/threads';
        const P = struct({x: f64});
        type P = Struct<typeof P>;
        ${source}`,
        },
        {paths: {'@arv/threads': [runtimeTypes]}},
      );
      const result = compile(path.join(dir, 'tsconfig.json'), {
        runtime: '@arv/threads',
        api,
        check: true,
        types: true,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.typeDiagnostics).toEqual([]);
      const file = path.join(dir, 'app.js');
      fs.writeFileSync(file, toJavaScript(result.files[0]!).code);
      const r = spawnSync(
        process.execPath,
        [path.join(checker, '../run.ts'), file, '--threads=1', '--pool=0'],
        {encoding: 'utf8', timeout: 60_000},
      );
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout.trim(), r.stderr).toBe(expected);
    },
    60_000,
  );
});

describe('receiver cleanup during module initialization', () => {
  const header = `import {f64, ref, struct} from '@arv/threads';
    const P = struct({x: f64});
    function fail(): never { throw new Error('fail'); }
    let p = new P();`;
  it.each([
    ['statement', 'p.x = ((p = new P()), fail());'],
    [
      'multi-declaration typeof TDZ',
      `// @ts-expect-error Deliberately read b before initialization.
       export const a = typeof b, b = p.x = ((p = new P()), 7);`,
    ],
    [
      'multi-declaration closure TDZ',
      `function read(): string { return typeof b; }
       export const a = read(), b = p.x = ((p = new P()), 7);`,
    ],

    [
      'exported initializer',
      'export const value = p.x = ((p = new P()), fail());',
    ],
    [
      'multiple declarations',
      'export const first = 1, value = p.x = ((p = new P()), fail()), last = first;',
    ],
    [
      'awaited initializer',
      'export const value = p.x = ((p = new P()), await Promise.reject(new Error("fail")));',
    ],
    ['loop condition', 'for (; p.x = ((p = new P()), fail());) {}'],
    [
      'class heritage',
      'export class C extends ((p.x = ((p = new P()), fail())), class {}) {}',
    ],
    [
      'awaited computed class name',
      `const R = struct({next: ref<InstanceType<typeof P>>()});
       const root = new R(); root.next = new P();
       export class C {
         [root.next!.x = ((root.next = new P()), await Promise.reject(new Error('fail')))]() {}
       }`,
      '[true,3]',
    ],
    ['default export', 'export default p.x = ((p = new P()), fail());'],
    [
      'TDZ in initializer',
      'function read(): number { return value; } export const value = (p.x = ((p = new P()), 7), read());',
    ],
  ])(
    'releases receiver holds on a throwing %s',
    (_name, source, expected = '[true,1]') => {
      const dir = project(
        {
          'bad.ts': header + source,
          'app.ts': `import {collectCycles, heapStats, log} from '@arv/threads';
        export async function main() {
          const before = heapStats();
          let failed = false;
          try { await import('./bad.js'); } catch (error) {
            failed = ${_name.includes('TDZ') ? 'error instanceof ReferenceError' : 'true'};
          }
          collectCycles();
          const after = heapStats();
          log(JSON.stringify([failed,
            after.allocated - before.allocated - (after.freed - before.freed)]));
        }`,
        },
        {paths: {'@arv/threads': [runtimeTypes]}},
      );
      const result = compile(path.join(dir, 'tsconfig.json'), {
        runtime: '@arv/threads',
        api,
        check: true,
        types: true,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.typeDiagnostics).toEqual([]);
      for (const file of result.files)
        fs.writeFileSync(
          path.join(dir, path.basename(file.fileName, '.ts') + '.js'),
          toJavaScript(file).code,
        );
      const run = spawnSync(
        process.execPath,
        [
          path.join(checker, '../run.ts'),
          path.join(dir, 'app.js'),
          '--threads=1',
          '--pool=0',
        ],
        {encoding: 'utf8', timeout: 60_000},
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      // The module's replacement binding owns one block for its lifetime;
      // only the receiver temporary of the failed expression must be freed.
      expect(run.stdout.trim(), run.stderr).toBe(expected);
    },
    60_000,
  );

  it('preserves exports, promise identity and untaken top-level await timing', () => {
    const dir = project(
      {
        'app.ts':
          header.replace('{f64, ref, struct}', '{f64, log, ref, struct}') +
          `
        export const events: number[] = [];
        Promise.resolve().then(() => events.push(2));
        export const promise = Promise.resolve(149);
        export const value = (p.x = ((p = new P()), 7), false ? await 0 : promise),
          same = (events.push(1), value === promise);
        export function main() { log(JSON.stringify([...events, same, value === promise])); }
      `,
      },
      {paths: {'@arv/threads': [runtimeTypes]}},
    );
    const result = compile(path.join(dir, 'tsconfig.json'), {
      runtime: '@arv/threads',
      api,
      check: true,
      types: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.typeDiagnostics).toEqual([]);
    fs.writeFileSync(
      path.join(dir, 'app.js'),
      toJavaScript(result.files[0]!).code,
    );
    const run = spawnSync(
      process.execPath,
      [
        path.join(checker, '../run.ts'),
        path.join(dir, 'app.js'),
        '--threads=1',
        '--pool=0',
      ],
      {encoding: 'utf8', timeout: 60_000},
    );
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout.trim(), run.stderr).toBe('[1,2,true,true]');
  }, 60_000);
});

describe('threads-check compile', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-compile-'));
  afterAll(() => fs.rmSync(out, {recursive: true, force: true}));
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['cli.ts', 'compile', ...args], {
      cwd: checker,
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('writes each file as JavaScript, with a source map', () => {
    const r = run([
      '-p',
      'test/emit',
      '--runtime',
      'threads',
      '--outDir',
      out,
      '--sourceMap',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
    const code = fs.readFileSync(path.join(out, 'corners.js'), 'utf8');
    expect(code).toContain('__register(import.meta.url, {');
    expect(code).toMatch(/\/\/# sourceMappingURL=corners\.js\.map\n$/);
    const map = JSON.parse(
      fs.readFileSync(path.join(out, 'corners.js.map'), 'utf8'),
    );
    expect(map.sources).toEqual([
      path.relative(out, path.join(checker, 'test/emit/corners.ts')),
    ]);
  });

  it('writes nothing over an input: a JavaScript file, without an outDir', () => {
    const dir = project(
      {'app.ts': APP, 'tool.js': 'export const n = 1;\n'},
      {allowJs: true},
    );
    const r = run(['-p', dir, '--runtime', 'threads']);
    expect(r.stderr).toMatch(
      /cannot write .*tool\.js: it would overwrite an input of the project\. Name an output directory/,
    );
    expect(r.status).toBe(3);
    expect(fs.readFileSync(path.join(dir, 'tool.js'), 'utf8')).toBe(
      'export const n = 1;\n',
    );
    expect(fs.existsSync(path.join(dir, 'app.js'))).toBe(false);
  });

  it('copies an imported JSON file, and keeps the JSX of a .jsx file', () => {
    const dir = project(
      {
        'app.ts': `import data from './data.json';\nimport {view} from './view.jsx';\n${APP}export const v = [data.value, view];\n`,
        'data.json': '{"value":1}\n',
        'view.jsx': 'export const view = <div />;\n',
      },
      {
        allowJs: true,
        resolveJsonModule: true,
        jsx: 'preserve',
        outDir: 'dist',
      },
    );
    const r = run(['-p', dir, '--runtime', 'threads']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'dist/data.json'), 'utf8')).toBe(
      '{"value":1}\n',
    );
    expect(fs.readFileSync(path.join(dir, 'dist/view.jsx'), 'utf8')).toContain(
      '<div />',
    );
  });

  it('writes nothing for a CommonJS file, and exits 1', () => {
    const dir = project(
      {
        'app.ts': `import {n} from './tool.cjs';\n${APP}export const m = n;\n`,
        'tool.cts': 'export const n = 1;\n',
        'package.json': '{"type": "module"}\n',
      },
      {module: 'nodenext', moduleResolution: 'nodenext', outDir: 'dist'},
    );
    const r = run(['-p', dir, '--runtime', 'threads']);
    expect(r.stdout).toMatch(
      /tool\.cts\(1,1\): error TS96039: 'tool\.cts' is a CommonJS module/,
    );
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(dir, 'dist/app.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'dist/tool.cjs'))).toBe(false);
  });

  it('reports the ownership errors, exits 1, and writes the files all the same', () => {
    const r = run([
      '-p',
      'test/cases/channels',
      '--runtime',
      'threads',
      '--outDir',
      path.join(out, 'channels'),
    ]);
    expect(r.stdout).toMatch(
      /^test\/cases\/channels\/channels\.ts\(\d+,\d+\): error TS96001/,
    );
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(out, 'channels/channels.js'))).toBe(true);
  });
});
