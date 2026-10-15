// A final allocation can reclaim a cycle, with the allocator's own locks
// released. The separate heap keeps filling it local to this test file.
import {expect, it} from 'vite-plus/test';
import {own, runtime, threads as T} from './test-heap.ts';

it('collects cycles and retries once before an unlocked allocation reports a full heap', () => {
  const Node = own.sharedStruct('AllocationCycle', ['next'], [0]);
  const p = own.newStruct(Node);
  own.store((p >> 2) + 2, own.retain(p));
  own.release(p);
  for (const bytes of [1 << 20, 8]) {
    for (;;) {
      try {
        runtime.$alloc(bytes);
      } catch {
        break;
      }
    }
  }
  const before = T.heapStats().freed;
  const q = own.newStruct(Node);
  expect(q).toBe(p);
  expect(T.heapStats().freed).toBe(before + 1);
  own.release(q);
});
