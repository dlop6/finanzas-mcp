# Finance MCP Tool Specification

## 1. Purpose and authority

Finance MCP is a local Model Context Protocol server for the financial administration of one fictitious small business. It exposes deterministic operations for transactions, debts, receivables, inventory, cash flow, projections, and purchase viability.

- MCP protocol version: `2025-11-25`.
- Local transport: STDIO, with one compact JSON-RPC message per line.
- Persistent state: PostgreSQL, accessed only by Finance MCP.
- Authoritative calculations: Finance MCP services. An LLM may explain results but must not calculate or override them.
- Currency: GTQ only.
- Canonical demo dataset date: `2026-08-08`.
- Productive catalog: 24 tools, consisting of 15 writes and 9 reads.

This document specifies the public wire contract. It does not expose Prisma models, repository interfaces, handlers, credentials, or other server internals.

## 2. MCP lifecycle and tool invocation

The client must complete this sequence before calling a tool:

1. Send `initialize`.
2. Receive the initialization result.
3. Send `notifications/initialized` without an ID.
4. Discover the catalog with `tools/list`.
5. Invoke a tool with `tools/call`.

### 2.1 Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "finance-mcp-client",
      "version": "1.0.0"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "finance-mcp",
      "version": "0.1.0"
    }
  }
}
```

### 2.2 Initialized notification

Notifications have no ID and produce no response.

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### 2.3 Discover tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

The result contains all 24 definitions in the order listed in [Tool catalog](#5-tool-catalog). Each public definition contains exactly `name`, `description`, and `inputSchema`. The internal `isWriteOperation` flag is deliberately not part of the MCP wire format.

### 2.4 Call a tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {}
  }
}
```

Every request has an ID and every response preserves that ID. `tools/list` and `tools/call` are rejected until the lifecycle reaches `READY`.

## 3. Shared data conventions

### 3.1 Input rules

| Value | Wire representation | Rules |
|---|---|---|
| Money | JSON string | Matches `^(?:0\|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$`. Financial amounts must be greater than zero. Inventory costs and prices may be zero. |
| Date | JSON string | Strict `YYYY-MM-DD` calendar date. |
| Entity ID | JSON integer | Minimum `1`. |
| Stock/minimum stock | JSON integer | Minimum `0`. |
| Movement quantity | JSON integer | Minimum `1`. |
| Text | JSON string | Trimmed by the service and must contain text. |
| Optional value | Omitted property | Optional values are omitted rather than sent as `null`. |

Every tool schema has `type: "object"` and `additionalProperties: false`. Money is converted directly to decimal arithmetic and is never processed as a floating-point number.

The exact money pattern is:

```text
^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$
```

### 3.2 Output rules

- Every monetary output is a GTQ decimal string with exactly two decimal places.
- Dates are returned as `YYYY-MM-DD`.
- Successful results contain deterministic English text in `content` and canonical data in `structuredContent`.
- Domain records omit `businessId`, `createdAt`, and `updatedAt`.
- The server never returns SQL, credentials, connection URLs, Prisma details, or stack traces.

### 3.3 Canonical record shapes

The tool sections reference these public shapes:

```text
MoneyResult = {
  currency: "GTQ";
  amount: string;
}

TransactionResult = {
  id: integer;
  accountId: integer;
  categoryId: integer;
  type: "INCOME" | "EXPENSE";
  amount: string;
  date: "YYYY-MM-DD";
  description: string | null;
}

DebtResult = {
  id: integer;
  description: string;
  amount: string;
  dueDate: "YYYY-MM-DD";
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "PAID";
}

ReceivableResult = {
  id: integer;
  description: string;
  amount: string;
  expectedDate: "YYYY-MM-DD";
  confidence: "CONFIRMED" | "UNCONFIRMED";
  status: "PENDING" | "COLLECTED";
}

ProductResult = {
  id: integer;
  name: string;
  stock: integer;
  unitCost: string;
  salePrice: string;
  minimumStock: integer;
}

InventoryMovementResult = {
  id: integer;
  productId: integer;
  type: "IN" | "OUT";
  quantity: integer;
  date: "YYYY-MM-DD";
  note: string | null;
}
```

## 4. Error model

Protocol and transport failures use JSON-RPC errors:

| Code | Meaning |
|---:|---|
| `-32700` | Malformed JSON. The response ID is `null`. |
| `-32600` | Invalid JSON-RPC envelope or lifecycle state. |
| `-32601` | Unknown JSON-RPC method. |
| `-32602` | Invalid MCP method parameters or unknown tool name. |
| `-32603` | Unexpected internal failure. |

