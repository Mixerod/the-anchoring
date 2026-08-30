---
title: Timeouts, retries, circuit breakers, and bulkheads
residency: index
tags: [reliability, retries, timeouts, circuit-breaker, backpressure, resilience]
when:
  - a dependency is slow rather than down
  - a failed call is about to be retried
  - one failing dependency is taking the whole service with it
  - a service must keep working with a feature switched off
  - a process is killed mid-request during a deploy
  - all worker threads are blocked on the same downstream
  - a downstream recovers and is immediately knocked over again
---

# Timeouts, retries, circuit breakers, and bulkheads

These four are usually introduced together and they solve four different problems. Adding them
in the wrong order — retries before timeouts, most commonly — makes the system less reliable,
not more.

**The order that works**: timeout, then bulkhead, then circuit breaker, then retry. A retry
without a timeout multiplies a hang. A retry without a circuit breaker turns a struggling
dependency into a dead one.

## Timeouts come first

**Slow is worse than down.** A dependency that returns an error in 1 ms costs you nothing; a
dependency that takes 30 seconds consumes a thread, a connection, and a slot in every pool
between you and it, for 30 seconds, per request. Enough of those and your service is down for
reasons that have nothing to do with your code.

**Every call has a timeout.** Set it from the dependency's measured p99 plus headroom — not
from a round number someone liked. A timeout longer than the caller's own patience is
decorative.

**Propagate the deadline.** If the caller has 2 seconds left, every hop downstream must be told
it has 2 seconds left. Without propagation, a chain of individually reasonable timeouts
multiplies into a total nobody chose, and work continues on requests whose callers gave up long
ago — which is pure waste at exactly the moment you can least afford it.

**Check the deadline before starting expensive work, not only around the call.** A request that
has 5 ms left should be rejected, not begun.

## Retries, and the two things that make them safe

**Retry only what is safe to retry.** That means: the operation is idempotent (see
`delivery-semantics.md`), and the failure is transient. A 400 will be a 400 again. A 500 or a
connection reset might not be.

**Exponential backoff.** Wait 100 ms, 200, 400, 800 — not 100, 100, 100. Constant-interval
retries are how a brief blip becomes a sustained overload.

**Jitter, and this is the part people omit.** Without randomness, every client that failed at
the same moment retries at the same moment, and the recovering dependency is hit by a
synchronised wave — the **thundering herd**. Full jitter (`sleep = random(0, backoff)`) is
simple and effective, and the difference between it and no jitter is the difference between a
recovery and a second outage.

**Cap the attempts, and cap the total.** Three attempts is usually right. More than that, and
you are queueing work against something that is not answering.

**Retry budgets** are the fleet-level control the per-call limits miss. Allow retries to be at
most, say, 10% of total requests; past that, stop retrying regardless of policy. This is what
prevents a **retry storm**: with three retries per call, a service in trouble receives four
times its normal load at precisely the moment it can handle less than normal.

**Retry at one layer only.** The client retries, the gateway retries, the mesh retries, and the
library retries — four layers of three attempts is 81 requests for one call. Decide which layer
owns retries and switch it off everywhere else.

## Circuit breaker

**Reach for it when** a dependency's failure should stop being *attempted*, not merely handled.

Three states:
- **Closed** — calls pass. Failures are counted.
- **Open** — calls fail immediately without touching the dependency. This is the point: you
  stop spending threads and time on something that will not answer, and you stop adding load to
  something already struggling.
- **Half-open** — after a cooldown, let a small number of calls through. Success closes the
  circuit; failure opens it again.

**Tune on a rate over a window, not on a count.** "Fifty failures" trips instantly during a
traffic spike and never during a quiet outage. "50% of at least 20 requests in 30 seconds" is
the usual shape.

**Half-open must be limited to a few requests.** Letting full traffic through at cooldown
knocks over the dependency that had just begun to recover, repeatedly.

**Decide what open means for the caller.** A breaker converts a slow failure into a fast one —
it does not create an answer. Pair it with a fallback, a cached value, or a clear degraded
response. A breaker that opens and returns a 500 has improved your latency and nothing else.

## Bulkhead

**Reach for it when** one dependency's problems can consume a resource that everything else
needs — most often a shared thread pool or connection pool.

**Signal**: the recommendations service is down and *checkout* is failing. Nothing in checkout
calls recommendations; they simply share the pool, and recommendations has all of it.

**The fix is isolation**: a separate, bounded pool per dependency. Recommendations may consume
its own 10 threads and no more. When they are gone, calls to recommendations fail fast and
everything else is unaffected.

Isolate at whatever granularity the damage flows through: thread pools, connection pools,
process boundaries, whole cells (see `scaling.md`).

**Cost** — worse utilisation. Reserved capacity sits idle. That is what you are buying.

## Backpressure

**Reach for it when** a component is receiving work faster than it can complete it.

Three responses, and the first two are the good ones:
1. **Push back** — refuse work at the boundary so the producer learns immediately.
2. **Pull** — let the consumer request work at its own rate. Backpressure for free, which is a
   real argument for pull-based consumption.
3. **Buffer** — a queue. Legitimate for smoothing bursts; **an unbounded buffer is not
   backpressure, it is a deferred outage.** See `messaging.md`.

**A queue with no bound and no alert on depth converts a throughput problem into a memory
problem and then into a data-loss problem**, and each conversion makes it harder to diagnose.

## Graceful degradation

**Reach for it when** a feature is optional and the core is not. Recommendations fail: show the
page without them. The avatar service is down: show initials. Personalisation is unavailable:
show the default.

**Design the degraded state as a real state**, with its own tests and its own appearance.
Degradation invented during an incident is a second incident.

**Feature flags are the mechanism**: a switch to turn off an expensive or failing subsystem
without a deploy. See `delivery-pipeline.md`.

## Graceful shutdown

**Reach for it when** processes are stopped routinely — which, with rolling deploys and
autoscaling, is constantly.

The sequence, in order:
1. **Fail readiness** so the load balancer stops sending new work. Wait long enough for that to
   propagate — several seconds, not milliseconds; this is the step everyone omits, and it is
   why deploys produce a burst of 502s.
2. **Stop accepting** new requests and new messages.
3. **Finish in-flight work**, up to a bounded grace period.
4. **Release** connections, locks, and leases explicitly.
5. **Exit.**

**Consumers must commit or release their messages before exiting**, or the same messages are
redelivered on every deploy — which is a duplicate-processing problem, and returns you to
`delivery-semantics.md`.

## The ordering, restated

If you take one thing from this file: **a retry added to a system with no timeout, no breaker,
and no budget is a load multiplier aimed at whatever is already failing.** Add the timeout
first. It is the change with the highest reliability return of anything in this file, and it is
usually one line.
