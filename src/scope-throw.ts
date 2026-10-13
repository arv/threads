import {heapStats, log, register, scope} from '@arv/threads';
// a scope whose thread throws (run.test.ts): the scope joins its other threads
// all the same, and frees each thread's block and result
import {__collect} from '@arv/threads/own';

function ok(n: number) {
  return n;
}
function bad(): number {
  throw new Error('boom');
}
export function main() {
  const before = heapStats();
  let caught = '';
  try {
    scope(s => {
      s.spawn(bad);
      for (let i = 0; i < 5; i++) s.spawn(ok, i);
    });
  } catch (e) {
    caught = String(e);
  }
  log(`scope threw: ${caught}`);
  __collect(); // the error's string goes a grace period later
  const after = heapStats();
  log(
    `blocks the scope left behind: ${after.allocated - after.freed - (before.allocated - before.freed)}`,
  );
}
register(import.meta.url, {ok, bad, main});
