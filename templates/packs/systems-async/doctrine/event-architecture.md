---
title: Sagas, event sourcing, and CQRS — three patterns and when each is a mistake
residency: index
tags: [saga, event-sourcing, cqrs, workflow, distributed-transactions, compensation]
when:
  - a business operation spans several services and must not half-complete
  - a step in a multi-service workflow failed and earlier steps must be undone
  - the history of how state reached its current value is itself required
  - reads and writes have very different shapes or very different load
  - a long-running process must survive restarts
  - an event schema must change without breaking existing consumers
  - an audit trail must be reconstructable
---

# Sagas, event sourcing, and CQRS — three patterns and when each is a mistake

These three are frequently adopted together, frequently for the wrong reason, and they are
independent. You can have a saga with no events stored, event sourcing with no CQRS, and CQRS
with an ordinary CRUD write model. Adopt them one at a time, each for its own reason.

## Saga

**Reach for it when** one business operation spans several services or several transactions and
must not be left half-done — order → payment → inventory → shipping.

A saga is a sequence of local transactions, each with a **compensating action** that
semantically undoes it. There is no rollback: the payment was captured, and the compensation is
a refund, which is a new fact rather than an erasure.

**Cost, stated plainly**: a saga is not atomic. Intermediate states are visible to everyone.
For a period, the order exists and is unpaid; later, the payment exists and nothing is
reserved. **The domain must have a name for every intermediate state**, and the UI must be able
to show it. If "the order is in a state we do not have a word for" is unacceptable, a saga is
the wrong tool and you need a single transaction — which means the operation belongs in one
service.

### Choreography or orchestration

- **Choreography** — each service listens for events and reacts. No central component. Reach for
  it with two or three steps. **Fails as**: nobody can answer "where is order 12345?", because
  the workflow exists only as an emergent property of who happens to be subscribed to what.
- **Orchestration** — a coordinator holds the state machine and calls each step. Reach for it
  at four steps or more, or whenever anyone will ever need to ask where a workflow is. **Cost**:
  the coordinator is a component to build, run, and make highly available, and it knows about
  every participant.

**The honest rule**: choreography is cheaper to build and much more expensive to debug.
Orchestration puts the workflow in one readable file. Past a handful of steps, the readable
file wins every time.

### Compensations are the hard part

- **Compensating actions must be idempotent**, because they will be retried. See
  `delivery-semantics.md`.
- **Some steps cannot be compensated.** An email was sent; a physical item shipped. Order the
  saga so irreversible steps come **last**, after everything that could still fail.
- **Compensation can fail too.** The end of every compensation chain is a dead-letter queue and
  a human. Build that path deliberately rather than discovering you need it.
- **Use a pivot step.** Before the pivot, everything is undoable; after it, the saga must go
  forward and retry until it succeeds. Naming that point makes the whole design tractable.

### Workflow engines

**Reach for one when** you have several orchestrated sagas, they run for hours or days, and you
need durable state, timers, retries, and visibility. That combination is a workflow engine's
entire purpose, and building it yourself takes longer than it looks.

**Cost** — a substantial dependency, a programming model your code must adopt, and versioning
rules for workflows already in flight. Do not reach for one for a three-step saga.

## Event sourcing

**Reach for it when** the *history* is the requirement, not an afterthought: ledgers, audit
trails, regulated domains, anything where "how did it get this way" is a question people
actually ask, and anything where you must be able to reconstruct state at a past moment.

Instead of storing current state, store the sequence of events that produced it; current state
is a fold over the events.

**Cost, honestly** — this is the most expensive pattern of the three:

- **Events are immutable and forever.** A bug that wrote wrong events cannot be fixed by an
  `UPDATE`; it is fixed by a compensating event and a migration story for every reader.
- **Schema evolution has no escape hatch.** Every event ever written must remain readable by
  today's code. Version events from the first one, and keep upcasting functions from old
  versions to new. This is the part teams underestimate.
- **Queries are hard.** "All customers in Berlin" is not a question a log answers. You need
  projections, which is where CQRS usually enters — but note that this is a *consequence*, not
  a reason to adopt CQRS on its own.
- **Snapshots become necessary** once streams grow, and now you have a cache with all a cache's
  invalidation problems.
- **GDPR and deletion** conflict directly with immutability. The usual answer is crypto-shredding
  — encrypt personal data per subject and destroy the key — and it has to be designed in from
  the start.

**Try first**: an append-only audit table beside ordinary state. It gives most of the value of
history for a fraction of the cost, and it does not make every query a projection.

**Event replay** is the payoff. A new projection can be built over all history; a bug in a
read model is fixed by rebuilding rather than by migrating. That capability is real, and it is
what you are paying for. If you will never replay, you are not getting the benefit.

## CQRS

**Reach for it when** reads and writes genuinely diverge — different shapes, different scale,
or different consistency needs. A write model enforcing invariants over a normalised schema and
a read model serving a denormalised view for a dashboard are different programs.

**Cost** — two models to keep in step, and the read side is **eventually consistent**. A user
who submits a form and is immediately shown a list that does not contain their change will file
a bug, and they will be right. Plan for it: return the created object directly, read the write
model for that user briefly, or show an optimistic entry. See read-your-writes in
`distributed-data.md`.

**Do not adopt CQRS for a CRUD application.** Separating models that are the same shape doubles
the code and buys nothing. The signal that it is warranted is a read that is genuinely hard to
serve from the write schema — not a general preference for layers.

## Event versioning

Events outlive the code that wrote them, so schema change is a first-class concern from the
first event.

- **Additive changes only, by default.** New optional fields; consumers ignore what they do not
  know. This handles the large majority of change.
- **Never reuse a field name with a new meaning.** That is the one change no consumer can
  detect.
- **Version the event type when you must break it** (`OrderPlaced.v2`), publish both for a
  period, and measure consumption of v1 so you have evidence for removing it.
- **Upcasting** — read old versions and transform them to the current shape on load, in one
  place, so the domain only ever sees the current version.

## Events are notifications, or they are state, and it matters which

- **Event-carried state transfer** — the event contains everything a consumer needs. Consumers
  do not call back. Fast and decoupled; the payload is now a contract, and it duplicates data.
- **Notification only** — the event says "order 123 changed" and consumers fetch what they
  need. Small payloads; N callbacks per event, and a thundering herd when a popular entity
  changes.

Choose deliberately per topic. The common failure is a payload that grew field by field until
it became a state transfer nobody designed, and which now cannot be changed because four
consumers depend on fields the producer forgot it was publishing.
