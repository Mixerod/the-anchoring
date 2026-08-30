---
title: Concurrency, memory, and the bugs that only appear under load
residency: index
tags: [concurrency, threads, race-conditions, memory, gc, profiling, deadlock]
when:
  - two things can touch the same state at the same time
  - a bug reproduces only under load or only in production
  - memory grows steadily until the process is killed
  - the process pauses periodically for no visible reason
  - a check-then-act sequence exists in code
  - threads or workers are all blocked and nothing progresses
  - a performance problem needs measuring rather than guessing
---

# Concurrency, memory, and the bugs that only appear under load

Concurrency bugs share one property that makes them uniquely expensive: **they do not reproduce
on demand.** They appear under load, disappear under a debugger, and pass every test. So the
discipline is prevention by structure, not detection by testing.

**The strongest prevention is not sharing.** No shared mutable state, no race. Immutable values,
message passing, and per-task ownership eliminate whole categories rather than guarding them.
Reach for a lock only when sharing is genuinely required.

## Concurrency is not parallelism

**Concurrency** is structure: several tasks in progress, interleaved. **Parallelism** is
execution: several tasks running at the same instant. A single-core machine is concurrent and
not parallel.

This decides the tool:
- **I/O-bound** (waiting on network or disk) — concurrency is what you need. Async, or many
  cheap threads. More CPU cores do nothing.
- **CPU-bound** (computing) — parallelism is what you need. Cores, processes, or a language
  without a global interpreter lock. Async does nothing.

**Signal you have chosen wrong**: adding cores does not help (it was I/O-bound), or async
rewriting did not help (it was CPU-bound).

## Race conditions

**Signal**: any check-then-act or read-modify-write on shared state.

```
if (!exists(key)) create(key)     // two callers, two creates
balance = read(); write(balance - 10)   // two callers, one deduction lost
```

Fixes, in order of preference:

1. **Make it atomic at the layer that owns the data.** A unique constraint in the database, an
   `UPDATE ... WHERE balance >= 10`, a compare-and-swap. The database is already good at this;
   application-level guarding of a database race is a race with more steps.
2. **Atomic operations** — compare-and-swap, atomic counters. No lock, no blocking.
3. **A lock**, if the critical section is more than one operation.

**Across processes, this becomes a distributed lock**, which needs a fencing token to be safe —
see `distributed-data.md`. A lock in a single process does not generalise by adding Redis.

## Locks and deadlock

- **Mutex** — one holder at a time.
- **Read-write lock** — many readers or one writer. Reach for it when reads dominate heavily;
  otherwise the extra bookkeeping costs more than it saves.
- **Semaphore** — at most N holders. This is the natural way to bound concurrency against a
  downstream, and it is a bulkhead (see `fault-tolerance.md`).

**Deadlock has one practical prevention: acquire locks in a globally consistent order.** Almost
every deadlock is two paths taking A then B, and B then A. Write the order down.

**Hold locks for the shortest possible time, and never across I/O.** A lock held across a
network call has a duration set by someone else's latency, and it converts a slow dependency
into a total stall.

**Signal**: throughput collapses to near zero while CPU is idle. Take a thread dump; deadlocks
are obvious in one.

## Thread and worker pools

**Every pool is bounded, or it is a load generator.** An unbounded pool responds to a spike by
creating threads until memory is exhausted, and each of those threads opens a connection to
something downstream.

**Size the pool against the bottleneck, not the core count.** For CPU-bound work, roughly the
core count. For I/O-bound work, larger — but the real constraint is usually the downstream's
capacity, and the correct size is the one that saturates it and no more.

**Separate pools per dependency.** One shared pool means a slow dependency starves everything —
the bulkhead argument again, and the most common way an unrelated service takes down checkout.

**A bounded pool with an unbounded queue in front is not bounded.** The queue must be bounded
too, and the rejection policy chosen: fail fast, or block the caller (which propagates
backpressure, and is often the right answer).

## Memory

- **Stack** — per-thread, automatic, small. Deep recursion overflows it.
- **Heap** — dynamically allocated, garbage collected or manually freed. Everything interesting
  lives here.

**A memory leak in a garbage-collected language is a reference you forgot**, not a missing
free: an ever-growing cache, an event listener never removed, a static collection, a closure
capturing more than intended. The garbage collector correctly retains everything reachable; the
bug is that it is still reachable.

**Signal**: memory rising steadily across a week with a sawtooth at restarts. **A service that
is "fine because it restarts nightly" has a leak**, and the restart is hiding it.

**Find it with a heap snapshot, not by reading code.** Two snapshots an hour apart, diffed, name
the growing type immediately. Guessing at leaks is close to unbounded work.

**Fragmentation** — enough free memory in total, none of it contiguous enough. Presents as
allocation failure at well below the apparent limit. Mostly an allocator and workload issue;
usually addressed by object pooling for the offending size class.

## Garbage collection

**GC pauses are a p99 problem.** The median request never sees one; some requests see the whole
pause. This is one of the most common causes of a tail-latency mystery — see `observability.md`.

- **Allocation rate is the lever.** Most GCs collect young objects almost for free; the cost
  comes from objects that survive long enough to be promoted. Reducing allocation in hot paths
  is usually more effective than tuning collector parameters.
- **Heap size is a trade**: a larger heap means less frequent, longer pauses.
- **Tune only with measurements.** GC flags copied from a blog post are the classic example of
  changing something you have not measured. Enable GC logging first.
- **A container memory limit below the heap size plus overhead means `OOMKilled`**, not a GC
  error, and the process dies with no stack trace. Runtimes that are container-aware read the
  limit; older ones read the host's memory and set a heap far larger than the container allows.
  See `containers-kubernetes.md`.

## Profiling: measure, do not guess

**The bottleneck is not where you think it is.** This is reliable enough to be a rule. Profile
first, every time.

- **CPU profile** — where time is spent. A **flame graph** reads bottom-up as the call stack and
  wide-as-expensive; the widest plateau is the answer.
- **Memory / allocation profile** — what is allocating and what is retained. The two are
  different questions and most tools separate them.
- **Profile in production**, or under a load that resembles it. A profile of a synthetic
  benchmark optimises a program nobody runs. Continuous low-overhead profiling is available in
  most runtimes now and is worth enabling.

**Benchmark honestly**: warm up first (JIT, caches, pools), run long enough to be stable, report
percentiles rather than a mean, and change one thing at a time.

## Async pitfalls worth naming

- **Blocking inside an async runtime** stalls the event loop and every task on it. One
  synchronous file read or one CPU-heavy loop in an async handler destroys the throughput of the
  whole process. Move it to a worker pool.
- **Unbounded task spawning** is an unbounded thread pool wearing different clothes. Bound it
  with a semaphore.
- **Unawaited work** disappears silently, taking its exception with it.
- **Cancellation must propagate.** When the caller gives up, the work should stop; otherwise a
  timeout does not free the resources it was supposed to free. See deadline propagation in
  `fault-tolerance.md`.

## Testing concurrency

Ordinary tests will not find these. What works:

- **Stress under real concurrency** — many iterations, many threads, in CI, with a timeout that
  catches a deadlock as a failure rather than a hang.
- **Race detectors and thread sanitizers**, where the language has them. They find real races
  that never manifested, which is far cheaper than production finding them.
- **Deterministic simulation** — inject the scheduler and the clock so an interleaving is
  reproducible from a seed. Expensive to set up, and the only technique that makes these bugs
  debuggable rather than merely detectable.
- **A failing concurrency test that passes on rerun has not passed.** Treat a flake here as a
  confirmed bug, because that is what it almost always is.
