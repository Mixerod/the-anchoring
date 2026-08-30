---
title: Load balancing, rate limiting, and the layer in front of your services
residency: index
tags: [load-balancing, rate-limiting, gateway, proxy, service-discovery, mesh]
when:
  - traffic must be spread across more than one instance
  - one client or tenant can degrade the service for everyone
  - the system is past capacity and must choose what to drop
  - a cache node is added and nearly every key moves
  - instances come and go and something must find them
  - a deploy needs to shift traffic gradually rather than all at once
  - a user session breaks when they reach a different instance
  - requests must be authenticated or TLS terminated before reaching a service
---

# Load balancing, rate limiting, and the layer in front of your services

Everything here sits between the client and your code. Modern proxies and gateways do several
of these jobs at once — TLS termination, authentication, rate limiting, caching, load
balancing, routing — and the useful question is which of them you actually need, because each
one you switch on is a thing that can fail in front of everything.

## L4 or L7

- **L4 (TCP)** — forwards bytes. Fast, protocol-agnostic, cannot see a URL or a header. Reach
  for it for raw throughput, or to balance a non-HTTP protocol.
- **L7 (HTTP)** — reads the request. Can route by path, retry idempotent requests, apply
  per-endpoint limits, and terminate TLS. Reach for it whenever you need any of that. Costs
  CPU, and adds a hop that must itself be made highly available.

## Load balancing algorithms

| Algorithm | Reach for it when | Fails as |
|---|---|---|
| **Round robin** | requests cost roughly the same | a slow backend still gets its full share |
| **Weighted round robin** | instances differ in size | weights go stale after a resize nobody updated |
| **Least connections** | request cost varies widely | a backend failing *fast* looks idle and attracts traffic |
| **Least response time** | latency matters more than fairness | oscillation: everyone piles onto whoever was fastest last |
| **Random, two choices** | you want least-connections behaviour without global state | nothing serious — this is the good default at scale |
| **IP hash** | crude session affinity | breaks under NAT, where thousands share an address |
| **Consistent hashing** | backends hold state or cache keyed by the request | uneven load without virtual nodes |
| **Maglev hashing** | consistent hashing with better balance and faster lookup | more memory for the lookup table |

**Power of two choices is the underrated default**: pick two backends at random, send to
whichever has fewer requests in flight. Nearly all the benefit of least-connections, none of
the global coordination, and it does not oscillate.

## Consistent hashing

**Reach for it when** adding or removing a node must not reshuffle every key — caches,
sharded stores, sticky routing to stateful workers.

**Instead of** hashing modulo the node count, which remaps almost every key when the count
changes. Adding one cache node to nine invalidates around 90% of the cache; consistent
hashing moves around 10%.

**Cost** — plain consistent hashing gives uneven load. Fix it with **virtual nodes**: place
each physical node at 100–200 points on the ring. Without them, load can differ several-fold
between nodes.

**Fails as** — a **hot key**. Hashing distributes *keys*, not *traffic*. One key taking a
million requests lands on exactly one node no matter how good the ring is. Fix that with a
local cache in front of it, or by splitting the key.

## Rate limiting

Rate limiting protects the service from its callers; load shedding protects it from itself.
They are different, and you want both.

| Algorithm | Behaviour | Reach for it when |
|---|---|---|
| **Token bucket** | steady rate, burst up to the bucket size | the common default — real clients are bursty |
| **Leaky bucket** | smooths output to a constant rate | a downstream needs a genuinely flat rate |
| **Fixed window** | count per clock window | rarely, in practice — see below |
| **Sliding window log** | exact, keeps per-request timestamps | precision matters more than memory |
| **Sliding window counter** | approximates the log from two windows | you want fixed-window cost without its flaw |

**Fixed window's flaw is worth knowing by name**: a limit of 100 per minute permits 100
requests at 11:59:59 and 100 more at 12:00:00 — 200 within one second. The sliding window
counter costs almost nothing more and does not do that.

**Where to enforce it.** A per-instance limit is not a limit: with twenty replicas your "100
per second" is 2,000 per second. Either enforce at a shared gateway, or divide the budget and
accept the imprecision — but *decide* which, and write it down.

**Return 429 with `Retry-After`.** A limiter that returns 500, or silently drops, converts a
well-behaved client into a retry storm.

## Load shedding

**Reach for it when** the system is already past capacity. Rate limiting is per-caller and set
in advance; shedding is global and reactive — at overload, reject cheaply and immediately
rather than accepting work you cannot finish.

**The rule that matters**: shed *before* the queue, not after. Work queued for 30 seconds and
then dropped cost you the 30 seconds and delivered nothing. Check queue depth or the request's
remaining deadline at admission, and reject there.

**Prioritise.** Shed background and retry traffic before interactive traffic, and anonymous
before authenticated. A shedder with no priority classes drops your health checks and your
paying customers with equal enthusiasm.

## Health checks

- **Liveness** — "should I be restarted?" Must not check dependencies. A liveness probe that
  fails because the database is down restarts every instance at once and turns an outage into
  an outage plus a cold start.
- **Readiness** — "should I receive traffic?" *This* is where dependency checks belong.
- **Startup** — "am I still booting?" Stops liveness from killing a slow starter that has
  never yet been ready.

Probe mechanics are in `containers-kubernetes.md`.

## Service discovery

**Reach for it when** instances come and go — autoscaling, rolling deploys, preemptible
nodes. A static host list stops being true within a day of the first autoscaler.

- **Client-side** — the client asks a registry and picks. Fewer hops; more logic in every
  client and every language.
- **Server-side** — the client calls a stable name and a proxy or the platform resolves it.
  One place to change; one more hop to keep alive.

**DNS is discovery with a cache you do not control.** TTLs are honoured inconsistently by
language runtimes, and some cache forever. If instances change often, do not rely on DNS
alone.

## Traffic shifting and sticky sessions

**Traffic shifting** — route a percentage to a new version. This is the mechanism under canary
releases; see `delivery-pipeline.md`.

**Sticky sessions** — pin a user to an instance. **Try first: do not.** Stickiness turns a
stateless service into a stateful one; it breaks autoscaling, complicates deploys, and
produces uneven load. Reach for it only when the state genuinely cannot move — and prefer
moving the state to a shared store instead, which is the change that actually solves the
problem.

## Service mesh

**Reach for it when** you need mTLS, retries, timeouts, circuit breaking, and per-hop
telemetry *uniformly across many services in several languages*, and you are tired of
implementing them once per language.

**Cost** — a sidecar per pod (memory, CPU, an extra hop), a control plane to run and upgrade,
and a second place where traffic can break. The characteristic failure is a fleet-wide outage
caused by a control-plane configuration push.

**Try first** — a shared client library, if you have one or two languages. A mesh earns its
cost at many services in many languages, and rarely before.
