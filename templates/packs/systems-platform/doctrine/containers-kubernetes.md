---
title: Containers and Kubernetes — desired state, and the six things that break
residency: index
tags: [kubernetes, containers, docker, orchestration, probes, scheduling]
when:
  - a workload is being moved into containers or onto a cluster
  - a pod restarts repeatedly and the cause is unclear
  - a pod is evicted or refuses to schedule
  - traffic reaches a pod that is not ready to serve it
  - a deploy produces a burst of connection errors
  - a stateful workload needs stable identity or storage
  - resource requests and limits must be chosen
  - configuration or secrets must reach a container
---

# Containers and Kubernetes — desired state, and the six things that break

Learn Kubernetes in this order and it is small; learn it as an API surface and it is enormous:

**desired state → reconciliation → control plane → worker → networking → storage.**

Everything is one idea repeated. You declare what you want; a controller continuously compares
that to what exists and acts to close the gap. There is no "deploy" verb — there is a changed
declaration and a loop that notices. Every confusing behaviour is that loop doing exactly what
it was told.

## Containers, before the cluster

A container image is a filesystem plus metadata. It is not a virtual machine; the kernel is
shared.

- **Build small.** Multi-stage builds: compile in a full image, copy the artefact into a minimal
  runtime. Smaller images pull faster (which is part of your cold start) and carry less to
  patch.
- **Order layers by change frequency.** Dependencies before source, so a code change does not
  invalidate the dependency layer. This is the single biggest build-cache win.
- **Pin base images by digest, not by tag.** `:latest` and even `:3.12` move under you, which
  makes builds unreproducible and makes "it worked yesterday" unanswerable.
- **Run as a non-root user**, read-only root filesystem, and drop capabilities. See
  `security-identity.md`.
- **One process per container**, and it must handle `SIGTERM`. A process that ignores `SIGTERM`
  is killed after the grace period, mid-request, on every single deploy.
- **Never bake a secret into an image.** Layers are permanent and images are widely readable.

## The objects, and when each is right

| Object | Reach for it when |
|---|---|
| **Pod** | never directly — it is what the others create |
| **Deployment** | stateless replicas, rolling updates. The default |
| **StatefulSet** | stable network identity, stable storage, ordered start — databases, brokers |
| **DaemonSet** | one per node — log shipper, node agent, CNI |
| **Job / CronJob** | run to completion, once or on a schedule |
| **Service** | a stable virtual address in front of a changing set of pods |
| **Ingress / Gateway** | HTTP routing from outside the cluster, TLS termination |
| **ConfigMap** | non-secret configuration |
| **Secret** | secret configuration — see the caveat below |
| **PVC** | a claim on durable storage, satisfied by a PV |

**A Secret is base64, not encryption.** Encryption at rest for etcd is a cluster setting that is
off by default in some distributions, and anyone who can read Secrets in a namespace can read
the values. Treat Kubernetes Secrets as *access-controlled*, not as *encrypted*, and use an
external secret manager for anything high-value. See `security-identity.md`.

## Probes are where most production pain lives

Three probes, three different questions. Confusing them is the most common Kubernetes
misconfiguration.

- **Liveness — "should I be restarted?"** **Must not check dependencies.** A liveness probe that
  fails because the database is down restarts every pod simultaneously, turning a database
  outage into a database outage plus a full cold start plus a connection storm. Check only that
  the process is not deadlocked. When in doubt, do not set a liveness probe at all: a missing
  one is far safer than a wrong one.
- **Readiness — "should I receive traffic?"** *This* is where dependency checks belong. A pod
  that fails readiness is removed from the Service endpoints and left alone.
- **Startup — "am I still booting?"** Suspends liveness until the app has started once. Without
  it, a slow starter is killed by liveness before it has ever been ready, forever.

