---
title: Backups, failover, and how much data you have decided to lose
residency: index
tags: [disaster-recovery, backups, failover, multi-region, chaos-engineering, availability]
when:
  - a backup strategy is being designed or reviewed
  - the system must survive the loss of a region or availability zone
  - deciding between active-active and active-passive
  - data was deleted or corrupted and must be recovered
  - an availability target has been promised to someone
  - a failover has never been tested
  - the cost of high availability needs justifying
---

# Backups, failover, and how much data you have decided to lose

Two numbers define every disaster recovery plan, and if they have not been written down then
the plan is a hope:

- **RPO — recovery point objective**: how much data you are willing to lose, in time. Hourly
  backups mean an RPO of one hour, which means "we accept losing up to an hour of writes".
- **RTO — recovery time objective**: how long you are willing to be down.

Everything else is a consequence. An RPO of zero requires synchronous replication and its
latency cost. An RTO of minutes requires standby capacity that is already running and already
paid for. **Ask for these two numbers first**; most of the architecture follows from them, and
most disagreements about architecture are really disagreements about them.

## Backups

**A backup you have not restored is not a backup.** It is a file you are paying to store, whose
usefulness is unverified. This is the single most common failure in this area — the tape is
readable, the dump is corrupt, the restore needs a credential nobody has, the procedure takes
eleven hours nobody had measured.

**Restore testing is the practice**, and it must be scheduled and timed:
- Restore to a scratch environment on a schedule, automatically.
- **Measure the restore duration** — that number *is* your RTO, whatever the document says.
- Verify the restored data, not just that the process exited zero.

**The 3-2-1 rule** remains a good default: three copies, two media or systems, one off-site.
The modern gloss: one of them must be **immutable and separately credentialed**, because
ransomware and a compromised credential both delete backups reachable from the compromised
account. A backup in the same account with the same permissions as production is not a backup
from a security standpoint.

**Backups are not the same as replication.** A replica faithfully replicates your `DELETE FROM
users` within milliseconds. Replication is for availability; backups are for mistakes. You need
both, and **point-in-time recovery** — restore to 14:32, just before the bad migration — is
usually the capability people actually want.

**Test the deletion path too.** Retention that never expires is a cost problem; retention that
expires too eagerly is a recovery problem.

## Redundancy levels, and what each survives

| Level | Survives | Costs |
|---|---|---|
| **Multi-instance** | one process or host | almost nothing — do it always |
| **Multi-AZ** | one datacentre: power, network, cooling | a little cross-zone latency and traffic charges |
| **Multi-region** | a region-wide outage, a regional legal event | a great deal: data replication across distance, and a consistency decision |

**Multi-AZ is the default and should not require an argument.** Multi-region is a significant
undertaking and should require one.

**Redundancy only helps against independent failures.** Three replicas that all read the same
bad config, or run the same expiring certificate, or receive the same deploy, fail together.
See correlated failure in `failure-patterns.md`.

## Active-active or active-passive

- **Active-passive** — the standby is idle or serving reads. Simpler; only one writer, so no
  conflict resolution. **Costs**: paying for idle capacity, and a failover that is rarely
  exercised and therefore rarely works.
- **Active-active** — both serve writes. No failover event at all, and capacity is used.
  **Costs**: multi-leader replication, which means write conflicts are now yours to resolve
  (see `distributed-data.md`), and the cross-region latency on any operation needing
  coordination.

**The honest middle ground** for most systems: active-active for stateless compute and reads,
single-writer for the data with a promoted standby. It gets most of the availability for a
fraction of the complexity.

**Failover has to be a practised procedure, not a documented one.** An untested failover fails
in a way nobody predicted, at the worst moment, under time pressure. If it has not been done in
the last quarter, assume it does not work.

**Automatic failover introduces split brain.** The promotion must be quorum-based and fenced,
or a partition gives you two primaries. See `distributed-data.md`.

## DNS is part of the failover path

Whatever the TTL says, some resolvers and some runtimes cache longer — sometimes for the life
of the process. If DNS is your failover mechanism, a low TTL is necessary and not sufficient.
Prefer an anycast address, a load balancer that fails over behind a stable name, or a client
that re-resolves. Measure the real propagation during a test, and let that number be your RTO
rather than the TTL.

## Failure scenarios worth walking through

Take each and answer: how do we detect it, what happens automatically, what must a human do,
and how long does the whole thing take?

- One instance dies — should be invisible.
- One availability zone is lost — capacity must exist elsewhere, and it must be *reserved*.
- The primary database fails — promotion, and what is the data loss window?
- A region is unreachable — is there a plan, and has it been run?
- A disk fills — every service, not just the database.
- A dependency you do not own is down for four hours.
- A certificate expires unnoticed.
- Someone deletes production data. Someone deletes it *and* the backups.
- The deploy pipeline is down and you need to roll back.

**That last one is the one people miss.** If a rollback requires CI, and CI is part of the
outage, the rollback plan does not exist. Keep a path to deploy a known-good artefact that does
not depend on the build system.

## Chaos engineering

**Reach for it when** the recovery mechanisms exist and are believed to work. Chaos
engineering's purpose is to convert belief into evidence.

**Not before.** Injecting failure into a system with no timeouts and no redundancy does not
teach you anything you did not know; it just causes an outage.

The discipline:
1. **State the hypothesis**: "killing one instance causes no user-visible errors."
2. **Start in a non-production environment**, then production with the smallest possible blast
   radius.
3. **Have a stop button**, and know it works before you start.
4. **Measure against the steady state**, not against a feeling.

**Game days** are the cheap version and often the higher-value one: gather the team, declare a
scenario, and have people execute the runbook against a real (or realistically simulated)
failure. Almost every game day discovers a runbook step that is wrong, a credential nobody has,
or a dashboard that does not exist. That is the point.

**Fault injection** at the request level — latency, errors, resource exhaustion — is the finest
grained tool and the one that most directly tests `fault-tolerance.md`: does the timeout fire,
does the breaker open, does the fallback appear?

## Availability arithmetic, so the target is honest

- 99.9% — 43 minutes of downtime per month.
- 99.99% — 4.3 minutes per month.
- 99.999% — 26 seconds per month.

**Dependencies multiply.** A service that depends on five components at 99.9% each cannot
exceed 99.5% on its own, before any of its own failures. Chained dependencies are the reason
"we need five nines" is usually an unpriced wish.

**Ask what the number is for.** Every nine costs roughly an order of magnitude more than the
last, and the honest question — asked in `observability.md` as the error budget — is what the
business actually loses per minute of downtime. Frequently the answer justifies 99.9% and
nothing more.
