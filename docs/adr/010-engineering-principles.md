# ADR-010 — Apply pragmatic engineering principles and avoid overengineering

**Status:** Accepted

## Context
The project has several boundaries and a short delivery window. Excess abstraction is as risky as poor structure.

## Decision
Use these principles as mandatory guidance:

- KISS
- YAGNI
- DRY
- AHA
- SOLID, especially SRP, ISP and DIP
- Separation of Concerns
- Command Query Separation
- Law of Demeter
- Principle of Least Astonishment
- Single Source of Truth
- High Cohesion / Low Coupling
- Validate at Boundaries / Fail Fast
- Least Privilege
- Testability by Design

## Interpretation
Principles guide decisions; they are not a reason to create unnecessary abstractions. When principles conflict, prefer the simplest design that satisfies current requirements while preserving clear boundaries.

## Guardrail
Do not add layers, factories, interfaces, generic frameworks or extension points without a concrete current need.
