---
title: Knowing what production is doing — signals, percentiles, and error budgets
residency: index
tags: [observability, monitoring, tracing, metrics, slo, alerting, latency]
when:
  - a problem was reported by a user before any alert fired
  - a request is slow and it is unclear which service is responsible
  - an alert fires often and nobody acts on it
  - an availability or latency target must be agreed
  - averages look fine and users are complaining
  - deciding what to log, measure, or trace for a new service
  - a dashboard exists but no question can be answered from it
---

# Knowing what production is doing — signals, percentiles, and error budgets

**Monitoring answers questions you knew to ask. Observability answers questions you did not.**
The practical difference is dimensionality: a dashboard of pre-aggregated counters cannot tell
you that the errors are all from one customer, on one API version, in one region — unless
someone predicted that question and built the chart.

## The three signals, and what each is for

- **Metrics** — cheap, aggregated, retained long. Reach for them for alerting and trends. They
  cannot tell you about a *specific* request.
- **Logs** — expensive, detailed, one event at a time. Reach for them for the specific case.
- **Traces** — the path of one request across services, with timing per hop. Reach for them for
  "where did the time go" in a distributed call.

**They must share identifiers or you have three disconnected tools.** One `trace_id` on every
log line, every span, and every exemplar is what turns "the p99 got worse" into "here are three
requests that were slow, and here is the hop that caused it". This is the single
highest-leverage thing in this file, and it is mostly a discipline about propagating one header.

**OpenTelemetry** is the vendor-neutral way to emit all three. Instrument once; choose a backend
later, and change it without reinstrumenting.

## Structured logs, or no logs

**Log objects, not sentences.** A line of prose requires a regular expression to query; a
structured event is filterable by field. Every event carries at minimum: timestamp, level,
service, `trace_id`, and the domain identifiers involved.

- **Log at the boundaries** — a request in, a request out, an error, a state transition. Logging
  inside loops is how a service spends more on telemetry than on work.
- **Sample high-volume success, keep all errors.** 1% of successful requests and 100% of
  failures is a sound default.
- **No secrets, no personal data.** Logs are widely readable and long-lived; see
  `security-identity.md`.
- **One event per unit of work, wide, rather than five narrow ones.** A single event with forty
  fields answers far more questions than five events with four fields, and costs less.

## The golden signals

For any service, four numbers cover most of what matters:

1. **Latency** — and measure successful and failed requests *separately*. A fast 500 flatters
   your latency graph, which is exactly backwards.
2. **Traffic** — requests per second, so a change in the others has a denominator.
3. **Errors** — rate, not count. A count is meaningless without traffic.
4. **Saturation** — how full the constrained resource is. Usually the hardest to identify and
   the most predictive: queue depth, connection pool utilisation, consumer lag, thread pool
   occupancy.

**Saturation is the leading indicator.** Latency and errors tell you it is already happening.

## Percentiles, and why averages lie

**Never alert on an average latency.** An average of 200 ms is consistent with everyone
experiencing 200 ms, and with 95% of users at 50 ms while 5% wait 3 seconds. Only the second is
an outage, and the average cannot distinguish them.

Use p50 (typical), p95, p99, and p99.9 (the worst experience you tolerate).

**Tail latency compounds across a fan-out.** If one service has a p99 of 1 second, a request
that calls it 100 times in parallel has a roughly 63% chance of containing at least one
1-second call. **The p99 of a dependency becomes close to the median of a wide fan-out.** This
is the arithmetic reason tail latency matters far more than it seems.

**Percentiles do not average and do not add.** The p99 of two services is not the p99 of the
pair. Aggregate from histograms, not from pre-computed percentiles per instance — a common and
silently wrong practice.

## SLI, SLO, error budget

- **SLI** — the measurement. "Proportion of requests served in under 300 ms."
- **SLO** — the target. "99.5% over 30 days."
- **Error budget** — what the target permits. 99.5% allows 0.5%: about 3.6 hours a month.

**The error budget is the point of the whole construction.** It converts reliability from an
argument into a number that two parties can both read. Budget remaining: ship. Budget spent:
stop shipping features and fix reliability. That rule is what makes the SLO real rather than
aspirational.

**Set the SLO from what users need, not from what the system does.** An SLO copied from current
performance can never be violated and therefore signals nothing. And **100% is not a target** —
it forbids all change and prices out at absurd cost. See the availability arithmetic in
`disaster-recovery.md`.

**Measure at the point closest to the user you can reach.** Server-side success does not include
the failures where the response never arrived.

## Alerting

**Alert on symptoms, not causes.** "The error rate exceeded the budget burn rate" is a symptom
and it wakes someone for a real reason. "CPU is above 80%" is a cause that is frequently fine
and frequently absent when things are broken.

**Every page must be actionable, urgent, and real.** If any of the three fails, it is not a page
— it is a ticket or a dashboard. **Alert fatigue is a failure mode, not a personality trait**:
a person paged five times a night for non-issues will miss the sixth, and that one will be real.

**Burn-rate alerting** is the mature form: alert when the error budget is being consumed fast
enough to exhaust it before the window ends. A fast burn pages; a slow burn opens a ticket. It
removes the arbitrary threshold entirely.

**A runbook link in the alert.** An alert with no runbook is a puzzle handed to someone at 3am.

## Cardinality

**Metric cardinality is the cost that surprises people.** A label with a user ID, a URL with an
ID in it, or a request ID multiplies your time series by the number of distinct values, and
metric systems price per series. This is how a monitoring bill exceeds a compute bill.

High-cardinality identifiers belong on **logs and traces**, which are indexed for it. Metrics
carry low-cardinality dimensions: service, endpoint *template*, status class, region.

## Making a service observable, as a checklist

- A `trace_id` generated at the edge and propagated on every hop and every log line.
- Golden signals for the service, and for each dependency it calls.
- Saturation of every bounded resource: pools, queues, workers.
- A structured event at each boundary, with the domain identifiers on it.
- Latency histograms, not averages, and successes separated from failures.
- One SLO with an error budget, and burn-rate alerts on it.
- A runbook per alert.

## The test that matters

Take a real incident from the past and ask: **with what exists today, how long until we could
name the cause?** If the answer involves adding logging and waiting for it to happen again,
observability is a plan and not a capability.
