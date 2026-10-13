import {heapStats, log, register, scope, type Scope} from '@arv/threads';
// a scope whose thread throws (run.test.ts): the scope joins its other threads
// all the same, and frees each thread's block and result; the body's error is
// the one thrown, else the first thread's, or all of them
import {__collect} from '@arv/threads/own';

function ok(n: number) {
  return n;
}
function bad(): number {
  throw new Error('boom');
}
function worse(): number {
  throw new Error('worse');
}
// runs body in a scope: what the scope threw, and the blocks it left behind
function attempt(body: (s: Scope) => void) {
  const before = heapStats();
  let caught = '';
  try {
    scope(body);
  } catch (e) {
    caught = String(e);
  }
  __collect(); // the errors' strings go a grace period later
  const after = heapStats();
  log(
    `scope threw: ${caught}; blocks left behind: ${after.allocated - after.freed - (before.allocated - before.freed)}`,
  );
}
export function main() {
  attempt(s => {
    s.spawn(bad);
    for (let i = 0; i < 5; i++) s.spawn(ok, i);
  });
  // the body throws too: its error is the one thrown
  attempt(s => {
    s.spawn(bad);
    for (let i = 0; i < 5; i++) s.spawn(ok, i);
    throw new Error('the body');
  });
  // two threads throw: both errors, in one
  attempt(s => {
    s.spawn(bad);
    s.spawn(worse);
    s.spawn(ok, 1);
  });
}
register(import.meta.url, {ok, bad, worse, main});
