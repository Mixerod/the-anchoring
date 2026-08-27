# The Anchoring

**An intent graph in git, anchored to code, machine-checked.** Documentation floats free of
code, is written once, drifts within weeks, and nothing ever notices. Anchoring ties every
claim a document makes to a specific, machine-checkable point in the code, so that when the
code moves, the claim fails loudly instead of quietly becoming fiction.

```
kb ctx <W-id>          everything that bears on a piece of work, before you start
kb why <target>        what a file, symbol, or entity is for
kb done <W-id>         what still needs recording, before you finish
kb verify [--strict]   check every claim the docs make about the code
```

## Status: pre-release, being ported

This repository is the extraction of the pattern from the project it was invented in
(Dicebound, 2026-08-22/23) into something any repository can install. The engine works and
is fully tested; what is missing is the configuration layer that removes the original
project's hardcoded paths, and a bootstrap command.

| Document | Read it for |
|---|---|
| [`docs/THE_ANCHORING.md`](docs/THE_ANCHORING.md) | the pattern itself, and why it is not a vector database — the complete brief |
| [`docs/PLAN.md`](docs/PLAN.md) | the porting plan: every coupling, every task, every acceptance test |
| [`docs/HANDOFF_PROMPT.md`](docs/HANDOFF_PROMPT.md) | the prompt to hand to an implementing agent |
| [`docs/origin/`](docs/origin/) | frozen provenance from the original repository — reference only |

## Baseline

```bash
npm install
npm run verify     # typecheck + lint + 144 tests
npm run kb -- verify
```

## Licence

MIT.
