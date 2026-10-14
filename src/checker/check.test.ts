// threads-check on the programs of test/cases: each reports what
// test/expected/cases-<name>.txt says, which `vp run compare --update` writes
// from the tsgo fork's `own check` (compare.ts compares with the fork itself
// when it is there).
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, describe, expect, it} from 'vite-plus/test';
import {API, check, formatDiagnostic} from './index.ts';

const checker = fileURLToPath(new URL('.', import.meta.url));
const cases = join(checker, 'test/cases');
const api = new API({cwd: checker});
afterAll(() => api.close());

const lines = (text: string) => text.split('\n').filter(l => l !== '');
const YIELDED =
  "A value of type 'Node & Cell' cannot be yielded, or returned by a generator: it would be stored in an IteratorResult, an ordinary object, which the caller keeps past the generator's count of it.";

describe('threads-check', () => {
  it('refuses a runtime no file imports: a mistyped --runtime', () => {
    expect(() =>
      check(join(cases, 'channels/tsconfig.json'), {runtime: 'thread', api}),
    ).toThrow(/no file of the project imports the runtime as 'thread'/);
  });

  for (const name of readdirSync(cases).sort()) {
    it(`reports what the fork does on ${name}`, () => {
      const dir = join(cases, name);
      const actual = check(join(dir, 'tsconfig.json'), {
        runtime: 'threads',
        api,
      }).map(d => formatDiagnostic(d, dir));
      const expected = lines(
        readFileSync(join(checker, `test/expected/cases-${name}.txt`), 'utf8'),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    });
  }
});

// What threads-check reports and the fork does not, yet (compare.ts compares
// the two on test/cases alone): programs in test/diverging, each with what it
// should report
describe('threads-check, where it differs from the fork', () => {
  it('refuses a counted value yielded, or returned by a generator', () => {
    // the fork has no rule for yield: the value lands in an IteratorResult,
    // an ordinary object, past the generator's count of it. an async
    // generator awaits what it yields, so a promise of one counts, and a
    // narrowed handle, with a count of its own, does not
    const dir = join(checker, 'test/diverging/generators');
    expect(
      check(join(dir, 'tsconfig.json'), {runtime: 'threads', api})
        .map(d => formatDiagnostic(d, dir))
        .sort(),
    ).toEqual(
      [
        'generators.ts(9,9): error TS96032: ' + YIELDED,
        'generators.ts(10,10): error TS96032: ' + YIELDED,
        'generators.ts(13,9): error TS96032: ' + YIELDED,
        'generators.ts(23,9): error TS96032: ' + YIELDED,
        'generators.ts(24,10): error TS96032: ' + YIELDED,
      ].sort(),
    );
  });

  it("reports no blocking call on a Channel that is not the runtime's", () => {
    const dir = join(checker, 'test/diverging/ambient-channel');
    expect(
      check(join(dir, 'tsconfig.json'), {runtime: 'threads', api}).map(d =>
        formatDiagnostic(d, dir),
      ),
    ).toEqual([]);
  });
});
