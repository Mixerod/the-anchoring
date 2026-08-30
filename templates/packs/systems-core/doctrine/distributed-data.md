---
title: Consistency, consensus, and what a network partition forces you to choose
residency: index
tags: [distributed-systems, consistency, consensus, replication, sharding, cap]
when:
  - data must live on more than one machine
  - two nodes both believe they are the leader
  - a read after a write returned the old value
  - a cluster must agree on one value or one leader
  - a shard key is being chosen
  - two replicas accepted conflicting writes
  - a lock must be held across processes or machines
  - events from different machines must be ordered
---

# Consistency, consensus, and what a network partition forces you to choose

Once data lives on two machines, three things become possible that were impossible before:
the machines can disagree, the network between them can fail while both stay alive, and their
clocks can lie. Every technique here exists to handle one of those.

## CAP, stated usefully

The common phrasing ("pick two of consistency, availability, partition tolerance") is
misleading, because you do not get to pick partition tolerance — partitions happen whether or
not you chose them. The real statement is narrower and more useful:

> **When a partition occurs, you must choose: refuse to answer (stay consistent), or answer
> possibly-stale data (stay available).** There is no third option, and the choice can be made
> per-operation.

So the design question is never "are we CP or AP". It is: *for this specific operation, is a
wrong answer worse than no answer?* Taking payment: yes, refuse. Showing a follower count:
no, serve stale.

**PACELC** adds the half people forget: **else** — when there is no partition, you are still
trading **l**atency against **c**onsistency. Synchronous replication to another region costs a
round trip on every write, partition or not.

## The consistency models you will actually meet

- **Strong / linearizable** — every read sees the latest committed write, as if there were one
  copy. Costs a coordination round trip per operation. Reach for it for money, inventory,
  uniqueness, and locks.
- **Eventual** — replicas converge if writes stop. Cheapest and weakest. Fine for counts,
  feeds, and caches; never for anything a user will act on immediately.
- **Read-your-writes** — a user always sees their own writes, though not necessarily others'.
  **This is the one most applications actually need**, and it is much cheaper than strong
  consistency: route that user's reads to the primary for a few seconds, or carry a version
  token the replica must have reached.
- **Causal** — if A caused B, nobody sees B without A. The right model for comments, replies,
  and anything with a "because" between two events.
- **Monotonic reads** — a user never sees time go backwards. Broken by round-robining reads
  across replicas with different lag; fixed by pinning a session to a replica.

**Signal you need a stronger model**: a bug report of the shape "I saved it and it was still
the old value", or "the reply appeared before the comment".

## Replication topologies

| Topology | Reach for it when | Cost |
|---|---|---|
| **Single leader** | the default; one writer, many readers | the leader is a write bottleneck and a failover event |
| **Multi-leader** | writes must be accepted in several regions or offline | write conflicts are now *your* problem to resolve |
| **Leaderless (quorum)** | availability matters more than simplicity | tuning R and W, and read repair |

**Quorum arithmetic**: with N replicas, if the write quorum W and read quorum R satisfy
**R + W > N**, a read set and a write set always overlap, so a read sees the latest write.
N=3, W=2, R=2 is the standard choice: it survives one node down for both reads and writes.

W=N gives strong writes and no write availability under any failure. R=1, W=1 is fast and
guarantees nothing.

## Conflict resolution

When two replicas accept conflicting writes, something has to decide. In order of increasing
honesty:

- **Last write wins** — pick by timestamp. Silently discards data, and depends on clocks that
  disagree. Acceptable only when losing a write is genuinely acceptable.
- **Version vectors** — detect that two writes are concurrent rather than ordered, and hand
  both to the application. More work; no silent loss.
- **CRDTs** — data types that merge deterministically (counters, sets, ordered text). Reach for
  them when concurrent editing is the product. Cost: limited to what the type can express.
- **Application-level merge** — ask the user, or apply a domain rule. Often the only correct
  answer.

## Time and ordering

