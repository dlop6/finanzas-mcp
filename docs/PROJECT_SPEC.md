# MCP Finance — Project Technical Specification

**Status:** Active  
**Target delivery:** 2026-09-01  
**Feature freeze:** 2026-08-29  

## 1. Purpose

Build a web chatbot that acts as an MCP Host and can:

1. answer general questions through DeepSeek;
2. maintain session context;
3. connect to MCP servers;
4. show complete MCP request/response logs;
5. use official Filesystem and Git MCP servers;
6. use a custom Finance MCP implemented manually over JSON-RPC/MCP;
7. use the same Finance MCP locally and remotely;
8. capture and analyze remote MCP traffic with Wireshark.

The Finance MCP represents one fictitious small business and provides deterministic financial operations and analysis.

## 2. Source of truth

This document is the main project specification.

- Jira defines implementation work and acceptance criteria.
- ADRs explain important architectural decisions.
- PostgreSQL through Finance MCP is the runtime source of financial truth.
- If Jira, ADRs and this document disagree, update them immediately so they remain consistent.

## 3. Mandatory academic requirements

The solution must include:

- LLM integration through API.
- General chatbot behavior.
- Session context.
- Visible logs of MCP requests and responses.
- Official local Filesystem MCP.
- Official local Git MCP.
- A custom local MCP based on an industry use case.
- Custom MCP specification, usage and examples.
- The same custom MCP deployed remotely.
- Host access to both local and remote Finance MCP.
- Wireshark capture of remote Host ↔ MCP interactions.
- Identification of MCP/JSON-RPC synchronization, requests and responses.
- Analysis of link, network, transport and application layers.
- README in English.
- Progressive commits in private source control.
- Manual MCP/JSON-RPC implementation for the custom protocol path, without SDKs that hide MCP implementation.

A web UI is part of the chosen scope.

## 4. Product scope

### User model

- One fictitious small business.
- One user.
- No authentication.
- Currency: GTQ.
- Business finances only.
- Local and remote databases are independent.
- Preloaded fictitious dataset.

### Core Finance MCP capabilities

1. Register income.
2. Register expense.
3. Query transactions.
4. Update/delete transactions.
5. Query current balance.
6. Query cash-flow summary.
7. Register/query/update/delete debts.
8. Mark debts as paid.
9. Register/query/update/delete receivables.
10. Mark receivables as collected.
11. Deterministic projection for 7 or 30 days.
12. Deterministic purchase-viability evaluation.
13. Basic inventory.
14. Low-stock detection.

### Basic inventory

Product fields:

- `id`
- `name`
- `stock`
- `unitCost`
- `salePrice`
- `minimumStock`

Normal stock changes are recorded through inventory movements.

## 5. Explicitly out of scope

Do not implement unless this specification is formally changed:

- authentication;
- multiple users/businesses;
- bank integration;
- invoicing;
- taxes;
- double-entry accounting;
- formal customer/provider entities;
- partial debt payments;
- partial receivable collections;
- automatic monthly comparisons;
- statistical anomaly detection;
- break-even analysis;
- machine-learning forecasts;
- scheduled summaries;
- advanced inventory;
- purchase orders;
- lots;
- barcode/SKU systems;
- automatic safety-balance optimization;
- autonomous multi-step agents;
- recursive tool planning;
- permanent chat memory.

## 6. Technology stack

- **Web:** Next.js + TypeScript
- **Host:** TypeScript
- **Finance MCP:** Node.js + TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **LLM:** DeepSeek
- **Remote deployment:** Render
- **Network inspection:** Wireshark
- **Testing:** unit + integration tests

Single repository. No Nx/Turborepo.

```text
mcp-finance/
├── app/
│   ├── src/app/
│   ├── src/components/
│   │   ├── chat/
│   │   ├── dashboard/
│   │   └── mcp-logs/
│   └── src/lib/
├── host/
│   ├── llm/
│   ├── context/
│   ├── orchestration/
│   ├── confirmation/
│   └── mcp-clients/
├── servers/
│   └── finance-mcp/
│       ├── tools/
│       ├── services/
│       ├── repositories/
│       └── server.ts
├── shared/
│   ├── jsonrpc/
│   ├── mcp/
│   └── types/
├── database/
│   ├── schema/
│   ├── migrations/
│   └── seed/
├── tests/
│   ├── unit/
│   └── integration/
├── docs/
│   ├── architecture/
│   ├── wireshark/
│   └── evidence/
└── README.md
```

## 7. Architecture

```text
User
  │
  ▼
Next.js Web UI
  │
  ▼
MCP Host
  ├── DeepSeek API
  ├── Finance MCP Client ─────► Finance MCP ─────► PostgreSQL
  ├── Filesystem MCP Client ─► Official Filesystem MCP
  └── Git MCP Client ────────► Official Git MCP
```

