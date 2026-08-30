---
title: The systems spine — the forty concepts the rest hang off
residency: index
tags: [systems, architecture, index, fundamentals]
when:
  - a system design is being sketched from scratch
  - deciding which part of the system a symptom belongs to
  - an unfamiliar failure needs to be named before it can be fixed
  - choosing what to learn or review before a design discussion
  - a design review needs a checklist of what was not considered
---

# The systems spine — the forty concepts the rest hang off

There are several hundred terms in this field and they are not equally load-bearing. Roughly
forty of them are the junctions: understand these and the rest are variations. This file is
the map — each entry names the concept and the file that treats it as a decision.

Use it two ways: as a **router** when a symptom needs a home, and as a **checklist** when a
design is being reviewed and you need to know what was not considered.

## The request path

| Concept | Where |
|---|---|
| Latency vs throughput vs bandwidth | `networking-transport.md` |
| Timeouts: connect, read, write | `networking-transport.md` |
| Deadline propagation | `networking-transport.md`, `fault-tolerance.md` |
| Connection pooling and keep-alive | `networking-transport.md` |
| L4 vs L7 | `traffic-management.md` |
| Load balancing and power-of-two-choices | `traffic-management.md` |
| Consistent hashing | `traffic-management.md` |
| Rate limiting (token bucket, sliding window) | `traffic-management.md` |
| Load shedding | `traffic-management.md` |
| Idempotency at the API edge | `api-communication.md` |

## Data

| Concept | Where |
|---|---|
| Index shape and composite column order | `database-performance.md` |
| N+1 queries | `database-performance.md` |
| Transactions, ACID, isolation levels | `database-performance.md` |
| MVCC and long-running transactions | `database-performance.md` |
| Write-ahead logging, write amplification | `database-performance.md` |
| Read replicas and replication lag | `database-performance.md` |
| Partitioning vs sharding | `database-performance.md`, `distributed-data.md` |
| Shard key choice and hot partitions | `distributed-data.md` |
| Expand / migrate / contract migrations | `database-performance.md` |

## Distribution

| Concept | Where |
|---|---|
| CAP, stated as a partition-time choice | `distributed-data.md` |
| Read-your-writes and causal consistency | `distributed-data.md` |
| Quorum: R + W > N | `distributed-data.md` |
| Consensus, Raft, leader election | `distributed-data.md` |
| Split brain and fencing tokens | `distributed-data.md` |
| Logical and vector clocks | `distributed-data.md` |

## Caching

| Concept | Where |
|---|---|
| Cache-aside vs write-through vs write-behind | `caching.md` |
| Invalidation, and versioned keys | `caching.md` |
| Stampede, penetration, avalanche, hot key | `caching.md` |
| CDN and edge caching | `caching.md` |

## Asynchrony

| Concept | Where |
|---|---|
| At-least-once vs exactly-once | `delivery-semantics.md` |
| Idempotency and the idempotent consumer | `delivery-semantics.md` |
| Outbox pattern | `delivery-semantics.md` |
| Consumer groups, partitions, ordering | `messaging.md` |
| Dead-letter queues | `messaging.md` |
| Backpressure | `messaging.md`, `fault-tolerance.md` |
| Saga, choreography vs orchestration | `event-architecture.md` |
| Event sourcing and CQRS | `event-architecture.md` |

## Reliability

| Concept | Where |
|---|---|
| Retry with exponential backoff **and jitter** | `fault-tolerance.md` |
| Circuit breaker | `fault-tolerance.md` |
| Bulkhead | `fault-tolerance.md` |
| Graceful degradation | `fault-tolerance.md` |
| Cascading failure and retry storms | `failure-patterns.md` |
| Thundering herd | `failure-patterns.md`, `caching.md` |
| Horizontal vs vertical scaling | `scaling.md` |
| Stateless services | `scaling.md` |
| RPO and RTO | `disaster-recovery.md` |

## Operation

| Concept | Where |
|---|---|
| Golden signals: latency, traffic, errors, saturation | `observability.md` |
| p99 and tail latency | `observability.md` |
| SLI, SLO, error budget | `observability.md` |
| Distributed tracing and correlation IDs | `observability.md` |
| Blue-green, canary, rolling, feature flags | `delivery-pipeline.md` |
| Liveness vs readiness | `containers-kubernetes.md` |
| Desired state and reconciliation | `containers-kubernetes.md` |
| Race conditions, deadlocks, thread pools | `concurrency-runtime.md` |
| Least privilege, mTLS, secrets management | `security-identity.md` |

## The four questions a design review should always ask

1. **What happens when this dependency is slow rather than down?** Slow is worse than down,
   because down fails fast and slow consumes your threads. The answer must name a timeout.
2. **What happens when this is retried?** If the answer is not "nothing", the operation needs
   an idempotency key.
3. **What is the one machine, table, key, or person this depends on?** That is the single
   point of failure, and naming it is most of the work.
4. **How would we know?** If the answer is "a user tells us", there is no observability, only
   dashboards.

## Learning order, if you are starting

Networking and timeouts, then indexes and transactions, then retries and idempotency, then
caching, then replication and consensus, then Kubernetes. Each one assumes the last. Reversing
that order — starting from the platform — produces someone who can configure a cluster and
cannot explain why a query is slow.
