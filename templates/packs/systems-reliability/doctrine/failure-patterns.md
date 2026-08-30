---
title: Named failure patterns — how a small problem becomes an outage
residency: index
tags: [failures, outage, cascading-failure, incidents, resilience]
when:
  - a small failure became a total outage and the path is unclear
  - load spiked at the moment a dependency recovered
  - the system did not recover after the original cause was fixed
  - one component being down made unrelated components fail
  - a failure appeared only after something was restarted
  - a postmortem needs the failure named before it can be prevented
  - reviewing a design for the ways it could fall over
---

# Named failure patterns — how a small problem becomes an outage

Most outages are not caused by the thing that failed. They are caused by how the system reacted
to the thing that failed. These patterns are worth knowing by name, because naming one during
an incident collapses an hour of debate into a decision.

## Cascading failure

**Shape** — one component slows or fails; its callers pile up waiting; their callers pile up
waiting on them; the failure propagates *upward* through the dependency graph until everything
is down.

**Why it spreads**: a caller blocked on a slow dependency holds a thread and a connection. Once
all threads are held, the caller is down — and it was healthy a second ago.

**Prevention** is entirely in `fault-tolerance.md`: timeouts (so waiting is bounded), bulkheads
(so one dependency cannot take every thread), circuit breakers (so a dead dependency stops
being called), and load shedding (so overload is rejected rather than queued).

**During**: shed load aggressively. A system at 100% capacity serving 60% of requests is
recoverable; a system at 300% serving 0% is not.

## Retry storm

**Shape** — a dependency slows. Clients retry. Retries triple the load on something already
struggling. It fails completely. Now every request retries.

**The arithmetic**: three attempts per call means a struggling service receives 4× normal
traffic exactly when it can serve less than normal. With retries at four layers of the stack,
it is 81×.

**Prevention** — retry budgets, jitter, one retrying layer, and circuit breakers. See
`fault-tolerance.md`.

**Signal in the data**: request rate to a dependency rising while its success rate falls. That
divergence is the storm, and it is visible before the outage completes.

## Thundering herd

**Shape** — many clients act simultaneously because something synchronised them.

Four common synchronisers:
- A popular cache key expires → every request misses at once. See `caching.md`.
- A dependency recovers → every waiting client retries at the same instant.
- A cron runs at `:00` on every host.
- A deploy restarts everything → all connections re-established, all caches cold, together.

**Prevention** — jitter everywhere: TTLs, retry delays, cron schedules, health check intervals.
Plus request coalescing so one fill serves all waiting readers.

**Fixed TTLs on a batch import are a scheduled herd.** Ten thousand keys written together
expire together, once, at exactly the same second.

## Metastable failure

**Shape** — the original cause is fixed and the system stays down. Load is normal, the
dependency is healthy, and it still will not recover.

**Why**: the system has entered a state that sustains itself. The retry backlog generates
enough load to keep it overloaded; every recovery attempt is immediately consumed by the
backlog. This is the failure that most confuses people during an incident, because everything
that "caused" it is demonstrably fine.

**The only exit is to reduce load below the sustaining threshold**: shed aggressively, drain
queues, disable retries, or take traffic away entirely and reintroduce it gradually. Restarting
without shedding re-enters the same state within seconds.

**Design defence**: bounded queues, retry budgets, and a load-shedding switch you can reach
during an incident without a deploy.

## Split brain

**Shape** — a network partition leaves two nodes each believing it is the leader, both
accepting writes. Data diverges silently.

**Prevention** — quorum (a majority cannot exist on both sides of a partition), and **fencing
tokens** so the storage layer itself rejects writes from a superseded leader. See
`distributed-data.md`. A lease alone is insufficient: a process paused past its lease expiry
wakes up believing it still holds it.

**Detection** — alert on more than one node claiming leadership. It is a cheap check and almost
nobody has it.

## Partial failure

**Shape** — the call neither succeeded nor failed. It timed out. The work may or may not have
happened, and there is no way to find out from here.

This is the defining condition of distributed systems, not an edge case, and it is why
idempotency is a design requirement rather than a nicety. See `delivery-semantics.md`.

**The design question**, for every remote call: *if this times out, what do we do?* If the
answer is "retry", the operation must be idempotent. If it is "assume it failed", you will
eventually double-charge someone.

## Single point of failure

**Shape** — one component whose loss takes everything with it.

Look for the ones that are not on the architecture diagram: the primary database, yes — but
also the config service every pod reads at startup, the shared secret store, the CI system that
must run for a rollback, the one person who can approve a production change, the certificate
that expires, the DNS zone, the single NAT gateway.

**The test**: for each component, ask "what happens if this is gone for an hour?" Any answer of
"everything stops" is an SPOF, and either it gets redundancy or the risk gets accepted in
writing.

## Correlated failure

**Shape** — the redundancy was not redundant. Three replicas on one host, or in one availability
zone, or all pulling the same poisoned config, or all running the same expiring certificate.

**Redundancy only helps against failures that are independent.** A config push, a bad deploy,
a certificate expiry, and a leap-second bug are perfectly correlated across every replica — and
they are among the most common causes of total outages.

**Defence**: spread across failure domains (host, zone, region), stagger deploys and config
pushes, and treat "roll out everywhere at once" as the risk it is. See cell-based architecture
in `scaling.md`.

## Poison message

**Shape** — one message fails forever and blocks the partition behind it. Throughput goes to
zero for reasons that have nothing to do with load.

**Prevention** — bounded retries, then a dead-letter queue, and an alert on DLQ depth. See
`messaging.md`.

## Slow leak

**Shape** — memory, file descriptors, connections, or disk grows slowly until something dies,
days or weeks after the deploy that caused it.

**Signal** — a sawtooth in a resource graph, with restarts as the teeth. If a service is
"healthy because it restarts nightly", it has a leak and the restart is hiding it.

**Prevention** — alert on the *trend*, not the threshold. By the time memory crosses 90% the
outage is minutes away; a steady upward slope across a week is visible long before.

## Clock-related failure

**Shape** — certificate expiry, a leap second, an NTP step backwards, a token whose validity was
computed against a drifted clock, a timestamp-ordered write silently lost.

**Certificate expiry deserves its own alert** at 30 days, not 1. It is one of the few outages
that is perfectly predictable and still happens constantly.

## Using this file in a review

Read the list and ask, for the design in front of you: which of these is possible, and what
stops it? An honest answer of "nothing stops it, and we accept the risk" is a fine outcome —
written down. An unexamined one is how each of these gets its next postmortem.
