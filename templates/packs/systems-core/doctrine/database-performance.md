---
title: Indexes, transactions, and the queries that get slower with success
residency: index
tags: [database, indexing, sql, transactions, isolation, query-performance]
when:
  - a query got slower as the table grew
  - a list page issues one query per row
  - the database runs out of connections under load
  - two transactions produce a result neither would alone
  - a schema change must ship without downtime
  - reads must scale beyond one machine
  - a single row or partition takes a disproportionate share of writes
  - a deadlock or lock timeout appeared in the logs
---

# Indexes, transactions, and the queries that get slower with success

Most database pain is one of four things: a missing index, N+1 queries, connection
exhaustion, or an isolation level nobody chose. All four are cheap to fix and expensive to
discover in production.

**Before optimising anything, read the execution plan.** A guess about why a query is slow is
wrong often enough that the habit of guessing is itself the problem. Every engine has a way to
show the plan; the two things to look for are a sequential scan on a large table, and a row
estimate that differs from reality by an order of magnitude (which means the statistics are
stale).

## Indexes

| Index | Reach for it when | Cost |
|---|---|---|
| **B-tree / B+ tree** | equality *and* range, ordering, the default for almost everything | ~10% write overhead per index; storage |
| **Hash** | exact equality only, very high cardinality | no ranges, no ordering, no prefix matching |
| **Composite** | a query filters on several columns together | column order decides usability — see below |
| **Covering** | the index alone can answer the query, no table lookup | a wider index, more write cost and more memory |
| **Partial** | only a subset of rows is ever queried (`WHERE deleted_at IS NULL`) | brittle if the predicate drifts from the query |
| **Full-text / GIN** | text search, containment, array and JSON membership | expensive to build and to keep updated |

