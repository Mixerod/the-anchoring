---
title: SOLID Principles in Practice
tags: [design, oop, abstraction, refactoring]
when:
  - a class or module has taken on a second responsibility
  - a change requires editing a switch in several places
  - an interface forces implementers to stub methods they do not use
  - concrete construction is hard-wired inside business logic
---

# SOLID Principles in Practice

A practical assessment of object-oriented and modular design principles.

## Non-Machine-Checked Nature

An invariant without a checker is a wish. The tool's invariant template requires an `enforced_by` anchor pointing at a real mechanical checker. Because general software design principles cannot be fully machine-checked without high false-positive or false-negative rates, they are stated here as doctrine prose rather than `INV-` invariants.

## Principles

1. **Single Responsibility Principle (SRP)**: A module should have one, and only one, reason to change. Stated as doctrine: split on two reasons to change rather than waiting for an arbitrary line count limit. (Not machine-checkable in general).

2. **Open/Closed Principle (OCP)**: Software entities should be open for extension, but closed for modification. Stated as doctrine: design extension points where requirements are expected to vary, but avoid premature abstraction for speculative features. (Not machine-checkable).

3. **Liskov Substitution Principle (LSP)**: Subtypes must be substitutable for their base types without altering system correctness. (Partially checked by type systems, but semantic contracts are not machine-checkable in general).

4. **Interface Segregation Principle (ISP)**: Clients should not be forced to depend on methods they do not use. Substantially covered and enforced by module entry point boundaries (`INV-MODULE-ENTRY`) and minimal surface exports.

5. **Dependency Inversion Principle (DIP)**: High-level modules should not depend on low-level modules; both should depend on abstractions. Substantially covered and enforced by layer direction rules (`INV-DEP-DIRECTION`) and pure domain cores (`INV-PURE-CORE`).