Hard boundaries:

- Host must not import Finance MCP handlers, services or repositories.
- Host communicates with Finance MCP only through MCP/JSON-RPC.
- Finance MCP owns financial business logic.
- DeepSeek interprets intent and explains results, but is not the financial source of truth.
- UI does not access PostgreSQL directly.
- Dashboard obtains data through Finance MCP.
- Filesystem and Git remain independent MCP servers.

## 8. MCP and JSON-RPC

For the custom MCP path, implement manually:

- JSON-RPC request/response/notification/error types;
- IDs;
- parsing;
- validation;
- lifecycle;
- `initialize`;
- initialized notification;
- `tools/list`;
- `tools/call`;
- protocol errors.

Do not use FastMCP or an SDK that implements MCP on behalf of the project.

The academic material references MCP specification **2025-11-25**. Before final protocol implementation, verify against that specification:

- lifecycle;
- negotiated protocol version;
- capabilities;
- message shape;
- `tools/list`;
- `tools/call`;
- local transport/framing;
- remote transport requirements.

Local Finance MCP is planned over STDIO. Remote transport must match the required MCP specification.

The same Finance MCP tool/business implementation is used locally and remotely. Only transport, environment and database configuration may differ.

## 9. Finance domain model

Minimum entities:

- `Business`
- `Account`
- `Category`
- `Transaction`
- `FixedExpense`
- `Debt`
- `Receivable`
- `Product`
- `InventoryMovement`

### Transaction

Real money already received or spent.

Types:

- `INCOME`
- `EXPENSE`

Transactions affect current cash.

### Debt

Future obligation.

Status:

- `PENDING`
- `PAID`

Priority:

- `LOW`
- `MEDIUM`
- `HIGH`

Pending debts affect projections, not current cash.

### Receivable

Expected future money.

Status:

- `PENDING`
- `COLLECTED`

Confidence:

- `CONFIRMED`
- `UNCONFIRMED`

Confirmed receivables participate in the safe projection. Unconfirmed receivables only participate in the potential scenario.

### Product

Stores current stock and commercial values. Normal stock entries/exits create an `InventoryMovement`.

## 10. Financial rules

### Current balance

```text
currentBalance =
sum(initial account balances)
+ real income transactions
- real expense transactions
```

Do not maintain another independent balance as a duplicate source of truth.

Pending debts and receivables do not change current balance.

### Projection horizon

Only:

- 7 days
- 30 days

### Safe projection

```text
safeProjectedBalance =
currentBalance
+ confirmedReceivables
- fixedExpenses
- pendingDebts
```

Only records inside the selected horizon participate.

### Potential projection

```text
potentialProjectedBalance =
safeProjectedBalance
+ unconfirmedReceivables
```

### Minimum safety balance

The business has a manually configured `minimumSafetyBalance`. It is not automatically optimized.

### Purchase viability

Input:

- `purchaseAmount > 0`
- `horizonDays ∈ {7, 30}`

```text
safeBalanceAfterPurchase =
safeProjectedBalance - purchaseAmount

potentialBalanceAfterPurchase =
potentialProjectedBalance - purchaseAmount

maximumSafePurchase =
max(0, safeProjectedBalance - minimumSafetyBalance)
```

Statuses:

- `VIABLE`: `safeBalanceAfterPurchase >= minimumSafetyBalance`
- `VIABLE_WITH_RISK`: safe scenario falls below the minimum, but the potential scenario reaches it because of unconfirmed receivables.
- `NOT_VIABLE`: even the potential scenario falls below the minimum.

Finance MCP returns exact inputs and outputs. DeepSeek only explains them.

## 11. Tool design

### Read operations

Execute without confirmation.

Examples:

- list transactions;
- get current balance;
- cash-flow summary;
- list debts;
- list receivables;
- project cash flow;
- evaluate purchase viability;
- list products;
- list low-stock products.

### Write operations

Every mutation requires explicit Host confirmation before `tools/call`.

Examples:

- create/update/delete transaction;
- create/update/delete debt;
- mark debt paid;
- create/update/delete receivable;
- mark receivable collected;
- create/update product;
- record inventory movement.

Confirmation belongs to the Host.

## 12. Host behavior

### DeepSeek

Environment configuration:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

No secrets in code or logs.

### Tool discovery

The Host:

1. initializes MCP;
2. calls `tools/list`;
3. registers tool name, description and `inputSchema`;
4. maps each tool to its MCP server;
5. stores local metadata identifying read vs write operations.

Duplicate tool names must not silently overwrite each other.

### Orchestration

