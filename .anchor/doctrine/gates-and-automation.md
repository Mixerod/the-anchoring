<!-- the-anchoring:pack discipline@1.3.0 hash:f4aad5720798f5f1 -->
<!-- Seeded by `kb pack add discipline`. Edit freely — `kb pack check` will report it as
     hand-edited rather than overwrite it. -->

---
title: Gates and Automation
tags: [gates, ci, automation, hooks]
when:
  - a check is about to be made blocking
  - a gate stayed silent on the case it was built for
  - something must run on every turn and cost must stay negligible
  - a bookkeeping rule is being enforced by failing the build
---

# Gates and Automation

Balancing mechanical gates with agent developer workflow.

## Principles

1. **An advisory gate reports; it never fails the turn.** A gate that blocks on bookkeeping is switched off within a week, and then nothing is enforced at all. Reserve hard failure for the one gate that cannot be bypassed — usually CI.

2. **Silence must be earned.** A gate that stays quiet on the exact case it was built for is worse than no gate, because it also removes the suspicion that would have caught the problem. When adding a check, write the test where it must *speak*, not only the one where it must pass.

3. **Anything that runs on every turn must be milliseconds and must never call a model.** It is paid hundreds of times a day.
