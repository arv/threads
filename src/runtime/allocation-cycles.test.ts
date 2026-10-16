// A final allocation can reclaim a cycle, with the allocator's own locks
// released. The separate heap keeps filling it local to this test file.
import {expect, it} from 'vite-plus/test';
import {own, runtime, threads as T} from './test-heap.ts';

it('collects cycles and retries once before an unlocked allocation reports a full heap', () => {
  const Node = own.sharedStruct('AllocationCycle', ['next'], [0]);
  const p = own.newStruct(Node);
  own.store((p >> 2) + 2, own.retain(p));
  own.release(p);
  const root = own.newStruct(Node),
    child = own.newStruct(Node);
  own.store((root >> 2) + 2, child);
  // Compiled root.next.next = new Node() retains its borrowed receiver before
  // allocating. Model another thread removing that child before recovery.
  const receiver = own.retain(runtime.I32[(root >> 2) + 2]);
  own.store((root >> 2) + 2, 0);
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
  expect(runtime.I32[receiver >> 2]).toBe(Node.kind);
  expect(runtime.I32[(receiver >> 2) + 1]).toBe(1);
  own.store((receiver >> 2) + 2, q);
  own.release(receiver);
  own.release(root);
  own.__collect();
});