```text
User
  ↓
DeepSeek
  ↓ tool call
Host
  ↓ tools/call
MCP server
  ↓ result
Host
  ↓
DeepSeek
  ↓
Final response
```

MVP limitation:

- one tool-call round per user turn;
- several tool calls may exist in that round;
- no recursive autonomous loop.

### Context

Session context is in memory and isolated by `sessionId`.

Store:

- system prompt;
- user messages;
- assistant messages;
- required tool call/result messages.

Restart may lose active conversations.

### Context compaction

Priority: SHOULD.

Planned defaults:

- threshold: ~6000 tokens;
- keep last 8 messages uncompressed;
- summarize only older context;
- never put raw MCP logs in the conversation summary;
- if summarization fails, preserve existing history.

## 13. Confirmation flow

```text
LLM proposes mutation
        ↓
Host stores exact pending operation
        ↓
User sees exact operation + arguments
        ↓
User confirms or cancels
        ↓
Host executes or discards
```

Rules:

- no mutation before explicit confirmation;
- one pending mutation per session;
- confirmation executes exactly the stored tool and arguments;
- changing arguments requires new confirmation;
- cancellation performs no mutation;
- pending operation clears after execution/cancellation.

## 14. MCP logging

Keep MCP logs separate from conversation history.

Each entry includes at least:

- timestamp;
- session ID;
- MCP server;
- direction;
- message type;
- method when applicable;
- request ID when applicable;
- raw JSON-RPC payload;
- status/error;
- duration when correlatable.

Log at least:

- `initialize`;
- initialized notification;
- `tools/list`;
- `tools/call`;
- responses;
- protocol errors.

Never log secrets.

Logs must be readable by the future UI.

## 15. Web UI

Single web application.

Required areas:

### Chat
Primary interaction area.

### Mini financial dashboard
Read-only. Shows:

- current balance;
- current-month income;
- current-month expenses;
- pending receivables;
- upcoming obligations;
- projected cash flow;
- low stock.

Uses Finance MCP. No direct Prisma/DB access.

### MCP logs
Visible or collapsible panel.

### Confirmation UX
Clearly show pending write action and confirmation/cancel options.

No duplicate CRUD dashboard, admin panel or advanced analytics.

## 16. Filesystem and Git MCP

Use official existing MCP servers.

Required demo flow:

1. obtain financial data through Finance MCP;
2. generate a Markdown report;
3. save it using Filesystem MCP;
4. add/commit it using Git MCP.

## 17. Local and remote Finance MCP

### Local
Used for implementation and tests.

### Remote
Deploy the same Finance MCP codebase to Render with remote PostgreSQL.

Requirements:

- same tools;
- same business rules;
- same Host-facing contract;
- independent DB;
- Host can switch local/remote through configuration.

No local/remote DB synchronization.

## 18. Wireshark and network analysis

Remote MCP traffic must be captured and analyzed.

Evidence should identify:

- connection establishment;
- transport behavior;
- MCP/JSON-RPC synchronization where observable;
- requests;
- responses;
- link layer;
- network layer;
- transport layer;
- application layer.

### TLS risk

If remote MCP uses HTTPS, normal Wireshark capture sees encrypted TLS payload.

Do not assume JSON-RPC will be visible automatically. Validate a workable capture/decryption strategy early.

## 19. Testing strategy

### Unit tests

Focus on deterministic logic:

- JSON-RPC parsing;
- protocol validation;
- financial calculations;
- projection;
- purchase viability;
- inventory rules;
- domain validation.

### Integration tests

Cover:

- Finance MCP ↔ PostgreSQL;
- real `tools/list`;
- real `tools/call`;
- persistence;
- errors;
- MCP request/response mapping.

Use a separate test database.

Critical scenarios include:

- valid/invalid income and expense;
- transaction filters;
- debt lifecycle;
- receivable lifecycle;
- confirmed vs unconfirmed projections;
- paid/collected exclusion;
- inventory entry/exit;
- insufficient stock;
- low stock;
- 7/30 projections;
- all purchase-viability statuses;
- reads without confirmation;
- writes with confirmation;
- MCP errors logged correctly.

## 20. Engineering principles

Mandatory:

- **KISS**
- **YAGNI**
- **DRY**
- **AHA**
- **SOLID**, especially SRP, ISP and DIP
- **Separation of Concerns**
- **CQS**
- **Law of Demeter**
- **Principle of Least Astonishment**
- **Single Source of Truth**
- **High Cohesion / Low Coupling**
- **Validate at Boundaries / Fail Fast**
- **Least Privilege**
- **Testability by Design**

Overarching rule:

> Do not apply a principle mechanically if it adds complexity without solving a current problem.

