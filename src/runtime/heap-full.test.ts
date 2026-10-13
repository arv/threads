// the runtime when the shared heap is full: what allocates throws a
// RangeError, with no lock held, so that the thread reports it and the others
// go on; and what was being changed is as it was
import {describe, expect, it} from 'vite-plus/test';
import {runtime, threads as T} from './test-heap.ts';

// takes every byte: the big allocations, then the rest of this thread's chunk
const fill = () => {
  for (const bytes of [1 << 20, 8])
    for (;;) {
      try {
        runtime.$alloc(bytes);
      } catch {
        break;
      }
    }
};

describe('a full heap', () => {
  it('throws, holds no lock, and leaves a map as it was', () => {
    const known = runtime.$internRef('known before the heap filled');
    const m = new T.SharedMap<number, number>(),
      s = new T.SharedSet<number>();
    for (let i = 0; i < 8; i++) {
      m.set(i, i); // the first table's capacity: the next entry needs a bigger one
      s.add(i);
    }
    fill();
    expect(() => runtime.$internRef('a new string')).toThrow(RangeError);
    // the string lock was released: not a hang
    expect(() => runtime.$internRef('another new string')).toThrow(RangeError);
    expect(runtime.$internRef('known before the heap filled')).toBe(known);
    expect(() => m.set(8, 8)).toThrow(RangeError);
    expect(() => s.add(8)).toThrow(RangeError);
    expect(() => m.clear()).toThrow(RangeError);
    expect(() => s.clear()).toThrow(RangeError);
    // the maps' locks were released, and their entries are as they were
    expect(m.size).toBe(8);
    expect(m.get(3)).toBe(3);
    m.set(3, 30);
    expect(m.get(3)).toBe(30);
    expect([...m.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s.size).toBe(8);
    expect(s.has(7)).toBe(true);
    expect(s.delete(7)).toBe(true);
    expect(s.size).toBe(7);
  });
});