**The deploy-time 502 burst** is almost always this sequence: the pod receives `SIGTERM` and
stops accepting connections *before* the endpoint removal has propagated to every proxy. The
fix is a `preStop` sleep of a few seconds, and a graceful shutdown that fails readiness first
and keeps serving during the drain. See `fault-tolerance.md`.

## Requests and limits

- **Request** — what the scheduler reserves. Too low and the node is oversubscribed and
  everything is throttled; too high and you pay for idle capacity.
- **Limit** — the ceiling. Exceeding a memory limit means the container is **killed**
  (`OOMKilled`), immediately and without warning. Exceeding a CPU limit means it is
  **throttled** — much subtler, and it shows up as unexplained latency.

**CPU limits are frequently harmful.** A container throttled at its limit has latency spikes
that look like a network or dependency problem. Setting a CPU request without a CPU limit is a
defensible and common choice; memory should always have a limit, because unbounded memory takes
the whole node.

**Quality of Service follows from these**: requests equal to limits gives Guaranteed (evicted
last); requests below limits gives Burstable; neither set gives BestEffort (evicted first).
**A pod with no requests is the first thing killed under node pressure**, which is rarely what
anyone intended.

**Pod Disruption Budgets** protect against *voluntary* disruption — node drains, cluster
upgrades. Without one, a drain can take every replica of a service at once. It does nothing
about crashes or node failure; it constrains the operations *you* initiate.

## Networking, in five sentences

Every pod gets its own IP, and pods can reach each other directly — the CNI plugin provides
this. A **Service** gives a stable virtual IP and a DNS name in front of a changing set of pod
IPs, load-balanced by `kube-proxy` or its equivalent. **Ingress** (or the Gateway API) brings
HTTP traffic in from outside, terminates TLS, and routes by host and path. **NetworkPolicy** is
a firewall between pods, and — this is the part that surprises people — **the default is allow
all**: with no policy in a namespace, any pod can reach any other pod, cluster-wide. A
default-deny policy per namespace is the baseline; see `security-identity.md`.

## Autoscaling

- **HPA** — more pods, on a metric. The workhorse. Same caveats as any autoscaler: pick the
  metric that reflects the actual bottleneck, and know the downstream ceiling. See `scaling.md`.
- **VPA** — right-sizes requests and limits. Useful for *recommendations*; in enforcing mode it
  restarts pods to apply changes, and it conflicts with HPA on the same metric.
- **Cluster Autoscaler** — more nodes when pods cannot be scheduled. Note the latency: a new
  node is minutes, not seconds, so HPA alone cannot absorb a spike if there is no room.

## Reading a failure

The state tells you where to look:

- **`CrashLoopBackOff`** — the container starts and exits. Read the *previous* container's logs,
  not the current ones. Usually a config error, a missing dependency at startup, or a failing
  liveness probe.
- **`OOMKilled`** — exceeded the memory limit. Either the limit is too low or something leaks;
  see `concurrency-runtime.md`.
- **`ImagePullBackOff`** — wrong tag, wrong registry, or missing pull credentials.
- **`Pending`** — nothing can schedule it. Insufficient resources, an unsatisfiable node
  selector or affinity, an unbound PVC, or a taint with no matching toleration. The events on
  the pod say which.
- **`Evicted`** — node pressure (memory, disk). Look at the pod's QoS class, above.
- **Ready 0/1 but running** — readiness is failing. Not a crash; the app says it is not ready,
  and it is usually right.

## What Kubernetes does not give you

It gives you *scheduling and reconciliation*. It does not give you the things in the rest of
this pack, and adopting it does not address any of them:

- Retries, timeouts, and circuit breaking between services (`fault-tolerance.md`).
- Idempotency (`delivery-semantics.md`).
- Database availability — a StatefulSet is not a database operator, and a database operator is
  not a DBA.
- Observability (`observability.md`).

**Kubernetes on a system with no timeouts and no idempotency automates the failures.** The
platform is a multiplier, in both directions.
