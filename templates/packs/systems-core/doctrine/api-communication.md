---
title: API shape, versioning, and how services talk
residency: index
tags: [api, rest, rpc, grpc, versioning, webhooks, contracts]
when:
  - a new service boundary or public endpoint is being designed
  - a breaking change is about to ship to callers you do not control
  - a client polls an endpoint on a timer to find out whether something finished
  - an integration must notify a third party when something happens
  - a response would be large enough to time out or exhaust memory
  - two teams disagree about the shape of a payload
  - an endpoint returns 200 with an error inside the body
---

# API shape, versioning, and how services talk

The question this file answers is not "REST or gRPC". It is: **who is allowed to break whom,
and how do they find out.**

## Choosing the interaction style

| Reach for | When | It costs |
|---|---|---|
| **REST over HTTP** | public or partner APIs, cacheable reads, many unknown clients | verbose; N+1 round trips when the resource graph is deep |
| **RPC / gRPC** | internal calls, a schema you control on both ends, streaming | codegen and a build step; a shared schema is a shared dependency |
| **Webhooks** | *you* must tell someone else something happened | you now own delivery: retries, signing, replay, and their downtime |
| **HTTP streaming** | a response too large to buffer | no content length, so proxies and clients must cooperate |
| **Message queue** | the caller must not wait, or the work may be retried | eventual consistency, and a broker to operate — `messaging.md` |

**Signal you have chosen wrong**: a client polls on a timer to discover whether work
finished. That is a queue or a webhook wearing a REST costume. Polling costs a request per
client per interval forever, and still adds half an interval of latency.

## Request and response is a contract about failure, not only about data

- **An error is a status code**, not a 200 with an error object inside. Every proxy, cache,
  retry policy, and monitor in the path reads the status line and none of them read your
  body. A 200-wrapped error is invisible to your own alerting.
- **4xx means do not retry** (the caller sent something wrong). **5xx and 429 mean retry with
  backoff.** If your API blurs this, every client's retry logic is guesswork.
- **429 with `Retry-After`** is the highest-value response header a busy API has. It converts
  a retry storm into a schedule. See `traffic-management.md`.
- **Offer an idempotency key for anything that costs money.** See `delivery-semantics.md` in
  the `systems-async` pack.

## Versioning

**Semantic versioning is a promise about breakage**: major means callers must act, minor is
additive, patch is neither. If you break callers in a minor, the number is decoration.

**Additive change needs no version.** A new optional field, a new endpoint, a new enum value
clients ignore — ship it. Versioning every change trains callers to ignore versions.

**Reach for an explicit API version when** you must remove or reinterpret a field callers
depend on. Options, cheapest first:

1. **Tolerant reader** — clients ignore unknown fields, so additive change is free forever.
   Do this before anything else; it is a client-side discipline, not a server feature.
2. **Field-level deprecation** — new field beside old, dual-write, measure reads of the old
   one, delete at zero. Slow, boring, and it never breaks anyone.
3. **URL or media-type version** — a real fork. **Cost**: two implementations, and the old
   one lives as long as its slowest caller. Set an end date when you create it, not when it
   starts to hurt.

**Fails as**: a version that is never retired. Every version you have not deleted is a
codebase you are still maintaining. Instrument per-version traffic on day one or you will
have no evidence for the removal argument.

## Webhooks make you a message broker

Sending webhooks puts you in the delivery business with none of the tooling. Whatever you
ship must have:

- **Retries with exponential backoff and jitter**, and a cap — see `fault-tolerance.md`.
- **A signature** (HMAC over the raw body) and a timestamp, so the receiver can verify origin
  and reject replays.
- **At-least-once stated in the documentation**, because that is what you will actually
  deliver. Receivers must be idempotent; say so, and give them a stable event ID.
- **An ordering disclaimer.** You cannot promise order across retries. If order matters, send
  a sequence number and let the receiver reorder.
- **A dead-letter path and a manual replay**, or you will be doing database surgery during an
  incident.

## CORS is not security

CORS tells a *browser* which origins may read a response. It is enforced by the browser and
by nothing else; a command-line client ignores it entirely. It stops a malicious page from
reading your API with the user's cookies. It does not authenticate, authorise, or rate limit.
Those are in `security-identity.md`.

## Pagination and payload size

**Every list endpoint is paginated from the first commit.** An unbounded list is a query that
works in development and times out in production, and adding pagination later is a breaking
change.

- **Offset pagination** is easy and wrong at scale: a large offset makes the database walk
  every skipped row, and rows shift under a paging client.
- **Cursor / keyset pagination** is stable under insertion and costs the same at page 1 and
  page 10,000. Prefer it. Cost: no random access to page N.

## One concept, one name

The same noun in the database, the type, the API field, the UI label, and the docs. Synonyms
for one thing are how an API stops being searchable, and how two teams end up with two subtly
different models of the same object.
