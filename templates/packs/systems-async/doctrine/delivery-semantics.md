---
title: Idempotency, delivery semantics, and why exactly-once is a lie you can arrange
residency: index
tags: [idempotency, delivery, exactly-once, outbox, retries, payments]
when:
  - a retry could apply the same effect twice
  - a consumer may receive the same message more than once
  - a payment, charge, or transfer must not be duplicated
  - a database write and a message send must both happen or neither
  - a client resubmits a form and a second record appears
  - a timeout leaves the caller unsure whether the work happened
  - a webhook or callback may be delivered again
---

# Idempotency, delivery semantics, and why exactly-once is a lie you can arrange

Start with the fact everything else follows from: **the sender of a request that times out
cannot know whether it was processed.** Not "usually cannot" — cannot, ever, in any protocol.
The response may have been lost after the work was done. Every duplicate-processing bug in
every distributed system is a consequence of this one fact.

So there are exactly two options: retry and risk a duplicate, or do not retry and risk a loss.
Everything below is about making the first option safe.

## The three semantics

- **At-most-once** — ack before processing. Losses are possible; duplicates are not. Reach for
  it for sampled metrics and nothing you would miss.
- **At-least-once** — ack after processing. Duplicates are certain given enough time. **This is
  what you have**, in every queue, every webhook, every retrying HTTP client.
- **Exactly-once** — what everyone wants.

**Exactly-once *delivery* is impossible** across a network that can drop packets. What is
achievable is **exactly-once *effect***: at-least-once delivery plus an idempotent consumer.
When a broker advertises "exactly-once", it means one of two narrower things — a transaction
spanning its own read-process-write cycle, or deduplication within a time window using a
producer sequence number. Neither extends to a side effect in *your* database or in a third
party's API. Read the guarantee, then assume duplicates anyway.

## Idempotency: the four ways to get it

An operation is idempotent when doing it twice has the same effect as doing it once. In
increasing order of cost:

**1. It is already idempotent.** `SET status = 'shipped'` is. `INCREMENT attempts` is not.
Prefer designing operations to be absolute rather than relative — that is the cheapest fix and
it is free.

**2. A natural unique key.** A unique constraint on `(order_id)` makes a duplicate insert fail
loudly instead of duplicating. Let the database enforce it; an application-level check is a
race between the check and the write.

**3. An idempotency key.** The caller generates a key (a UUID, or a hash of the meaningful
content) and sends it with the request. The server stores `key -> result` and, on a repeat,
returns the stored result without re-executing. This is how every payment API works, and it
should be how yours does.

The details that matter:
- **Store the key and the result in the same transaction as the effect.** If they are separate
  writes, a crash between them gives you either a duplicate charge or an idempotency record
  for work that never happened.
- **Return the original response**, not a 409. The caller's retry should be indistinguishable
  from the first call succeeding — that is the entire point.
- **Give keys a TTL** and say what it is. Keys retained forever are an unbounded table; keys
  retained for an hour do not protect a retry that arrives tomorrow.
- **Guard against a key reused with a different body.** Store a hash of the request; if it
  differs, reject. Otherwise a client bug turns into a silently wrong result.

**4. A processed-messages table.** For consumers: record every message ID processed, in the
same transaction as the work. On redelivery, see the ID and skip. This is the **idempotent
consumer** pattern, and it is the general answer when the work itself cannot be made naturally
idempotent.

## The dual-write problem, and the outbox

**Signal** — code that writes to the database and then publishes a message.

```
save(order)        // succeeds
publish(event)     // process dies here
```

The order exists and nothing downstream will ever hear about it. Reverse the order and you get
the opposite bug: an event for an order that was never saved. **There is no ordering of two
independent writes that is safe**, and a try/catch does not help, because the failure can be
the process disappearing between them.

### The outbox pattern

Write the event **into the same database, in the same transaction** as the business change:

1. In one transaction: update the order, and insert a row into an `outbox` table.
2. A separate relay reads unpublished outbox rows and publishes them to the broker.
3. The relay marks them published — or does not, and republishes. Hence **at-least-once**,
   hence consumers must be idempotent, which is the whole of this file.

**Reach for it whenever a state change must produce a notification.** It is the standard
answer, it needs no distributed transaction, and it turns an impossible problem into an
ordinary one.

**Cost** — a table, a relay process (or change-data-capture reading the write-ahead log), and
publish latency measured in the relay's poll interval. Order within the outbox is by insertion,
so per-entity ordering survives if you publish in ID order.

**The inbox pattern** is the mirror image on the consuming side: record the incoming message ID
in the same transaction as the effect, and skip duplicates. Outbox and inbox together give
exactly-once *effect* end to end, over at-least-once delivery, with no distributed transaction
anywhere.

## Where to put the idempotency boundary

Push it as far out as you can. If the browser's retry, the mobile client's retry, the gateway's
retry, and the queue's redelivery all funnel through one idempotency key checked at the edge,
you reason about duplication once. If each layer invents its own, you reason about it at every
layer and get it wrong at one of them.

**Generate the key at the point of user intent** — when the user presses the button, not when
the request is sent. A key generated per HTTP attempt makes every retry a new operation, which
is exactly the bug.

## A short checklist for anything that moves money

- The client sends an idempotency key generated at the moment of intent.
- The server stores key, request hash, and response in the same transaction as the effect.
- A repeat with the same key and same hash returns the original response.
- A repeat with the same key and a different hash is rejected.
- The state machine forbids illegal transitions (`captured` cannot become `captured`), so even
  a missed key cannot double-charge.
- Reconciliation runs against the provider daily, because none of the above survives a bug you
  have not thought of, and the provider is the only source of truth about what was actually
  charged.
