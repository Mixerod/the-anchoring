---
title: Caching, and the four ways a cache takes down the thing it protects
residency: index
tags: [caching, cdn, performance, latency, invalidation]
when:
  - a read is slow and the same answer is computed again and again
  - a cache is being added in front of a database or an API
  - stale data has been served after a write
  - a restart or a deploy is followed by a latency spike
  - many clients miss the cache for the same key at the same moment
  - requests for keys that do not exist reach the database
  - a cache node is added or removed
  - deciding what to store at the edge versus near the service
---

# Caching, and the four ways a cache takes down the thing it protects

A cache is a bet that the same answer will be wanted again before it goes wrong. Two numbers
decide whether the bet pays: the **hit rate**, and the **cost of a miss**. A 99% hit rate on a
cache whose misses stampede is worse than an 80% hit rate that degrades smoothly.

**Before adding a cache, try**: an index (`database-performance.md`), fewer round trips, or a
cheaper query. A cache is a second source of truth, and every second source of truth is a
consistency bug waiting for a schedule.

## Where to put it

| Layer | Reach for it when | Cost |
|---|---|---|
| **CDN / edge** | the same bytes serve many users, geography dominates latency | invalidation is slow and global; personalised responses must not land here |
| **Distributed cache** (Redis, Memcached) | many instances must share one answer | a network hop, an operational dependency, and a new failure mode |
| **Local / in-process** | the value is tiny, hot, and tolerates being slightly stale per instance | N copies, N different staleness, no invalidation story |
| **Two-level** (local in front of distributed) | a hot key would otherwise crush one cache node | two TTLs to reason about; the local layer hides the shared one |

## Read and write strategies

| Strategy | How | Reach for it when |
|---|---|---|
| **Cache-aside** (lazy) | app reads cache, on miss reads store and fills | the default; simple, and the cache can fail without correctness loss |
| **Read-through** | the cache itself fetches on miss | you want the fill logic in one place, not in every caller |
| **Write-through** | write to cache and store together | reads right after writes must be correct, and write latency can absorb it |
| **Write-behind** | write to cache, flush to store asynchronously | write throughput dominates and some loss is acceptable |
| **Write-around** | write to store, do not populate the cache | writes are frequent and rarely read back soon |

**Write-behind is the one that loses data.** A crash between the cache write and the flush is
silent, permanent loss. Do not reach for it for anything you would be unwilling to lose.

## Eviction

- **LRU** — evict least recently used. The right default.
- **LFU** — evict least frequently used. Better when a small set is hot for a long time; worse
  when popularity shifts, because yesterday's hits keep new entries out.
- **FIFO** — evict oldest. Cheap, ignores usage; rarely the right answer.
- **TTL** — expire by age. Not an eviction policy but a staleness bound, and orthogonal to the
  above: use both.

**A cache with no size ceiling is a memory leak with good intentions.** Set `maxmemory` and an
eviction policy explicitly; the default in several stores is to start returning errors on
write instead of evicting.

## Invalidation

The two hard problems joke exists because there is no general answer. There are three
specific ones:

1. **TTL only** — accept staleness up to the TTL. Simplest, most robust. Reach for it unless
   you can state why bounded staleness is unacceptable.
2. **Write-time invalidation** — delete the key on write. Correct until two writers race, or
   until one of the eight places that write the row forgets. **Fails as**: a key that stays
   stale forever because a code path nobody remembered also writes.
3. **Versioned keys** — put a version in the key itself, and bump the version instead of
   deleting: `v{schema}:{ruleset}:{id}`. Nothing to invalidate; old entries age out. **Reach
   for this whenever the cached value depends on code or configuration**, because a key built
   from inputs alone keeps serving results computed under rules that no longer exist.

**Cache warming** — populate before traffic arrives. Reach for it when a cold cache cannot
survive real load; that is a fact about your miss cost and it is worth measuring before a
deploy discovers it for you.

## The four failure modes, by name

These are what actually takes systems down. Each has a distinct fix.

### Cache stampede (thundering herd)

**Signal** — a popular key expires and a thousand concurrent requests all miss and all hit the
database at once.

**Fixes**, cheapest first:
- **Request coalescing / single-flight** — one in-flight fill per key, the rest wait on it.
  This is the fix; it needs no coordination beyond one process, and a lock in the shared cache
  extends it across processes.
- **Probabilistic early expiration** — each reader refreshes early with a probability that
  rises as the TTL approaches, so refreshes spread out instead of aligning.
- **Stale-while-revalidate** — serve the stale value and refresh in the background. Best user
  experience when bounded staleness is acceptable.
- **Never use a fixed TTL for keys written together.** Add jitter, or a batch import will
  expire ten thousand keys in the same second, forever.

### Cache penetration

**Signal** — requests for keys that do not exist go straight through to the database, every
time. Often an attack, sometimes a broken client enumerating IDs.

**Fixes** — cache the negative result with a short TTL; or put a **Bloom filter** in front,
which answers "definitely absent" or "possibly present" in a few bits per key. A Bloom filter
never returns a false negative, which is exactly the property needed here.

### Cache avalanche

**Signal** — a large fraction of the cache expires or is lost at once (a mass TTL expiry, a
cache node restart, a flush) and the full load lands on the store.

**Fixes** — jitter every TTL; replicate the cache so one node's loss is partial; and rate limit
or shed at the store so the store survives being the origin for a while. See
`fault-tolerance.md`.

### Hot key

**Signal** — one key takes a disproportionate share of traffic and saturates a single cache
node no matter how the ring is balanced.

**Fixes** — a local in-process cache in front of the shared one (two-level), or split the key
across N replicas and read a random one.

## Cold starts

A process, a container, or a serverless function that must warm caches, JIT-compile, and open
connections before its first fast response. **Signal**: p99 latency spikes after every deploy
or scale-up while p50 is fine.

Fixes: pre-warm on startup before reporting ready (see readiness probes in
`traffic-management.md`), keep a warm pool, or shift traffic gradually so a cold instance is
never handed full load.

## Measure the right numbers

- **Hit rate** alone is not health. A 95% hit rate with a 2-second miss still gives a terrible
  p99 — see tail latency in `observability.md`.
- **Record hit, miss, and eviction counts.** Rising evictions with a falling hit rate means
  the cache is too small, and no amount of tuning TTLs fixes that.
- **State a memory ceiling and a staleness bound before you start.** "Use the cache" is a
  technique; the goal is a budget, and you optimise against a budget.
