---
title: Scaling shapes — what to grow, what to split, and what to leave alone
residency: index
tags: [scaling, architecture, microservices, autoscaling, stateless, capacity]
when:
  - the system is at capacity and must handle more
  - a monolith is being considered for a split into services
  - instances must be added or removed automatically
  - state in a process prevents adding a second instance
  - one tenant or customer can affect all the others
  - capacity must be planned ahead of a known traffic event
  - work should be spread across many workers and the results collected
---

# Scaling shapes — what to grow, what to split, and what to leave alone

Scaling questions are almost always answered in the wrong order. The order that works:

1. **Make it faster.** An index, an N+1 fix, a cache. Usually an order of magnitude, usually a
   day of work. See `database-performance.md` and `caching.md`.
2. **Make it bigger.** A larger machine. Boring, immediate, and it buys a year.
3. **Make it stateless and add copies.** Horizontal scaling. This is the real answer for
   compute.
4. **Split the data.** Read replicas, then partitioning, then sharding.
5. **Split the system.** Services, then cells. This is the most expensive step and the one most
   often taken first.

**Do not skip to step 5 to solve a step-1 problem.** Extracting a service does not make a slow
query fast; it makes it a slow query with a network hop in front of it.

## Vertical or horizontal

- **Vertical (bigger machine)** — no code change, no distribution, no new failure modes. Reach
  for it first, always. **Costs**: a ceiling, a price curve that turns sharply upward, and a
  restart to resize. **A single machine is a single point of failure regardless of size.**
- **Horizontal (more machines)** — no ceiling, and redundancy comes free. **Costs**: the work
  must be distributable, which means the process must be stateless.

## Stateless is the precondition

**A stateless service keeps no request-scoped state in the process between requests.** Not
caches — caches are fine and are per-instance. State: sessions, uploads in progress, in-memory
work queues, "the user is on step 3".

**Signal that a service is not stateless**: it needs sticky sessions, or a user's flow breaks
when an instance restarts, or you cannot scale to zero, or a deploy loses something.

**Move the state**: to a shared store (sessions, carts), to the client (a signed token), or to
a queue (in-flight work). Every one of those is cheaper than making the load balancer
compensate with stickiness. See `traffic-management.md`.

**Stateful services are not forbidden** — databases, brokers, and caches are stateful and must
be. They are simply the parts that need identity, ordered startup, and stable storage, which is
exactly the distinction Kubernetes draws between a Deployment and a StatefulSet. See
`containers-kubernetes.md`.

## Autoscaling

**Reach for it when** load varies enough that fixed capacity is either wasteful or insufficient.

- **Scale on the metric that reflects the bottleneck.** CPU is the default and is frequently
  wrong: an I/O-bound service is at 20% CPU while every thread is blocked. Scale on requests in
  flight, queue depth, or consumer lag — whichever actually saturates.
- **Scale out fast, scale in slowly.** Adding capacity late costs an outage; removing it late
  costs money. Asymmetric thresholds and a cooldown on scale-in prevent flapping.
- **Know the ceiling.** Adding application instances does nothing if the database connection
  limit is the constraint — and it makes things worse, because each new instance opens a pool.
  See `database-performance.md`. **Autoscaling a service in front of a fixed-size dependency is
  a mechanism for amplifying an outage.**
- **Cold start is part of the response time.** If an instance takes 90 seconds to become ready,
  autoscaling cannot respond to a 30-second spike. Pre-warm, or keep headroom.

## Monolith, modular monolith, services

**Start with a modular monolith.** One deployable, strict internal module boundaries enforced by
a checker. It gives you almost every benefit attributed to microservices — clear ownership,
independent reasoning, replaceable parts — with none of the distributed-systems cost.

**Reach for separate services when** you can name which of these you are buying:

- **Independent deployment** — a team is blocked by another team's release cadence.
- **Independent scaling** — one component needs 50 instances and the rest need 2.
- **Fault isolation** — one component must be able to fail without the rest.
- **Different runtime** — a genuine need for another language or hardware.

**If none of those applies, the split is buying nothing** and costing you: network calls where
function calls were, partial failure where there was none, distributed transactions where there
was one, and a deploy that must now be coordinated anyway.

**A service boundary is a data boundary.** If two services share a database, you have a
distributed monolith: all the operational cost, none of the independence. Each service owns its
data and others ask through its API. This is the same rule as module ownership, enforced by a
network instead of a linter.

**Split along the seams the domain already has**, not along technical layers. A "database
service" and an "API service" is one system in two deployables.

## Cell-based architecture

**Reach for it when** the blast radius of a failure must be bounded and horizontal scaling alone
cannot do it.

A cell is a complete, independent copy of the stack — compute, data, cache — serving a subset
of users. Cells share nothing. A bad deploy, a poison record, a hot tenant, or a corrupt cache
affects one cell.

**This is the bulkhead pattern at the level of the whole system.** It is what makes "we lost
5% of traffic" possible instead of "we were down".

**Cost** — substantial. Routing users to cells, migrating between cells, running N copies of
everything, and per-cell operations. Reach for it when an outage's blast radius is a business
problem, not before.

**Multi-tenancy** raises the same question one level down: a noisy tenant degrades everyone
unless there are per-tenant quotas (see `traffic-management.md`), and the largest tenants
eventually need their own cell.

## Scaling the data

- **Read replicas** — for read-heavy load. Costs replication lag; see read-your-writes in
  `distributed-data.md`.
- **Partitioning** — one database, one table split by range, list, or hash. Reach for it for
  maintainability at size: faster index rebuilds, cheap deletion of old ranges.
- **Sharding** — several databases. The last resort. The shard key is nearly irreversible; see
  `distributed-data.md`.
- **Write scaling is genuinely hard.** Options are: shard, batch (fewer, larger writes), buffer
  through a queue, or move the write out of the hot path entirely. Try the last two first.

## Asynchronous shapes

- **Queue-based work** — accept fast, return an ID, process later. Converts a scaling problem
  into a latency problem, which is usually the better problem. See `messaging.md`.
- **Worker pool** — a bounded set of workers pulling from a queue. Bounded is the important
  word: an unbounded worker pool is an unbounded load generator aimed at your database.
- **Fan-out** — one request becomes N parallel calls. The latency is the slowest of the N, so
  p99 of the whole is far worse than p99 of each. With 100 parallel calls, a per-call p99 of 1%
  means the fan-out almost always contains at least one slow call. **Hedged requests** — send a
  duplicate to a second replica after the p95 and take the first answer — is the standard fix,
  at the cost of extra load.
- **Fan-in** — collect N results. Needs a timeout and a partial-result policy: what do you
  return when 97 of 100 answered? Decide before the incident.

## Capacity planning

Three numbers, and they must be measured rather than estimated:

1. **What one instance can serve**, measured by load testing to the point of failure — not to
   the point where you got nervous. See `incident-response.md`.
2. **The peak you must serve**, including the known events (a sale, a launch, a broadcast).
3. **The headroom**, which is not a feeling. It is the time to add capacity multiplied by the
   growth rate during that time, plus the loss of your largest failure domain. If losing one
   availability zone must be survivable, you need N+1 zones of capacity, not N.

**The number that matters is time-to-capacity.** A system that autoscales in 60 seconds needs
much less headroom than one that needs a purchase order.
