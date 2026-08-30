---
title: Transport, protocols, and the timeouts that decide latency
residency: index
tags: [networking, http, tls, tcp, latency, timeouts]
when:
  - a request hangs with no error and no log line
  - tail latency is far worse than median latency
  - a client opens a fresh connection for every call
  - two services disagree about whether a request completed
  - a protocol choice is being made between HTTP, gRPC, and a socket
  - throughput is capped well below the available bandwidth
  - TLS handshakes appear in a latency profile
---

# Transport, protocols, and the timeouts that decide latency

Almost every "the network is slow" report is really one of four things: a missing timeout, a
new connection per request, head-of-line blocking, or a retry storm. This file is about the
first three; retries are in `fault-tolerance.md`.

The single most useful mental model: **latency is a floor set by distance, throughput is a
ceiling set by the narrowest link, and bandwidth is neither.** A round trip between
continents is ~150 ms and no amount of hardware changes that. If a design needs three
sequential round trips, it has bought 450 ms before executing a line of code.

## Timeouts

**Every network call has a timeout, or it has an unbounded one.** There is no third option;
a call without an explicit timeout inherits the OS default, which is measured in minutes.

- **Connect timeout** — how long to wait for a TCP (and TLS) session. Short: 1–3 s. A peer
  that has not answered in 3 s is down, not slow.
- **Read timeout** — how long to wait for bytes after the request is sent. This is the one
  that decides whether a hung dependency takes your service down with it.
- **Write timeout** — how long to wait to push the request out. Matters when a peer stops
  reading and your buffers fill.

**Signal that timeouts are missing** — a request hangs and nothing logs. Errors always log;
silence means nobody set a deadline.

**Deadline propagation** beats per-hop timeouts. If the caller has 2 s left, hop three must
be told it has 2 s left, not given a fresh 5 s of its own. Without it a chain of "reasonable"
per-hop timeouts multiplies into a total nobody chose. gRPC and HTTP servers both support
carrying a deadline; use it. See `fault-tolerance.md`.

## Connection reuse

**Reach for connection pooling and keep-alive when** a client opens a fresh connection per
call. A new HTTPS connection is one TCP handshake plus a TLS handshake — two extra round
trips before any byte of payload, so ~300 ms cross-region on a call whose work takes 5 ms.

- **Cost** — a pool is state. Size it, bound it, and set an idle eviction; an unbounded pool
  is a slow memory leak, and an under-sized pool is a queue nobody can see.
- **Fails as** — connection exhaustion under a traffic spike, which looks like latency, not
  like an error, until the pool's wait queue times out.
- **Watch for** — pools sized per-process while the *database* limit is per-cluster. Twenty
  replicas × a pool of 50 is 1,000 connections against a server that allows 200. See
  `database-performance.md`.

## Which protocol

| Reach for | When | It costs |
|---|---|---|
| **HTTP/1.1** | public APIs, maximum compatibility, simple caching | one request in flight per connection; head-of-line blocking; needs many connections |
| **HTTP/2** | many small calls to the same origin | multiplexing over one connection; but a single lost packet stalls *all* streams (TCP-level head-of-line blocking) |
| **HTTP/3 (QUIC)** | lossy or mobile networks, high-latency links | per-stream loss recovery over UDP; 0-RTT resumption; less mature middlebox support |
| **gRPC** | internal service-to-service, streaming, strong contracts | a schema and a codegen step; poor browser story without a proxy |
| **WebSocket** | true bidirectional, long-lived, low-latency | a stateful connection per client — now your load balancer and autoscaler care |
| **SSE** | server→client only, text events, reconnect for free | one direction; older proxies buffer it |
| **Long polling** | last resort when nothing else passes the network | a held request per client; the worst throughput of the set |

**The most common mistake** is reaching for WebSockets when server-sent events would do. If
the client only needs to *receive*, SSE reconnects automatically, works through ordinary HTTP
infrastructure, and needs no heartbeat protocol of your own.

## TCP vs UDP

**Use TCP unless you can name the reason.** Ordered, reliable, congestion-controlled.

**Reach for UDP when** loss is preferable to delay — live audio and video, telemetry
sampling, or a protocol like QUIC that rebuilds reliability per-stream on top. Cost: you now
own ordering, retransmission, and congestion control, and getting congestion control wrong
harms every other flow on the path, not just yours.

## Head-of-line blocking, in one line each

- **HTTP/1.1** — one response blocks the connection. Fix: more connections, or HTTP/2.
- **HTTP/2** — one lost TCP packet blocks every stream. Fix: HTTP/3.
- **A partitioned queue** — one slow message blocks its partition. Fix: `messaging.md`.

## Clock skew

**Never order distributed events by wall clock.** Two machines' clocks differ by
milliseconds at best and minutes at worst, and NTP steps backwards. A "latest write wins"
rule built on `now()` silently loses writes.

Use a monotonic clock for durations, and a logical clock — Lamport or vector — for ordering
across machines. See `distributed-data.md`.

## Correlation IDs

**Reach for a request correlation ID when** a single user action crosses more than one
service. Generate at the edge, propagate on every hop, log on every line. Without it,
debugging is grep-by-timestamp across services whose clocks disagree — see above.

This is the same identifier that becomes a trace ID; see `observability.md`.
