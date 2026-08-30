---
title: Queues, topics, and what a consumer does when it cannot keep up
residency: index
tags: [messaging, queue, pubsub, kafka, consumer, backpressure]
when:
  - a caller should not wait for work to finish
  - a producer is faster than its consumer
  - messages must be processed in a particular order
  - a message keeps failing and blocks everything behind it
  - work must survive the process that requested it
  - one event must reach several independent consumers
  - a consumer group rebalances and processing stalls
  - a queue is growing and nobody noticed until it was full
---

# Queues, topics, and what a consumer does when it cannot keep up

A queue converts a synchronous dependency into a buffer. That is genuinely valuable and it is
not free: you have traded an error the caller can see for a backlog nobody is looking at.

**Before adding a broker, try**: doing the work synchronously (if it is fast and must be
correct), or a database table used as a queue (if the volume is modest and you already have
transactions). A broker is an operational dependency, a second delivery-semantics model, and a
new class of incident. Earn it.

## Queue or topic

- **Queue (point-to-point)** — one message, one consumer. Reach for it for work distribution:
  send an email, resize an image, charge a card.
- **Topic (publish/subscribe)** — one message, every subscriber. Reach for it for notification:
  "order placed" is consumed by billing, shipping, and analytics, none of which know about the
  others.

**The design rule**: a producer that knows who consumes its messages has built a queue with
extra steps. If adding a fourth consumer requires changing the producer, it is not pub/sub.

## Partitions, ordering, and the trade nobody escapes

Throughput comes from partitions; ordering comes from *not* having them. A partitioned topic
gives ordering **within a partition only**.

**So the partition key is the ordering unit.** Key by the entity whose order matters — the
account, the order, the conversation — and you get per-entity ordering with parallelism across
entities. Key at random and you get maximum throughput and no ordering at all.

**Fails as** — a hot partition, exactly as in `distributed-data.md`: one enormous account puts
all its traffic on one partition and one consumer.

**Global ordering costs one partition and one consumer.** If a design requires it, that is the
price, and it should be argued for explicitly rather than assumed.

**Try first: do not need ordering.** Most requirements phrased as ordering are really
requirements for idempotency plus a version check — process events in any order, and ignore
any event older than the state you already have. That scales; ordering does not.

## Consumer groups and rebalancing

A consumer group divides partitions among its members, so adding a consumer adds throughput up
to the number of partitions and no further. **Partition count is therefore a ceiling on
parallelism**, and increasing it later changes the key-to-partition mapping — which breaks the
ordering guarantee for in-flight keys.

**Rebalancing is a stall.** When a member joins, leaves, or is presumed dead, partitions are
reassigned and processing pauses. Two consequences:
- A consumer whose processing takes longer than the poll timeout is presumed dead, triggers a
  rebalance, and the whole group stalls — repeatedly. **Signal**: periodic throughput drops
  with no error. Fix by processing in smaller batches, or by extending the timeout
  deliberately.
- Deploys cause rebalances. Use the broker's static membership or cooperative rebalancing if
  deploy-time stalls matter.

## Acknowledgement is the whole contract

- **Ack before processing** — at-most-once. A crash loses the message. Reach for it only when
  loss is genuinely acceptable (sampled telemetry).
- **Ack after processing** — at-least-once. A crash *after* the work and *before* the ack
  redelivers. This is the default in every real system, and it means **consumers must be
  idempotent**. See `delivery-semantics.md`.

**Signal that acks are wrong**: messages disappear under load (acked too early), or every
message is processed twice after every deploy (acked too late, with no idempotency).

## Retries, dead letters, and the poison message

**A message that fails forever will block its partition forever.** This is the single most
common queue outage: one malformed message at the head, and everything behind it stops. The
sequence that prevents it:

1. **Retry in place** a small number of times, with backoff, for transient failures.
2. **Retry queue** with a delay for failures that might resolve later (a dependency is down).
   This gets the message *out of the main flow* so the rest keeps moving.
3. **Dead-letter queue** after a bounded number of attempts. The message stops, the pipeline
   continues.

**A dead-letter queue nobody reads is a data-loss mechanism with a friendly name.** Alert on
its depth. A DLQ that has been non-empty for a week means messages are being silently
discarded, and the only difference from dropping them is that you are also paying for storage.

**Distinguish retryable from terminal failures.** A malformed payload will never succeed;
retrying it ten times wastes ten times the effort and delays everything behind it. Fail it to
the DLQ on the first attempt.

## Delay and priority queues

- **Delay queue** — deliver after a set time. Reach for it for scheduled retries, reminders,
  and "cancel unless confirmed within an hour". Cheaper and more reliable than a cron job
  scanning a table.
- **Priority queue** — some messages jump the line. **Try first: two queues**, one per class,
  with consumers weighted between them. Real priority queues starve the low-priority class
  under sustained load, and the starvation is silent.

## Backpressure

**Signal** — the producer is faster than the consumer and the queue grows without bound.

A queue is a buffer, and every buffer has one of two ends: it is bounded and pushes back, or it
is unbounded and turns a throughput problem into a memory or storage problem plus a latency
problem. **Unbounded queues do not absorb load, they hide it** — until the day the backlog is
so large that draining it takes longer than the outage did.

Responses, in order of preference:

1. **Bound the queue and reject at the producer.** The producer learns immediately, which is
   the entire point.
2. **Scale the consumers** — automatically, on queue depth. Note the ceiling: partition count
   (see above), and the downstream the consumers themselves depend on.
3. **Shed** — drop low-value messages deliberately. See `traffic-management.md`.
4. **Slow the producer** — pull-based consumption does this for free, which is a real argument
   for pull over push.

**Queue depth and consumer lag are the two metrics that matter**, and lag is the better of the
two because it is measured in time. "Forty thousand messages behind" means nothing; "eleven
minutes behind" is an SLO you can alert on.

## Choosing a broker shape

| Shape | Reach for it when | Cost |
|---|---|---|
| **Log** (Kafka and similar) | replay matters, several independent consumers, high throughput | partitions and offsets are yours to manage; operationally heavy |
| **Classic broker** (RabbitMQ and similar) | flexible routing, per-message acks, priority | throughput lower; the broker holds state |
| **Managed cloud queue** | you want none of the above operations | vendor semantics, per-message cost, size limits |
| **Database table** | modest volume, and you already have transactions | polling, and you will eventually rebuild a broker badly |

**The log's distinguishing property is replay.** Messages are not consumed away; consumers hold
an offset. That is what makes event sourcing and adding a new consumer over historical data
possible — see `event-architecture.md`. If you will never replay, you are paying for a
capability you do not use.
