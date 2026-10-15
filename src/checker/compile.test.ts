// compile (compile.ts, transform.ts): what it emits for the corners of the
// lowering (test/emit), the source map back to the original, the types
// stripped, and threads-check compile writing a project. vp run compare-emit
// compares all of it with the fork's emit, where there is a fork.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decode} from '@jridgewell/sourcemap-codec';
import {API} from 'typescript/sync';
import {afterAll, describe, expect, it} from 'vite-plus/test';
import {compile, toJavaScript} from './compile.ts';
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
    expect(fn('logical')).toContain('x || (x = __retain(other));');
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
