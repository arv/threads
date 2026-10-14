// What a program with its types only erased needs at its end (registration):
// the line registering the top-level functions the fork's emit registers
import {describe, expect, it} from 'vite-plus/test';
import {registration} from './compiled.ts';

const RUNTIME = '@arv/threads';
// the functions the line registers
const registered = (source: string) =>
  /\{ (.*) \}\);\n$/.exec(registration(source, RUNTIME).tail)![1].split(', ');

describe('registration', () => {
  it('registers every named top-level function, as the fork does', () => {
    // the fork's emit of this registers { main, gen, agen, split }
    expect(
      registered(`import {log} from '@arv/threads';
export default function main(n: number): number { log('hi'); return n; }
function *gen() { yield 1; }
export async function * agen() { yield 1; }
function
split() {}
`),
    ).toEqual(['main', 'gen', 'agen', 'split']);
    // and of this { g, h, i }
    expect(
      registered(`import {log} from '@arv/threads';
export default async function* g() { log('g'); }
function* h() {}
async function i() {}
`),
    ).toEqual(['g', 'h', 'i']);
  });

  it('leaves out what is not at the top level, however it is indented', () => {
    // the fork's emit of this registers { main, indented, after }
    expect(
      registered(`import {log} from '@arv/threads';
/*
export default function example() {}
*/
const text = \`
function *notOne() {}
\${'}'}
export function nor() {}
\`;
const re = /['{]/, half = text.length / 2;
export function main(n: number): number {
function *gen() { yield n; }
  log(String(re), half, [...gen()].length);
  return n;
}
  function indented() {}
const o = {k: 1}; function after() {}
`),
    ).toEqual(['main', 'indented', 'after']);
  });

  it('leaves out a function with no name, and one not at the top level', () => {
    // the fork's emit of this registers { k }
    expect(
      registered(`import {log} from '@arv/threads';
export default function () { log('x'); }
export function k() {
  function inner() {}
  return inner;
}
const f = function named() {};
functionally();
`),
    ).toEqual(['k']);
  });
});
