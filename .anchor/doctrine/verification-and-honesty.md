<!-- the-anchoring:pack discipline@1.1.0 hash:c4d112166bb87bbd -->
<!-- Seeded by `kb pack add discipline`. Edit freely — `kb pack check` will report it as
     hand-edited rather than overwrite it. -->

# Verification and Honesty

Engineering discipline for agentic development and automated verification.

## Principles

1. **Report the command's actual output, never an assertion that it passed.** "Tests green" is not evidence; the last lines of the test run are. When a checklist exists, run every item and report what each one printed.

2. **When a check fails, fix the code.** Never raise a threshold, widen an ignore list, relax a validator, or edit a test to match the bug. Changing the rule is legitimate only when the rule itself was wrong — and then state so explicitly, in the commit message, rather than making the failure quietly disappear.

3. **A number in an acceptance criterion is a criterion.** If the expected result is "26 entities, 196 anchors", then 25 is a regression to investigate, not a new baseline. Drift is accepted one plausible number at a time.

4. **A reference to code is a path or a symbol, never a line number.** Line numbers rot within one commit, and a reference that silently becomes wrong is worse than none.
