# Tags Are a Hint, Not a Claim

An anchor and a tag look alike in the frontmatter and mean entirely different things.

An **anchor** is a claim about the code, and it is verified. `holds_for: [file:src/pay/]`
asserts that the path exists, and `kb verify` fails when it stops existing. That is what makes
an anchor evidence: it cannot quietly become false.

A **tag** asserts nothing checkable. `tags: [payment]` is a retrieval hint — a word that helps
a query find a document. Nothing confirms the document is about payments, and nothing notices
when it stops being about payments.

So: **never cite a tag as evidence.** "This is tagged `security`" is not a security review.
If a claim matters enough to rely on, it needs an anchor, a test, or a checker — the same rule
that applies everywhere else here. A tag only makes a document easier to find.

## What is checked, and what is not

Shape is checked, because it is a format rule rather than a judgment: a tag must be a
lowercase slug. Beyond that, there are two modes, and choosing between them is the point.

- **Declare a vocabulary** (`tags: { vocabulary: [...] }` in `anchoring.config.json`) and a
  tag outside it is an **error**. A declared vocabulary is a deliberate choice, and enforcing
  it is what makes declaring it worth anything.
- **Declare nothing** and a tag used exactly once across the whole corpus is a **warning**. A
  one-off tag is either a typo or a private note. Neither is a shared vocabulary, and both
  make retrieval quietly worse — a misspelled tag fails by simply never matching, which no
  amount of reading the document will reveal.

The singleton warning never fails a build, under any flag. It is a hint about vocabulary
quality, and a build that fails on one is a build people learn to bypass.

## The failure this prevents

Tags were introduced here as hand-maintained metadata with no checker at all, which made them
the one place this method reintroduced the drift it exists to abolish. The first run of the
checker found that **every tag in the corpus was used exactly once** — the field had produced
no shared vocabulary whatsoever, and nothing had ever said so.

That is the whole argument for a checker in miniature. Prose explains why; only a program
makes it true.
