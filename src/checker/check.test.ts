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

  it('knows consume() and struct() under other names', () => {
    // the fork takes a call for consume() or struct() by the name it is called
    // by: an import alias, or a const that holds it, defeats it there
    const dir = join(checker, 'test/diverging/marker-aliases');
    expect(
      check(join(dir, 'tsconfig.json'), {runtime: 'threads', api})
        .map(d => formatDiagnostic(d, dir))
        .sort(),
    ).toEqual(
      [
        "alias.ts(11,7): error TS96005: 'xs' was consumed by 'send' on line 10.",
        "alias.ts(16,7): error TS96005: 'xs' was consumed by 'send' on line 15.",
        "alias.ts(22,11): error TS96021: A value of type 'Hidden' cannot be stored in an ordinary array or object: reference counting cannot see it there. Use a SharedArray or a shared struct field, or a place typed 'unknown', which holds a handle.",
        "alias.ts(28,7): error TS96005: 'xs' was consumed by 'send' on line 27.",
        "alias.ts(33,7): error TS96005: 'xs' was consumed by 'send' on line 32.",
      ].sort(),
    );
  });

  it('refuses a struct used as a struct of another layout', () => {
    // TypeScript relates struct types by their members; a struct's fields are
    // read at their places. the fork does not compare layouts
    const dir = join(checker, 'test/diverging/struct-layouts');
    expect(
      check(join(dir, 'tsconfig.json'), {runtime: 'threads', api})
        .map(d => formatDiagnostic(d, dir))
        .sort(),
    ).toEqual(
      [
        "layouts.ts(26,41): error TS96033: A value of type 'Child & Cell' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(28,39): error TS96033: A value of type 'Child & Cell' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(29,46): error TS96033: A value of type 'Child & Cell' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(30,64): error TS96033: A value of type 'Child & Cell' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(31,39): error TS96033: A value of type 'B & Cell' cannot be used as 'A': field 'x' is at place 1 of 'B' and 0 of 'A'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(32,41): error TS96033: A value of type 'Index & Cell' cannot be used as 'Count': field 'n' is of another kind in 'Index' than in 'Count'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(33,54): error TS96033: A value of type 'SharedArray<Child & Cell, \"other\">' cannot be used as 'SharedArray<Node, \"other\">': the elements are 'Child' structs, which 'Node' structs, of another layout or size, cannot stand for. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(34,53): error TS96033: A value of type 'Child' cannot be used as 'Node | null': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(41,48): error TS96033: A value of type 'Node' cannot be used as 'Child': 'Node' has no field 'extra'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(44,69): error TS96033: A value of type 'SharedArray<Child & Cell, \"other\">' cannot be used as 'SharedArray<Node, \"other\"> | null': the elements are 'Child' structs, which 'Node' structs, of another layout or size, cannot stand for. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(47,20): error TS96034: 'Twice' is declared a shared struct again, laid out otherwise: [b: f64, a: f64] here, [a: f64, b: f64] at its other declaration. The checker reads a struct type's values by one layout, so a type has one; declare the other as a type of its own.",
        "layouts.ts(72,43): error TS96033: A value of type 'ChildBox & Cell' cannot be used as 'NodeBox': field 'item' of 'ChildBox' refers to what that of 'NodeBox' cannot stand for: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(77,51): error TS96033: A value of type '{ (x: string): Child; (x: number): Node; }' cannot be used as '(x: string) => Node': what it returns: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(81,53): error TS96033: A value of type '() => () => () => () => Child' cannot be used as '() => () => () => () => Node': what it returns: what it returns: what it returns: what it returns: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(84,17): error TS96034: 'Measure' is declared a shared struct again, laid out otherwise: [n: f64] here, [n: i32] at its other declaration. The checker reads a struct type's values by one layout, so a type has one; declare the other as a type of its own.",
        "layouts.ts(52,81): error TS96033: A value of type 'SharedArray<Child & Cell, \"other\">' cannot be used as 'SharedArray<number, \"other\"> | SharedArray<Node, \"other\">': the elements are 'Child' structs, which 'Node' structs, of another layout or size, cannot stand for. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(59,37): error TS96033: A value of type '() => Child & Cell' cannot be used as '() => Node': what it returns: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(61,48): error TS96033: A value of type '(n: Node) => number' cannot be used as '(c: Child) => number': what it is called with, parameter 1: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(64,43): error TS96033: A value of type '() => Child & Cell' cannot be used as '() => Node': what it returns: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(89,29): error TS96033: A value of type '0 | Child' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(92,34): error TS96033: A value of type '(() => Child) | (() => Node)' cannot be used as '() => Node': what it returns: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(96,43): error TS96033: A value of type '() => Promise<Child>' cannot be used as '() => Promise<Node>': what it returns: what it resolves to: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(97,40): error TS96033: A value of type 'Promise<Child>' cannot be used as 'Promise<Node>': what it resolves to: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(102,65): error TS96033: A value of type 'Child & Cell' cannot be used as 'Node': field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
        "layouts.ts(104,39): error TS96033: A value of type 'StructType<Child>' cannot be used as 'StructType<Node>': what it constructs: field 'value' is at place 1 of 'Child' and 0 of 'Node'. A shared struct's fields are read and written by their place, so a struct used as another must lay out that one's fields first, in its order and of its kinds.",
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