**Composite index column order is the thing people get wrong.** An index on `(a, b, c)` serves
queries filtering on `a`, on `a, b`, and on `a, b, c`. It does *not* serve a query filtering
on `b` alone. Put the equality columns first and the range column last: `(tenant_id,
status, created_at)` works for a tenant's pending rows in date order; `(created_at,
tenant_id, status)` does not.

**Every index is a tax on every write.** Ten indexes means ten structures updated per insert.
Find and delete unused indexes — every engine can report index usage counts, and the number of
indexes that have never been read in production is routinely a third of them.

**Signal that an index is missing**: a query whose cost grows with table size while its result
set does not. That is a scan.

## N+1 queries

**Signal** — one query returns N rows, then N more queries fetch something for each row. It is
invisible at 10 rows in development and fatal at 10,000 in production. ORMs produce this by
default through lazy loading.

**Fixes** — a `JOIN`, or a second query with `WHERE id IN (...)` and an in-memory join, or the
ORM's explicit eager-load. The batched second query is usually the best of the three: it keeps
the queries simple and it is one round trip, not N.

**This is the highest-value thing to look for in any slow endpoint**, and the easiest to spot:
count the queries per request. If the count varies with the size of the result, you have found
it.

## Connections

A database connection is expensive — memory on the server, a process or thread, a handshake.
Servers allow hundreds, not thousands.

**Pool, and bound the pool.** The arithmetic that catches people: 20 application replicas × a
pool of 50 = 1,000 connections against a server permitting 200. The pool must be sized against
the *cluster* total, not per process.

**Reach for an external pooler** (PgBouncer and its equivalents) when the number of clients is
large or elastic — serverless functions are the extreme case, where every invocation wants its
own connection.

**Fails as** — connection exhaustion, which presents as latency and timeouts rather than as a
database error, because callers are queued waiting for a connection that never comes.

## Transactions and isolation

ACID is four promises: **A**tomicity (all or nothing), **C**onsistency (constraints hold),
**I**solation (concurrent transactions do not corrupt each other), **D**urability (committed
means committed).

Isolation is the one with a dial, and the default is rarely what people assume:

| Level | Prevents | Still allows |
|---|---|---|
| **Read uncommitted** | nothing much | dirty reads |
| **Read committed** | dirty reads | non-repeatable reads, phantoms |
| **Repeatable read / snapshot** | non-repeatable reads | phantoms (in some engines), write skew |
| **Serializable** | everything | nothing — but transactions may abort and must be retried |

**Read committed is the default in most engines, and it does not prevent write skew.** Two
transactions each read a total, each decide their write is fine, and together they break an
invariant neither would break alone — the classic "both on-call engineers went off duty".

**Reach for serializable when** correctness depends on a rule spanning rows that you cannot
express as a constraint. **Cost**: aborts under contention, so every transaction needs retry
logic. That cost is real but it is bounded, and it is much smaller than the cost of finding
write skew in production.

**MVCC** — most engines give readers a consistent snapshot instead of blocking them, so readers
do not block writers and writers do not block readers. The price is that old row versions
accumulate and must be cleaned up (`VACUUM` and its equivalents). A long-running transaction
holds back that cleanup for the entire database, which shows up as unexplained table bloat and
slow scans.

## Locking

- **Optimistic** — read a version, write with `WHERE version = ?`, retry on zero rows updated.
  Reach for it when conflicts are rare. Costs nothing when there is no conflict.
- **Pessimistic** — `SELECT ... FOR UPDATE`. Reach for it when conflicts are common or a retry
  is expensive. Costs concurrency, and introduces deadlocks.

**Deadlock prevention is one rule**: always acquire locks in the same order everywhere. Most
deadlocks are two code paths that lock A then B, and B then A.

## Write-ahead logging and durability

Every durable engine writes the change to a log *before* the data pages — that is what makes a
crash recoverable, and it is also the mechanism behind replication and point-in-time recovery.

Two consequences worth knowing:
- **A checkpoint is an I/O spike.** Periodic latency bumps that correlate with nothing in your
  code are often checkpoints.
- **Write amplification** — one logical row write becomes a log write, a page write, and an
  index write per index. This is why "just add an index" is not free, and why write-heavy
  tables should carry the fewest indexes you can live with.

## Scaling reads and writes

**Read replicas** scale reads and nothing else. Reach for them when reads dominate.
**Cost**: replication lag, so a read straight after a write may not see it. Fix by routing
read-your-own-writes traffic to the primary, or by carrying a version the replica must have
caught up to. See read-your-writes in `distributed-data.md`.

**Partitioning** splits one table within one database — by range, by list, by hash. Reach for
it when a table is too large to maintain (index rebuilds, vacuums, deletes of old data). It is
much cheaper than sharding and solves most of what people reach for sharding to solve.

**Sharding** splits data across databases. **This is the last resort**, and it should be
argued for with numbers. It costs you cross-shard joins, cross-shard transactions, a
rebalancing story, and a shard key you can never change. Try first: an index, a read replica,
partitioning, a cache, archiving old rows. See `distributed-data.md` for the choice of shard
key, which is the decision that determines whether the whole thing works.

**Hot partition and hot row** — the failure mode of every partitioning scheme. A shard key with
low cardinality or skewed traffic (`country`, `tenant_id` with one enormous tenant, a
monotonically increasing timestamp) puts all the load on one shard. Signal: one node at 100%
while the rest idle. There is no tuning fix; the key was wrong.

## Migrations

**A schema change ships in more than one step, or it ships with downtime.** The expand /
migrate / contract sequence:

1. **Expand** — add the new column, nullable, with a default that does not rewrite the table.
2. **Migrate** — dual-write both old and new; backfill in batches; read from the new one behind
   a flag.
3. **Contract** — stop writing the old one; drop it, later, in its own deploy.

**Every step must be safe with both the old and the new application version running**, because
during a rolling deploy both are. A migration that requires the new code is a migration that
breaks the deploy it ships with.

**Batch every backfill.** A single `UPDATE` over ten million rows holds locks, bloats the log,
and blocks replication. Loop in batches with a pause.