## 21. Development phases

### Phase 1 — Foundation & Architecture

- repository;
- project structure;
- PostgreSQL/Prisma;
- schema and seed;
- architecture documentation.

**Milestone:** app structure, DB and fictitious seed ready.

### Phase 2 — Manual JSON-RPC & MCP Core

- JSON-RPC types;
- parser/validation;
- IDs/errors;
- local transport;
- MCP lifecycle;
- `initialize`;
- `tools/list`;
- `tools/call`;
- unit tests.

**Milestone:** manual Host/client ↔ Finance MCP core communication works without LLM.

### Phase 3 — Local Finance MCP

- repositories;
- transactions;
- debts;
- receivables;
- inventory;
- balance/cash flow;
- projection;
- purchase viability;
- tests;
- tool specification.

**Milestone:** local Finance MCP complete and testable without DeepSeek.

### Phase 4 — Chatbot Host + DeepSeek

- DeepSeek;
- discovery;
- orchestration;
- session history;
- write confirmation;
- MCP logs;
- optional compaction.

**Milestone:** financial conversation works end-to-end locally.

### Phase 5 — Filesystem + Git MCP

- Filesystem MCP;
- Git MCP;
- report creation + commit demo.

**Milestone:** one Host orchestrates Finance, Filesystem and Git MCPs.

### Phase 6 — Remote MCP + Render

- remote transport;
- Render deployment;
- remote PostgreSQL;
- local/remote switch;
- remote tests;
- preliminary Wireshark validation.

**Milestone:** same Finance MCP works locally and remotely.

### Phase 7 — Web UI

- chat;
- mini dashboard;
- MCP logs;
- confirmation UX;
- loading/errors.

**Milestone:** primary flows demoable from browser.

### Phase 8 — QA, Documentation & Network Analysis

- E2E scenarios;
- bug fixing;
- README;
- MCP docs;
- final Wireshark capture;
- layer analysis;
- difficulties/solutions/lessons;
- rehearsal.

**Milestone:** tested, documented and presentation-ready.

## 22. Timeline

- Aug 7–9: Phase 1
- Aug 9–12: Phase 2
- Aug 12–17: Phase 3
- Aug 18–21: Phase 4
- Aug 21–22: Phase 5
- Aug 23–25: Phase 6
- Aug 25–27: Phase 7
- Aug 26–28: QA/docs in parallel
- Aug 29: feature freeze
- Aug 30: final Wireshark/report
- Aug 31: presentation/review
- Sep 1: delivery only

If schedule slips, cut optional UI polish/context compaction before protocol, remote MCP, logs, tests or Wireshark requirements.

## 23. Definition of Done

A ticket is Done when:

- requested behavior exists;
- happy path works;
- relevant errors work;
- corresponding tests pass;
- neighboring integration is verified where applicable;
- MCP logs are correct where applicable;
- affected docs are updated;
- useful evidence is saved when needed;
- work is committed progressively.

Tickets larger than roughly 6 real hours should normally be split.

## 24. Demo scenarios

### Primary Finance demo

1. Ask current financial situation.
2. Host calls Finance MCP.
3. Show balance, income, expenses, debts and receivables.
4. Register sale/expense.
5. Host asks for confirmation.
6. User confirms.
7. Mutation executes.
8. Ask: “Can I spend Q3,000 on inventory without affecting my payments?”
9. Finance MCP calculates the exact scenario.
10. DeepSeek explains the result.
11. JSON-RPC logs remain visible.

### Filesystem/Git demo

1. Request financial report.
2. Gather data through Finance MCP.
3. Create Markdown through Filesystem MCP.
4. Git add/commit through Git MCP.

## 25. Known risks

### Protocol mismatch
Mitigation: verify MCP 2025-11-25 before finalizing protocol code.

### HTTPS/TLS Wireshark visibility
Mitigation: test capture/decryption feasibility early.

### DeepSeek API behavior
Mitigation: keep model/provider configuration external and verify actual API/tool-calling semantics during Host integration.

### Scope growth
Mitigation: YAGNI, explicit out-of-scope list and feature freeze.

## 26. Open technical verification items

These are verification tasks, not product-scope decisions:

1. exact MCP 2025-11-25 lifecycle/capability fields;
2. exact local framing;
3. exact remote transport;
4. exact DeepSeek model identifier/API/tool-calling contract;
5. workable Wireshark/TLS capture strategy.

Do not infer new product scope from these items.

## 27. Change control

Changes to stack, protocol strategy, domain model, formulas, scope, database ownership, Host/MCP boundaries, deployment architecture, confirmation policy or phases require updating this document and, when architectural, the relevant ADR.

Small implementation details do not require a new ADR.
