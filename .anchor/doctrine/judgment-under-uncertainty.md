<!-- the-anchoring:pack discipline@1.0.0 hash:15fd5a6fcf1f5779 -->
<!-- Seeded by `kb pack add discipline`. Edit freely — `kb pack check` will report it as
     hand-edited rather than overwrite it. -->

# Judgment Under Uncertainty

How to make architectural and debugging decisions under incomplete information.

## Principles

1. **Default to local fault.** When something breaks while using a library, tool, or framework, the starting verdict is "our code", and blaming the dependency requires specific evidence. Asked an open question — *is this their bug?* — an agent says yes far more often than the truth warrants.

2. **Give every classification a closed list and a default.** Open-ended judgment is where agents drift; a fixed set of options with a stated default is where they do not. If a case genuinely fits none of the options, that is a finding to report, not a licence to invent an option.

3. **A mechanism that can never say "no" reports noise until it is switched off.** Build the negative path and make it visible: show the items that were *not* escalated, *not* flagged, *not* changed. A filter whose rejections are invisible cannot be audited, and an unauditable filter is trusted right up until it is ignored.