An input that reaches a known tool but does not satisfy its `inputSchema` is a tool execution error, not a JSON-RPC failure:

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Tool arguments do not match the input schema: /amount must match pattern."
      }
    ],
    "isError": true
  }
}
```

Expected domain and persistence failures also return a successful JSON-RPC envelope with `isError: true`. Examples include a missing entity, an incompatible category, an inverted date range, insufficient stock, or an invalid active-business configuration.

### 4.1 Expected errors by tool

Schema violations always produce `isError: true` before a handler runs. The following domain errors are additionally relevant after schema validation:

| Tool | Expected domain errors |
|---|---|
| `record_income` | Non-positive amount, impossible date, missing account/category, or category not classified as income. |
| `record_expense` | Non-positive amount, impossible date, missing account/category, or category not classified as expense. |
| `list_transactions` | Impossible dates, inverted range, or missing filtered account/category. |
| `update_transaction` | Missing transaction/account/category, empty update, non-positive amount, impossible date, or category incompatible with the immutable transaction type. |
| `delete_transaction` | Missing transaction. |
| `record_debt` | Blank description, non-positive amount, or impossible date. |
| `list_debts` | Impossible `dueBefore` date. |
| `update_debt` | Missing debt, blank description, empty update, non-positive amount, or impossible date. |
| `mark_debt_paid` | Missing debt. |
| `delete_debt` | Missing debt. |
| `record_receivable` | Blank description, non-positive amount, or impossible date. |
| `list_receivables` | Impossible `dueBefore` date. |
| `update_receivable` | Missing receivable, blank description, empty update, non-positive amount, or impossible date. |
| `mark_receivable_collected` | Missing receivable. |
| `delete_receivable` | Missing receivable. |
| `create_product` | Blank name, negative stock/minimum, or negative cost/price. |
| `list_products` | Invalid active-business configuration. |
| `update_product` | Missing product, blank name, empty update, negative minimum, or negative cost/price. |
| `record_inventory_movement` | Missing product, impossible date, non-positive quantity, blank note, or insufficient stock. |
| `list_low_stock_products` | Invalid active-business configuration. |
| `get_current_balance` | Invalid active-business configuration or persistence failure. |
| `get_cash_flow_summary` | Impossible dates or inverted range. |
| `project_cash_flow` | Invalid horizon or invalid active-business configuration. |
| `evaluate_purchase_viability` | Non-positive amount, invalid horizon, or invalid active-business configuration. |

No error includes SQL, credentials, `DATABASE_URL`, stack traces, or internal Prisma messages.

## 5. Tool catalog

| # | Tool | Operation |
|---:|---|---|
| 1 | `record_income` | Write |
| 2 | `record_expense` | Write |
| 3 | `list_transactions` | Read |
| 4 | `update_transaction` | Write |
| 5 | `delete_transaction` | Write |
| 6 | `record_debt` | Write |
| 7 | `list_debts` | Read |
| 8 | `update_debt` | Write |
| 9 | `mark_debt_paid` | Write |
| 10 | `delete_debt` | Write |
| 11 | `record_receivable` | Write |
| 12 | `list_receivables` | Read |
| 13 | `update_receivable` | Write |
| 14 | `mark_receivable_collected` | Write |
| 15 | `delete_receivable` | Write |
| 16 | `create_product` | Write |
| 17 | `list_products` | Read |
| 18 | `update_product` | Write |
| 19 | `record_inventory_movement` | Write |
| 20 | `list_low_stock_products` | Read |
| 21 | `get_current_balance` | Read |
| 22 | `get_cash_flow_summary` | Read |
| 23 | `project_cash_flow` | Read |
| 24 | `evaluate_purchase_viability` | Read |

## 6. Domain entity map

| Tool group | Entities used |
|---|---|
| Transactions | `Business`, `Account`, `Category`, `Transaction` |
| Debts | `Business`, `Debt` |
| Receivables | `Business`, `Receivable` |
| Inventory | `Business`, `Product`, `InventoryMovement` |
| Current balance and cash flow | `Business`, `Account`, `Transaction` |
| Projection | `Business`, `Account`, `Transaction`, `FixedExpense`, `Debt`, `Receivable` |
| Purchase viability | `Business` and the projection result |

The MVP requires exactly one active business. Zero businesses and multiple businesses are controlled configuration errors; the server never selects one silently.

## 7. Executable example conventions

The examples below assume:

- MCP initialization is complete.
- The database starts from the deterministic `2026-08-08` seed.
- Each domain flow starts from a fresh copy of that seed.
- A future Host has already obtained explicit user confirmation before each write call.
- Request IDs are local to the examples.

The examples use strict JSON without comments, placeholders, or omitted fields represented by ellipses.

## 8. Transaction tools

Entities: `Business`, `Account`, `Category`, and `Transaction`.

Transaction mutations return the affected `TransactionResult` and a recalculated `MoneyResult`. Current balance is always derived from initial account balances plus income minus expenses.

### 8.1 `record_income`

Purpose: record money already received. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `accountId` | Yes | Integer, minimum `1`; account must exist. |
| `categoryId` | Yes | Integer, minimum `1`; category must be `INCOME`. |
| `amount` | Yes | Positive money string. |
| `date` | Yes | Strict `YYYY-MM-DD`. |
| `description` | No | Non-empty string after trimming. |

The service fixes `type` to `INCOME`. Relevant errors include missing account/category, incompatible category, invalid amount/date, or empty description.

```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "tools/call",
  "params": {
    "name": "record_income",
    "arguments": {
      "accountId": 1,
      "categoryId": 1,
      "amount": "100.00",
      "date": "2026-08-08",
      "description": "Demo sale"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Income recorded."
      }
    ],
    "structuredContent": {
      "transaction": {
        "id": 21,
        "accountId": 1,
        "categoryId": 1,
        "type": "INCOME",
        "amount": "100.00",
        "date": "2026-08-08",
        "description": "Demo sale"
      },
      "currentBalance": {
        "currency": "GTQ",
        "amount": "19575.00"
      }
    }
  }
}
```

### 8.2 `record_expense`

Purpose: record money already spent. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `accountId` | Yes | Integer, minimum `1`; account must exist. |
| `categoryId` | Yes | Integer, minimum `1`; category must be `EXPENSE`. |
| `amount` | Yes | Positive money string. |
| `date` | Yes | Strict `YYYY-MM-DD`. |
| `description` | No | Non-empty string after trimming. |

The service fixes `type` to `EXPENSE`. Relevant errors match `record_income`, including category compatibility.

```json
{
  "jsonrpc": "2.0",
  "id": 102,
  "method": "tools/call",
  "params": {
    "name": "record_expense",
    "arguments": {
      "accountId": 2,
      "categoryId": 4,
      "amount": "50.00",
      "date": "2026-08-08",
      "description": "Demo supplies"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 102,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Expense recorded."
      }
    ],
    "structuredContent": {
      "transaction": {
        "id": 22,
        "accountId": 2,
        "categoryId": 4,
        "type": "EXPENSE",
        "amount": "50.00",
        "date": "2026-08-08",
        "description": "Demo supplies"
      },
      "currentBalance": {
        "currency": "GTQ",
        "amount": "19525.00"
      }
    }
  }
}
```

### 8.3 `list_transactions`

Purpose: list transactions using only the supplied filters. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `startDate` | No | Inclusive strict date. |
| `endDate` | No | Inclusive strict date. |
| `type` | No | `INCOME` or `EXPENSE`. |
| `categoryId` | No | Integer, minimum `1`; category must exist. |
| `accountId` | No | Integer, minimum `1`; account must exist. |

If both dates are supplied, `startDate` must not be after `endDate`. Results are ordered by date descending, then ID descending.

```json
{
  "jsonrpc": "2.0",
  "id": 103,
  "method": "tools/call",
  "params": {
    "name": "list_transactions",
    "arguments": {
      "startDate": "2026-08-08",
      "endDate": "2026-08-08",
      "type": "INCOME",
      "categoryId": 1,
      "accountId": 1
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 103,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Transactions listed."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "transactions": [
        {
          "id": 21,
          "accountId": 1,
          "categoryId": 1,
          "type": "INCOME",
          "amount": "100.00",
          "date": "2026-08-08",
          "description": "Demo sale"
        }
      ]
    }
  }
}
```

### 8.4 `update_transaction`

Purpose: update selected fields without changing transaction type. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `transactionId` | Yes | Integer, minimum `1`; transaction must exist. |
| `accountId` | No | Integer, minimum `1`; account must exist. |
| `categoryId` | No | Integer, minimum `1`; category must match the existing type. |
| `amount` | No | Positive money string. |
| `date` | No | Strict `YYYY-MM-DD`. |
| `description` | No | Non-empty string after trimming. |

At least one optional field is required. The type cannot be changed and a description cannot be cleared with `null` or an empty string.

```json
{
  "jsonrpc": "2.0",
  "id": 104,
  "method": "tools/call",
  "params": {
    "name": "update_transaction",
    "arguments": {
      "transactionId": 21,
      "amount": "120.00",
      "description": "Updated demo sale"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 104,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Transaction updated."
      }
    ],
    "structuredContent": {
      "transaction": {
        "id": 21,
        "accountId": 1,
        "categoryId": 1,
        "type": "INCOME",
        "amount": "120.00",
        "date": "2026-08-08",
        "description": "Updated demo sale"
      },
      "currentBalance": {
        "currency": "GTQ",
        "amount": "19545.00"
      }
    }
  }
}
```

### 8.5 `delete_transaction`

Purpose: delete an existing transaction and recalculate current balance. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `transactionId` | Yes | Integer, minimum `1`; transaction must exist. |

The returned record is the transaction that was deleted.

```json
{
  "jsonrpc": "2.0",
  "id": 105,
  "method": "tools/call",
  "params": {
    "name": "delete_transaction",
    "arguments": {
      "transactionId": 22
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 105,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Transaction deleted."
      }
    ],
    "structuredContent": {
      "transaction": {
        "id": 22,
        "accountId": 2,
        "categoryId": 4,
        "type": "EXPENSE",
        "amount": "50.00",
        "date": "2026-08-08",
        "description": "Demo supplies"
      },
      "currentBalance": {
        "currency": "GTQ",
        "amount": "19595.00"
      }
    }
  }
}
```

## 9. Debt tools

Entities: `Business` and `Debt`. A debt is a future obligation; it does not affect current balance and paying it does not create an expense transaction.

### 9.1 `record_debt`

Purpose: record a future obligation. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `description` | Yes | Non-empty string after trimming. |
| `amount` | Yes | Positive money string. |
| `dueDate` | Yes | Strict `YYYY-MM-DD`. |
| `priority` | Yes | `LOW`, `MEDIUM`, or `HIGH`. |

The service always creates the debt with status `PENDING`.

```json
{
  "jsonrpc": "2.0",
  "id": 201,
  "method": "tools/call",
  "params": {
    "name": "record_debt",
    "arguments": {
      "description": "Demo obligation",
      "amount": "500.00",
      "dueDate": "2026-09-01",
      "priority": "LOW"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 201,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Debt recorded."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "debt": {
        "id": 3,
        "description": "Demo obligation",
        "amount": "500.00",
        "dueDate": "2026-09-01",
        "priority": "LOW",
        "status": "PENDING"
      }
    }
  }
}
```

### 9.2 `list_debts`

Purpose: list debts using optional filters. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `status` | No | `PENDING` or `PAID`. |
| `priority` | No | `LOW`, `MEDIUM`, or `HIGH`. |
| `dueBefore` | No | Inclusive strict date. |

Results are ordered by due date ascending, then ID ascending.

```json
{
  "jsonrpc": "2.0",
  "id": 202,
  "method": "tools/call",
  "params": {
    "name": "list_debts",
    "arguments": {
      "status": "PENDING",
      "priority": "LOW",
      "dueBefore": "2026-09-01"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 202,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Debts listed."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "debts": [
        {
          "id": 3,
          "description": "Demo obligation",
          "amount": "500.00",
          "dueDate": "2026-09-01",
          "priority": "LOW",
          "status": "PENDING"
        }
      ]
    }
  }
}
```

### 9.3 `update_debt`

Purpose: update selected debt fields. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `debtId` | Yes | Integer, minimum `1`; debt must exist. |
| `description` | No | Non-empty string after trimming. |
| `amount` | No | Positive money string. |
| `dueDate` | No | Strict `YYYY-MM-DD`. |
| `priority` | No | `LOW`, `MEDIUM`, or `HIGH`. |

At least one optional field is required. Status cannot be changed through this tool.

```json
{
  "jsonrpc": "2.0",
  "id": 203,
  "method": "tools/call",
  "params": {
    "name": "update_debt",
    "arguments": {
      "debtId": 3,
      "amount": "550.00",
      "priority": "MEDIUM"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 203,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Debt updated."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "debt": {
        "id": 3,
        "description": "Demo obligation",
        "amount": "550.00",
        "dueDate": "2026-09-01",
        "priority": "MEDIUM",
        "status": "PENDING"
      }
    }
  }
}
```

### 9.4 `mark_debt_paid`

Purpose: change a debt from `PENDING` to `PAID`. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `debtId` | Yes | Integer, minimum `1`; debt must exist. |

Calling this tool again for an already paid debt is an idempotent success. It never creates an expense transaction.

```json
{
  "jsonrpc": "2.0",
  "id": 204,
  "method": "tools/call",
  "params": {
    "name": "mark_debt_paid",
    "arguments": {
      "debtId": 3
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 204,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Debt marked as paid."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "debt": {
        "id": 3,
        "description": "Demo obligation",
        "amount": "550.00",
        "dueDate": "2026-09-01",
        "priority": "MEDIUM",
        "status": "PAID"
      }
    }
  }
}
```

### 9.5 `delete_debt`

Purpose: delete an existing debt. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `debtId` | Yes | Integer, minimum `1`; debt must exist. |

The response contains the deleted `DebtResult`.

```json
{
  "jsonrpc": "2.0",
  "id": 205,
  "method": "tools/call",
  "params": {
    "name": "delete_debt",
    "arguments": {
      "debtId": 3
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 205,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Debt deleted."
      }
    ],
    "structuredContent": {
      "currency": "GTQ",
      "debt": {
        "id": 3,
        "description": "Demo obligation",
        "amount": "550.00",
        "dueDate": "2026-09-01",
        "priority": "MEDIUM",
        "status": "PAID"
      }
    }
  }
}
```

## 10. Receivable tools

The examples in this section form one sequence that starts from the canonical seed.

### 10.1 `record_receivable`

Purpose: record money expected from a customer or other party. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `description` | Yes | Non-empty string after trimming. |
| `amount` | Yes | Positive money string. |
| `expectedDate` | Yes | Strict `YYYY-MM-DD`. |
| `confidence` | Yes | `CONFIRMED` or `UNCONFIRMED`. |

New receivables always start as `PENDING`. Recording one does not create an income transaction.

```json
{
  "jsonrpc": "2.0",
  "id": 301,
  "method": "tools/call",
  "params": {
    "name": "record_receivable",
    "arguments": {
      "description": "Demo receivable",
      "amount": "600.00",
      "expectedDate": "2026-09-01",
      "confidence": "UNCONFIRMED"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 301,
  "result": {
    "content": [{ "type": "text", "text": "Receivable recorded." }],
    "structuredContent": {
      "currency": "GTQ",
      "receivable": {
        "id": 3,
        "description": "Demo receivable",
        "amount": "600.00",
        "expectedDate": "2026-09-01",
        "confidence": "UNCONFIRMED",
        "status": "PENDING"
      }
    }
  }
}
```

### 10.2 `list_receivables`

Purpose: list receivables using optional filters. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `status` | No | `PENDING` or `COLLECTED`. |
| `confidence` | No | `CONFIRMED` or `UNCONFIRMED`. |
| `dueBefore` | No | Inclusive strict date. |

Results are ordered by expected date ascending, then ID ascending.

```json
{
  "jsonrpc": "2.0",
  "id": 302,
  "method": "tools/call",
  "params": {
    "name": "list_receivables",
    "arguments": {
      "status": "PENDING",
      "confidence": "UNCONFIRMED",
      "dueBefore": "2026-09-01"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 302,
  "result": {
    "content": [{ "type": "text", "text": "Receivables listed." }],
    "structuredContent": {
      "currency": "GTQ",
      "receivables": [
        {
          "id": 2,
          "description": "Pedido especial",
          "amount": "1800.00",
          "expectedDate": "2026-08-28",
          "confidence": "UNCONFIRMED",
          "status": "PENDING"
        },
        {
          "id": 3,
          "description": "Demo receivable",
          "amount": "600.00",
          "expectedDate": "2026-09-01",
          "confidence": "UNCONFIRMED",
          "status": "PENDING"
        }
      ]
    }
  }
}
```

### 10.3 `update_receivable`

Purpose: update selected receivable fields. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `receivableId` | Yes | Integer, minimum `1`; receivable must exist. |
| `description` | No | Non-empty string after trimming. |
| `amount` | No | Positive money string. |
| `expectedDate` | No | Strict `YYYY-MM-DD`. |
| `confidence` | No | `CONFIRMED` or `UNCONFIRMED`. |

At least one optional field is required. Status cannot be changed through this tool.

```json
{
  "jsonrpc": "2.0",
  "id": 303,
  "method": "tools/call",
  "params": {
    "name": "update_receivable",
    "arguments": {
      "receivableId": 3,
      "amount": "650.00",
      "confidence": "CONFIRMED"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 303,
  "result": {
    "content": [{ "type": "text", "text": "Receivable updated." }],
    "structuredContent": {
      "currency": "GTQ",
      "receivable": {
        "id": 3,
        "description": "Demo receivable",
        "amount": "650.00",
        "expectedDate": "2026-09-01",
        "confidence": "CONFIRMED",
        "status": "PENDING"
      }
    }
  }
}
```

### 10.4 `mark_receivable_collected`

Purpose: change a receivable from `PENDING` to `COLLECTED`. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `receivableId` | Yes | Integer, minimum `1`; receivable must exist. |

Calling this tool again for an already collected receivable is an idempotent success. It never creates an income transaction.

```json
{
  "jsonrpc": "2.0",
  "id": 304,
  "method": "tools/call",
  "params": {
    "name": "mark_receivable_collected",
    "arguments": { "receivableId": 3 }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 304,
  "result": {
    "content": [{ "type": "text", "text": "Receivable marked as collected." }],
    "structuredContent": {
      "currency": "GTQ",
      "receivable": {
        "id": 3,
        "description": "Demo receivable",
        "amount": "650.00",
        "expectedDate": "2026-09-01",
        "confidence": "CONFIRMED",
        "status": "COLLECTED"
      }
    }
  }
}
```

### 10.5 `delete_receivable`

Purpose: delete an existing receivable. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `receivableId` | Yes | Integer, minimum `1`; receivable must exist. |

The response contains the deleted `ReceivableResult`.

```json
{
  "jsonrpc": "2.0",
  "id": 305,
  "method": "tools/call",
  "params": {
    "name": "delete_receivable",
    "arguments": { "receivableId": 3 }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 305,
  "result": {
    "content": [{ "type": "text", "text": "Receivable deleted." }],
    "structuredContent": {
      "currency": "GTQ",
      "receivable": {
        "id": 3,
        "description": "Demo receivable",
        "amount": "650.00",
        "expectedDate": "2026-09-01",
        "confidence": "CONFIRMED",
        "status": "COLLECTED"
      }
    }
  }
}
```

## 11. Inventory tools

The examples in this section form one sequence that starts from the canonical seed.

### 11.1 `create_product`

Purpose: create a basic inventory product. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `name` | Yes | Non-empty string after trimming. |
| `stock` | Yes | Integer, minimum `0`. |
| `unitCost` | Yes | Non-negative money string. |
| `salePrice` | Yes | Non-negative money string. |
| `minimumStock` | Yes | Integer, minimum `0`. |

Initial stock does not create a synthetic inventory movement.

```json
{
  "jsonrpc": "2.0",
  "id": 401,
  "method": "tools/call",
  "params": {
    "name": "create_product",
    "arguments": {
      "name": "Demo product",
      "stock": 2,
      "unitCost": "1.25",
      "salePrice": "2.00",
      "minimumStock": 5
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 401,
  "result": {
    "content": [{ "type": "text", "text": "Product created." }],
    "structuredContent": {
      "currency": "GTQ",
      "product": {
        "id": 6,
        "name": "Demo product",
        "stock": 2,
        "unitCost": "1.25",
        "salePrice": "2.00",
        "minimumStock": 5
      }
    }
  }
}
```

### 11.2 `list_products`

Purpose: list all products or only products at or below minimum stock. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `lowStockOnly` | No | Boolean; defaults to `false` when omitted. |

Results are ordered by name, then ID.

```json
{
  "jsonrpc": "2.0",
  "id": 402,
  "method": "tools/call",
  "params": {
    "name": "list_products",
    "arguments": { "lowStockOnly": true }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 402,
  "result": {
    "content": [{ "type": "text", "text": "Products listed." }],
    "structuredContent": {
      "currency": "GTQ",
      "products": [
        { "id": 6, "name": "Demo product", "stock": 2, "unitCost": "1.25", "salePrice": "2.00", "minimumStock": 5 },
        { "id": 2, "name": "Frijol 1 lb", "stock": 8, "unitCost": "6.00", "salePrice": "9.00", "minimumStock": 10 },
        { "id": 5, "name": "Leche 1 L", "stock": 4, "unitCost": "8.00", "salePrice": "11.00", "minimumStock": 6 }
      ]
    }
  }
}
```

### 11.3 `update_product`

Purpose: update selected product fields without changing stock. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `productId` | Yes | Integer, minimum `1`; product must exist. |
| `name` | No | Non-empty string after trimming. |
| `unitCost` | No | Non-negative money string. |
| `salePrice` | No | Non-negative money string. |
| `minimumStock` | No | Integer, minimum `0`. |

At least one optional field is required. Stock is intentionally not accepted.

```json
{
  "jsonrpc": "2.0",
  "id": 403,
  "method": "tools/call",
  "params": {
    "name": "update_product",
    "arguments": {
      "productId": 6,
      "salePrice": "2.50",
      "minimumStock": 3
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 403,
  "result": {
    "content": [{ "type": "text", "text": "Product updated." }],
    "structuredContent": {
      "currency": "GTQ",
      "product": {
        "id": 6,
        "name": "Demo product",
        "stock": 2,
        "unitCost": "1.25",
        "salePrice": "2.50",
        "minimumStock": 3
      }
    }
  }
}
```

### 11.4 `record_inventory_movement`

Purpose: atomically record a movement and adjust product stock. Operation: **Write**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `productId` | Yes | Integer, minimum `1`; product must exist. |
| `type` | Yes | `IN` or `OUT`. |
| `quantity` | Yes | Integer, minimum `1`. |
| `date` | Yes | Strict `YYYY-MM-DD`. |
| `note` | No | Non-empty string after trimming. |

`IN` increases stock and `OUT` decreases it. Insufficient stock returns an expected error without creating a movement or changing stock.

```json
{
  "jsonrpc": "2.0",
  "id": 404,
  "method": "tools/call",
  "params": {
    "name": "record_inventory_movement",
    "arguments": {
      "productId": 6,
      "type": "IN",
      "quantity": 3,
      "date": "2026-08-08",
      "note": "Demo restock"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 404,
  "result": {
    "content": [{ "type": "text", "text": "Inventory movement recorded." }],
    "structuredContent": {
      "currency": "GTQ",
      "product": {
        "id": 6,
        "name": "Demo product",
        "stock": 5,
        "unitCost": "1.25",
        "salePrice": "2.50",
        "minimumStock": 3
      },
      "movement": {
        "id": 11,
        "productId": 6,
        "type": "IN",
        "quantity": 3,
        "date": "2026-08-08",
        "note": "Demo restock"
      }
    }
  }
}
```

### 11.5 `list_low_stock_products`

Purpose: list products whose stock is less than or equal to their minimum. Operation: **Read**.

This tool has no parameters. It accepts only `{}` or omitted arguments.

```json
{
  "jsonrpc": "2.0",
  "id": 405,
  "method": "tools/call",
  "params": {
    "name": "list_low_stock_products",
    "arguments": {}
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 405,
  "result": {
    "content": [{ "type": "text", "text": "Low-stock products listed." }],
    "structuredContent": {
      "currency": "GTQ",
      "products": [
        { "id": 2, "name": "Frijol 1 lb", "stock": 8, "unitCost": "6.00", "salePrice": "9.00", "minimumStock": 10 },
        { "id": 5, "name": "Leche 1 L", "stock": 4, "unitCost": "8.00", "salePrice": "11.00", "minimumStock": 6 }
      ]
    }
  }
}
```

## 12. Balance and cash-flow tools

These examples are independent read operations against the canonical seed.

### 12.1 `get_current_balance`

Purpose: return the current derived balance and its account breakdown. Operation: **Read**.

This tool has no parameters. It accepts only `{}` or omitted arguments.

The Finance MCP derives, but never stores, balances:

```text
accountBalance = initialBalance + accountIncome - accountExpenses
currentBalance = sum(account balances)
```

Debts, receivables, and fixed expenses do not change the current balance.

```json
{
  "jsonrpc": "2.0",
  "id": 501,
  "method": "tools/call",
  "params": {
    "name": "get_current_balance",
    "arguments": {}
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 501,
  "result": {
    "content": [{ "type": "text", "text": "Current balance retrieved." }],
    "structuredContent": {
      "currency": "GTQ",
      "currentBalance": "19475.00",
      "totalIncome": "13425.00",
      "totalExpenses": "8950.00",
      "accounts": [
        {
          "id": 2,
          "name": "Banco",
          "type": "BANK",
          "initialBalance": "12000.00",
          "income": "8350.00",
          "expenses": "7650.00",
          "balance": "12700.00"
        },
        {
          "id": 1,
          "name": "Efectivo",
          "type": "CASH",
          "initialBalance": "3000.00",
          "income": "5075.00",
          "expenses": "1300.00",
          "balance": "6775.00"
        }
      ]
    }
  }
}
```

### 12.2 `get_cash_flow_summary`

Purpose: summarize transaction cash flow for an inclusive date range. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `startDate` | Yes | Strict `YYYY-MM-DD`; inclusive. |
| `endDate` | Yes | Strict `YYYY-MM-DD`; inclusive and not earlier than `startDate`. |

`netCashFlow = income - expenses`. `currentBalance` is the current balance at query time, not a historical closing balance for the range.

```json
{
  "jsonrpc": "2.0",
  "id": 502,
  "method": "tools/call",
  "params": {
    "name": "get_cash_flow_summary",
    "arguments": {
      "startDate": "2026-08-01",
      "endDate": "2026-08-08"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 502,
  "result": {
    "content": [{ "type": "text", "text": "Cash-flow summary retrieved." }],
    "structuredContent": {
      "currency": "GTQ",
      "startDate": "2026-08-01",
      "endDate": "2026-08-08",
      "income": "3050.00",
      "expenses": "3950.00",
      "netCashFlow": "-900.00",
      "transactionCount": 5,
      "currentBalance": "19475.00"
    }
  }
}
```

## 13. Projection tool

### 13.1 `project_cash_flow`

Purpose: calculate deterministic safe and potential balances for a future horizon. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `horizonDays` | Yes | Integer; exactly `7` or `30`. |

Production obtains `asOfDate` from the current UTC date. The request never accepts an `asOfDate`. The included window is:

```text
asOfDate < includedDate <= asOfDate + horizonDays
```

Only `PENDING` debts and receivables participate. `CONFIRMED` receivables affect the safe scenario; `UNCONFIRMED` receivables affect only the potential scenario. Active fixed expenses use their next monthly due date, and due days 29–31 are clamped to the month's final valid day.

```text
safeProjectedBalance = currentBalance + confirmedReceivables - fixedExpenses - pendingDebts
potentialProjectedBalance = safeProjectedBalance + unconfirmedReceivables
```

For reproducibility, this example uses the integration-test clock `2026-08-08`. Production still uses the current UTC date.

```json
{
  "jsonrpc": "2.0",
  "id": 601,
  "method": "tools/call",
  "params": {
    "name": "project_cash_flow",
    "arguments": { "horizonDays": 30 }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 601,
  "result": {
    "content": [{ "type": "text", "text": "Cash-flow projection retrieved." }],
    "structuredContent": {
      "currency": "GTQ",
      "asOfDate": "2026-08-08",
      "throughDate": "2026-09-07",
      "horizonDays": 30,
      "currentBalance": "19475.00",
      "confirmedReceivables": "3200.00",
      "unconfirmedReceivables": "1800.00",
      "fixedExpenses": "3150.00",
      "pendingDebts": "3050.00",
      "safeProjectedBalance": "16475.00",
      "potentialProjectedBalance": "18275.00",
      "details": {
        "confirmedReceivables": [
          {
            "id": 1,
            "description": "Pedido corporativo",
            "amount": "3200.00",
            "expectedDate": "2026-08-15",
            "confidence": "CONFIRMED",
            "status": "PENDING"
          }
        ],
        "unconfirmedReceivables": [
          {
            "id": 2,
            "description": "Pedido especial",
            "amount": "1800.00",
            "expectedDate": "2026-08-28",
            "confidence": "UNCONFIRMED",
            "status": "PENDING"
          }
        ],
        "fixedExpenses": [
          {
            "id": 1,
            "categoryId": 5,
            "name": "Alquiler",
            "amount": "2500.00",
            "dueDay": 5,
            "dueDate": "2026-09-05"
          },
          {
            "id": 2,
            "categoryId": 6,
            "name": "Internet y energía",
            "amount": "650.00",
            "dueDay": 10,
            "dueDate": "2026-08-10"
          }
        ],
        "pendingDebts": [
          {
            "id": 1,
            "description": "Proveedor de inventario",
            "amount": "2200.00",
            "dueDate": "2026-08-12",
            "priority": "HIGH",
            "status": "PENDING"
          },
          {
            "id": 2,
            "description": "Mantenimiento de equipo",
            "amount": "850.00",
            "dueDate": "2026-08-25",
            "priority": "MEDIUM",
            "status": "PENDING"
          }
        ]
      }
    }
  }
}
```

## 14. Purchase viability tool

### 14.1 `evaluate_purchase_viability`

Purpose: determine whether a proposed purchase preserves the configured minimum safety balance. Operation: **Read**.

| Parameter | Required | Type and restrictions |
|---|---|---|
| `purchaseAmount` | Yes | Positive money string. |
| `horizonDays` | Yes | Integer; exactly `7` or `30`. |

This tool reuses `project_cash_flow`; it does not duplicate projection rules or modify data.

```text
safeBalanceAfterPurchase = safeProjectedBalance - purchaseAmount
potentialBalanceAfterPurchase = potentialProjectedBalance - purchaseAmount
maximumSafePurchase = max(0, safeProjectedBalance - minimumSafetyBalance)
```

Classification uses inclusive boundaries:

- `VIABLE`: the safe balance after purchase is at least the minimum.
- `VIABLE_WITH_RISK`: only the potential balance after purchase reaches the minimum.
- `NOT_VIABLE`: even the potential balance after purchase is below the minimum.

The LLM neither calculates nor changes these values. For reproducibility, this example uses the integration-test clock `2026-08-08`.

```json
{
  "jsonrpc": "2.0",
  "id": 701,
  "method": "tools/call",
  "params": {
    "name": "evaluate_purchase_viability",
    "arguments": {
      "purchaseAmount": "14975.00",
      "horizonDays": 30
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 701,
  "result": {
    "content": [{ "type": "text", "text": "Purchase viability evaluated." }],
    "structuredContent": {
      "currency": "GTQ",
      "asOfDate": "2026-08-08",
      "throughDate": "2026-09-07",
      "horizonDays": 30,
      "currentBalance": "19475.00",
      "purchaseAmount": "14975.00",
      "confirmedReceivables": "3200.00",
      "unconfirmedReceivables": "1800.00",
      "fixedExpenses": "3150.00",
      "pendingDebts": "3050.00",
      "safeProjectedBalance": "16475.00",
      "potentialProjectedBalance": "18275.00",
      "minimumSafetyBalance": "1500.00",
      "safeBalanceAfterPurchase": "1500.00",
      "potentialBalanceAfterPurchase": "3300.00",
      "maximumSafePurchase": "14975.00",
      "status": "VIABLE"
    }
  }
}
```

## 15. Write confirmation boundary

The 15 tools classified as **Write** require explicit user confirmation in the Host before `tools/call`. The Host must present and confirm the exact arguments that will be sent. Finance MCP performs deterministic validation and execution; it does not conduct a confirmation conversation.

The nine **Read** tools do not require confirmation. Every direct write example in this document represents an already authorized call. `isWriteOperation` is registry metadata for Host orchestration and is never exposed through MCP `tools/list`.

## 16. MVP boundaries

The local Finance MCP intentionally excludes:

- authentication, multiple users, and multiple businesses;
- bank integration;
- invoicing, taxes, and double-entry accounting;
- formal customer and supplier management;
- partial payments and partial collections;
- automatic transaction creation when debts are paid or receivables are collected;
- automatic monthly comparisons, statistical anomaly detection, and break-even analysis;
- machine-learning forecasts;
- scheduled summaries;
- purchase orders;
- advanced inventory features such as lots, SKUs, or barcodes;
- automatic minimum-safety-balance optimization;
- autonomous agents, recursive tool planning, and permanent conversational memory.

These are deliberate MVP limits, not undocumented capabilities.
