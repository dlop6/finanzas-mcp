# ADR-009 — Keep chatbot sessions in memory for the MVP

**Status:** Accepted

## Context
The requirement is to maintain session context, not to build a persistent multi-user chat platform.

## Decision
Store conversational sessions in memory, isolated by `sessionId`. Persistence across restarts is not required. Optional compaction may summarize older messages after a threshold.

## Consequences
**Positive:** minimal implementation that satisfies context requirements.  
**Negative:** restart loses active conversations.

## Guardrail
Do not add chat persistence, authentication or cross-device synchronization in the MVP.