**Wall clocks do not order distributed events.** Clocks drift, NTP steps backwards, and
virtual machines pause. A rule of "latest timestamp wins" loses writes for reasons no log will
explain.

- **Lamport clocks** — a counter per node, taking the max on receive. Gives a total order
  consistent with causality. Cannot tell you whether two events were truly concurrent.
- **Vector clocks** — a counter per node, per node. Can distinguish "happened before" from
  "concurrent", which is exactly what conflict detection needs. Cost: size grows with the
  number of nodes.

Use a **monotonic** clock for measuring durations, always. `now() - start` with a wall clock
can be negative.

## Consensus

**Reach for consensus when** a set of machines must agree on one value even though some of
them may fail — leader election, cluster membership, configuration, distributed locks.

- **Raft** — understandable by design, and the reason most modern systems use it (etcd, and so
  Kubernetes, sits on it). Leader-based: one leader, a log replicated to followers, a term
  number per election.
- **Paxos** — the original, correct, and famously hard to implement. Multi-Paxos underlies
  several older systems.
- **Gossip** — *not* consensus. Epidemic propagation of state, eventually consistent, no
  agreement. Reach for it for membership and failure detection at large scale, where consensus
  would be too expensive.

**The rule with consensus is: do not implement it.** Use a system that already has (etcd,
ZooKeeper, Consul, your database). A hand-rolled election is one of the most reliable ways to
produce split brain.

**Quorum means a majority.** With 3 nodes you survive 1 failure; with 5 you survive 2. Even
numbers buy nothing: 4 nodes tolerate the same single failure as 3, and cost more.

## Split brain and fencing

**Split brain** — a partition leaves two nodes each believing it is the leader, and both accept
writes. This is the most damaging distributed failure because it is silent and it corrupts.

**A lease is not sufficient on its own.** A leader can be paused (garbage collection, a
hypervisor stall) past its lease expiry, wake up believing it still holds it, and write.

**Fencing tokens are the fix.** The lock service issues a monotonically increasing number with
every grant; the *storage* rejects any write carrying a token lower than the highest it has
seen. The stalled old leader's write is refused by the resource itself, which is the only place
that can be sure.

**Any distributed lock without a fencing token is advisory**, whatever its documentation says.
That includes the common Redis lock recipes.

## Distributed transactions

**Try first: do not have one.** Most demand for a distributed transaction is really a demand
for two things to eventually agree, which a saga or an outbox handles at a fraction of the
cost. See `event-architecture.md` and `delivery-semantics.md` in `systems-async`.

- **Two-phase commit (2PC)** — a coordinator asks everyone to prepare, then to commit. Correct,
  and **blocking**: if the coordinator dies after prepare, every participant holds its locks
  until the coordinator returns. Reach for it only inside one trusted datacentre with a
  highly-available coordinator.
- **Three-phase commit** — removes the block in theory, does not survive network partitions in
  practice. Rarely worth it.
- **Saga** — a sequence of local transactions with compensating actions. Not atomic; the
  intermediate states are visible. This is what most systems should use, and it is in
  `event-architecture.md`.

## Sharding, and the key that decides everything

The shard key is the least reversible decision in the system. Choose it against three
criteria, in order:

1. **Cardinality** — many more distinct values than shards.
2. **Even distribution of traffic**, not just of rows. A tenant ID where one tenant is 40% of
   the load is an even row distribution and a catastrophic traffic distribution.
3. **Query alignment** — the queries you run most must be answerable within one shard. If every
   read is a scatter-gather across all shards, sharding made things worse.

**Never shard on a monotonically increasing value** (a timestamp, an auto-increment ID). All
new writes go to the newest shard, which is a hot partition by construction.

Use **consistent hashing** for placement, so adding a shard moves a fraction of the keys rather
than all of them — see `traffic-management.md`.

**Plan the rebalance before the first shard.** "How do we add shard 5?" answered after the fact
is a migration measured in months.
