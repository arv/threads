---
title: Status
description: What works, and the real limits it has today.
---

@arv/threads is experimental, and it has real limits. Here's where things stand
today:

- **The compiler needs no fork.** @arv/threads-check compiles shared structs and
  SharedArrays to typed-array reads and writes (`b.x` becomes
  `__F64[(b >> 3) + 1]`), and counts their references, on stock TypeScript 7.1's
  API. It edits each module's TypeScript, and OXC (Vite's, or its own) strips
  the types. With types only erased, programs still run, but shared structs are
  much slower (see
  [Performance](/performance/#compiled-or-with-the-types-only-erased)).
- **The playground compiles on stock TypeScript in the browser too.** TypeScript
  7.1's API has no WebAssembly build, so the playground builds one: stock
  TypeScript's API server, compiled to WebAssembly from the commit TypeScript's
  npm package was built from. threads-check runs in a worker and talks to it
  over shared memory, as it talks to a tsgo process on Node.
- **The checker needs no fork either.** @arv/threads-check checks ownership on
  the same API. Nothing here builds, runs or needs the fork of TypeScript it
  replaced, [arv/threads-checker](https://github.com/arv/threads-checker), any
  more: the compiler, the checker, the Vite plugin, the playground and CI all
  run on stock TypeScript.
- **Shared memory is a fixed 256 MB.** Structs, SharedArrays, SharedMaps,
  SharedSets, channels, locks, conditions, immutable shared values and interned
  strings are reference counted. Freeing a channel also releases its unread
  messages; freeing a shared value releases its nested references and strings.
  Blocked operations retain the cells they wait on. `collectCycles()` includes
  channel buffers and shared values, stopping every thread for a moment. When an
  allocation would fail outside internal runtime locks, the allocator tries one
  collection with a 50 ms timeout and retries. Boxed handles and frozen copies
  wait for V8 to collect them and run their finalizers. Runtime metadata and
  legacy `sharedFloat64Array` cells still live for the program's lifetime.
- **Closures don't cross threads.** A thread runs a top-level function.
- **A SharedMap or SharedSet has one lock.** Every call takes it for a moment,
  so threads that change one map all the time wait for each other. A thread with
  many changes should make them in a Map of its own, and merge once.
- **Goroutines have limits.** A goroutine of a plain function is a whole worker.
  One per core is fine, but thousands are not. Async goroutines are light but
  cooperative. One that computes without awaiting holds up the others on its
  worker, and none moves to another worker once it has started.
- **Moving revokes.** The values you move are revoked, so using them throws.
  With `start({ check: true })`, everything inside them is revoked too.

[Reference Counting](/reference-counting/#limits) explains what is freed and
when, and the limits of counting.
