---
title: Incidents, load testing, and the debt you decided to keep
residency: index
tags: [incidents, postmortem, on-call, load-testing, runbooks, technical-debt, cost]
when:
  - something is broken in production right now
  - an incident is over and the cause must be recorded
  - a system must be proven to handle an expected load
  - the same failure has happened more than once
  - an on-call rotation is being set up or is burning people out
  - a cost or performance regression needs attributing
  - a shortcut is being taken deliberately and should be recorded
---

# Incidents, load testing, and the debt you decided to keep

## During an incident

**Mitigate first. Diagnose second.** The instinct to understand before acting is correct in
development and wrong in an incident. If a rollback would probably fix it, roll back — the
cause can be found from the artefact afterwards, and every minute spent understanding is a
minute of impact.

**Ordered by likelihood, the first question is always: what changed?** A deploy, a config push,
a feature flag, a certificate, a dependency's own deploy, a traffic pattern. Most incidents have
a change behind them, and the change log is faster to read than the code.

**Roles, even for a small incident.** One person **commands** (decides, delegates, and does not
debug), one **communicates** (status updates, so the commander is not interrupted), and others
investigate. Without this, five people debug the same theory and nobody has told anyone.

**One timeline, written as you go**, in the shared channel: what was observed, what was changed,
at what time. It is the postmortem's raw material, and reconstructing it afterwards from memory
is both slow and wrong.

**Change one thing at a time, and say so.** Three simultaneous fixes mean you never learn which
worked, and one of them may be doing harm.

**Declare it early.** Escalating an incident that turns out to be minor costs an apology.
Escalating late costs an hour of impact. The asymmetry is not close.

## Runbooks

**A runbook is a procedure, not an explanation.** It exists to be executed at 3am by someone who
did not build the system: the exact commands, the exact dashboard links, the decision points,
and when to escalate and to whom.

**Every alert links to one.** An alert with no runbook is a puzzle delivered at 3am.

**A runbook that has not been executed is fiction.** Game days are how you find that the command
has changed, the dashboard was deleted, and nobody on call has the permission it requires. See
`disaster-recovery.md`.

## Postmortems

**Blameless, and mean it.** The purpose is to change the system, and any process that produces a
person's name as its answer stops receiving accurate information immediately. "The engineer
should have been more careful" is not an action item; "the deploy tool allowed a change with no
review" is.

**Every incident that reached a user gets one**, and so does every near miss — the near miss is
the cheapest data you will ever get.

What it must contain:
- **Impact, quantified**: what, how many, how long. Not "some users were affected".
- **Timeline**: first occurrence, detection, mitigation, resolution. The gap between the first
  two is your detection debt, and it is usually the largest one.
- **Contributing factors**, plural. Single root causes are almost always a simplification;
  systems fail when several defences are absent at once.
- **What went well.** Including this is not politeness — it tells you which defences to keep
  investing in.
- **Action items with an owner and a date.** Anything else is a wish.

**The question that produces the best action items** is not "why did it break" but **"why did it
take so long to notice, and so long to fix?"** Prevention is one defence; detection and recovery
are the other two, and they generalise to failures you have not imagined yet.

**Track completion.** A postmortem whose actions are never done has converted an outage into
paperwork. If the same incident recurs, the first thing to read is the previous postmortem's
action list.

## On-call

**On-call is a load-bearing part of the system and it must be sustainable**, or the people who
understand production will leave.

- **Enough people that the rotation is not punishing.** Six or more is a common floor.
- **Compensated**, in money or in time.
- **A page must be actionable, urgent, and real.** See `observability.md`. Track pages per shift
  as a metric and treat a rising number as an incident in its own right.
- **The people who build it are on call for it.** This is the mechanism that makes reliability a
  design concern rather than someone else's problem.
- **A handover at the end of every shift**, so an in-progress problem does not restart from
  zero.

## Load testing

**A system's capacity is unknown until measured**, and estimates are consistently optimistic.

Four kinds, and they answer different questions:

- **Load test** — expected traffic. Does it meet its latency target?
- **Stress test** — increase until it breaks. **This is the valuable one**: it finds the actual
  ceiling and, more importantly, *how* it fails. Does it shed gracefully, or collapse? Does it
  recover when load is removed, or is it metastable? See `failure-patterns.md`.
- **Soak test** — normal load for hours or days. This is what finds leaks, unbounded growth, and
  connection exhaustion, none of which appear in a ten-minute run.
- **Spike test** — sudden step change. Tests autoscaling response time and cold starts.

**Test with realistic data and realistic distributions.** A uniform key distribution has a 100%
cache hit rate and no hot partitions, so it tests a system you do not have.

**Test the whole path**, including the database, the caches, and the third parties (or realistic
stubs of them). A load test against a mocked backend measures your mock.

**Record the numbers, and rerun on a schedule.** A capacity figure with no date attached is
folklore within two quarters.

## Cost

**Cost is a performance metric.** It responds to the same techniques as latency, and it is
usually the more visible one to the business.

- **Attribute it.** Tag everything by service and team. Unattributed cost is nobody's to reduce.
- **The distribution is skewed.** A small number of things — data transfer between zones, one
  chatty query, an over-provisioned cluster, log volume, high-cardinality metrics — are usually
  the majority of the bill. Measure before optimising, exactly as with latency.
- **Alert on the derivative.** A monthly bill discovers a runaway cost thirty days late; a
  daily-spend anomaly alert discovers it the next morning.
- **Reducing cost is usually reducing waste**, not reducing capability: unused resources, wrong
  instance types, missing lifecycle rules on storage, retention nobody chose, and telemetry
  cardinality nobody bounded.

## Technical debt

**Debt taken deliberately, recorded, with a repayment trigger, is a legitimate engineering
tool.** Debt taken accidentally and never written down is just decay.

The distinction that makes this usable:

- **Deliberate and prudent** — "we ship the simple version to hit the date; here is what we will
  need when volume triples." Record it, and record the *trigger*, not a date: "when writes
  exceed X per second". A date gets postponed; a trigger fires.
- **Accidental** — you learned something after the fact. Fine, and normal. Record it when found.
- **Reckless** — skipping something you knew you needed. Not a trade, and worth naming as such.

**A shortcut with a written trigger is a decision. The same shortcut undocumented is a trap for
whoever arrives next**, and this repository's entire premise is that the difference between the
two is whether anyone wrote it down.
