---
title: Shipping — pipelines, deployment strategies, and getting back
residency: index
tags: [ci-cd, deployment, canary, feature-flags, gitops, terraform, rollback]
when:
  - a change must reach production safely
  - a release needs to be reversible within minutes
  - a risky change should reach a fraction of users first
  - infrastructure is being created or changed by hand
  - a build is slow enough that people avoid running it
  - a database migration must ship alongside code
  - a bad release is live and must be undone
---

# Shipping — pipelines, deployment strategies, and getting back

The property that matters is not deployment frequency. It is **time to recover**. A team that
deploys weekly and can roll back in two minutes is in better shape than one that deploys
hourly and cannot.

So design the pipeline backwards from the rollback.

## The pipeline

**Continuous integration** — every commit is built and tested on a shared branch. If branches
live for a week, you have version control and not CI, and you are paying for it in merge
conflicts.

**Continuous delivery** — every commit that passes is *deployable*. **Continuous deployment** —
it is *deployed*. The second is a business decision; the first should be unconditional.

**Build one artefact and promote it.** The exact bytes tested in staging are the bytes that
reach production; environments differ only by configuration injected at run time. Rebuilding
per environment means production runs something no one tested.

**Speed is a correctness feature.** Past about ten minutes, people stop waiting for the
pipeline and start working around it. Order stages fast-to-slow — lint, unit, build,
integration, end-to-end — so failures surface early, and parallelise the slow ones. Cache
dependencies and build layers aggressively, keyed by a lockfile hash so a stale cache is
impossible.

**A flaky test is an outage of the pipeline.** Quarantine it the day it is noticed and fix it,
or delete it. A suite people rerun until it passes provides no signal at all, and the habit
transfers to the failures that were real.

## Deployment strategies

| Strategy | How | Reach for it when | Costs |
|---|---|---|---|
| **Rolling** | replace instances a few at a time | the default for stateless services | both versions run at once — the schema must tolerate it |
| **Blue-green** | full second environment, switch traffic | you want an instant, complete rollback | double the infrastructure during the switch; stateful parts do not switch |
| **Canary** | a small percentage first, then widen | change is risky and failure is measurable | needs traffic splitting and per-version metrics |
| **Shadow** | mirror real traffic to the new version, discard responses | validating performance without user risk | side effects must be suppressed, or you will double-charge someone |
| **Feature flag** | ship dark, enable separately | deploy and release must be separated | flags accumulate; every one is a branch in production |

**Rolling deploys mean N and N+1 run simultaneously.** Every change must be
backward-compatible for the duration: the schema, the message format, the API. This is why
migrations are expand/migrate/contract — see `database-performance.md`.

**A canary needs a stopping rule decided in advance.** "Roll back if the error rate for the
canary exceeds baseline by X for Y minutes", automated. A canary a human watches is a canary
that gets promoted at the end of the day because everyone wants to go home.

**Feature flags are the highest-leverage tool here** and the easiest to abuse. They separate
deploy from release, allow instant disabling of a broken feature without a build, and enable
percentage rollouts and kill switches for expensive subsystems (see `fault-tolerance.md`).
**Cost**: every flag doubles the state space, and the combinations are untested. Give each flag
an owner and a removal date at creation, and treat a flag older than a quarter as a defect.

## Rollback

**Every deploy answers "how do we undo this?" before it ships.** Three cases, and they differ:

1. **Code only** — redeploy the previous artefact. Fast, and it should be one command.
2. **Code plus an additive migration** — roll back the code; the extra column is harmless. This
   is why expand/migrate/contract exists.
3. **Code plus a destructive migration** — you cannot roll back. Forward-fix only. **Recognise
   this case before shipping**, not during the incident.

**The rollback path must not depend on the build system.** If undoing a release requires a CI
run, and CI is part of the outage, there is no rollback. Keep the previous artefact and a way to
deploy it directly.

**Practise it.** A rollback that has never been exercised takes forty minutes the first time,
and the first time will be during an incident.

## Infrastructure as code

**Reach for it when** infrastructure exists at all. Manual changes are unreviewable,
unreproducible, and undocumented, and they diverge within a month.

- **Terraform / OpenTofu** — provisioning cloud resources. State is the hard part: remote state,
  locking, and a plan reviewed before every apply.
- **Helm** — packaging Kubernetes manifests. Templating YAML with strings is unpleasant;
  alternatives that generate structured output are worth considering.
- **Immutable infrastructure** — never modify a running server; replace it. Configuration drift
  stops existing as a category.

**`plan` is a review artefact.** Applying without reading the plan is the infrastructure
equivalent of merging without reading the diff, and it is how someone destroys a database that
Terraform decided needed replacing.

**Never put a secret in the state file or in a variable file that is committed.** Terraform
state contains resource attributes in plaintext, including generated passwords. Store state in
an encrypted, access-controlled backend and reference secrets from a manager. See
`security-identity.md`.

## GitOps

**Reach for it when** the cluster's desired state should be a git repository, reconciled
continuously by an agent in the cluster.

**What you get**: the repository is the audit log; drift is detected and corrected; rollback is
`git revert`; nobody needs cluster credentials to deploy.

**Cost** — a second repository and a promotion flow between environments, and a debugging step
people find unintuitive at first: an agent, not a pipeline, applied your change, so "why is
this not live" is answered by reading the agent's status rather than a build log.

## Versioning and dependencies

**Semantic versioning is a promise** — see `api-communication.md`. **Every build has a
lockfile**, committed, or your builds are not reproducible.

**Pin, then update deliberately and often.** Both extremes fail: floating versions give you
unreproducible builds and supply-chain exposure; frozen versions give you a two-year upgrade
that cannot be done incrementally. Automated dependency update PRs, merged weekly, is the
practice that avoids both.

**Verify what you pull.** Checksums and lockfile integrity, a private registry mirror, and — for
anything that runs in production — knowledge of what is in the image. A build that downloads
`latest` from the internet at deploy time is a supply chain you do not control.

## Environments

**Fewer, and more production-like, beats many that are all different.** The value of a staging
environment is entirely in how closely it resembles production; one that differs in data
volume, in configuration, and in scale finds only the bugs you would have found anyway.

**Configuration is injected, never built in.** Environment variables or a mounted config, read
at startup, validated at startup — a service that starts successfully and fails on the first
request because a variable was missing has thrown away the one moment it could have failed
usefully.
