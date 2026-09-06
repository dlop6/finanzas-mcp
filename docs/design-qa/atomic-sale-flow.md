# Atomic sale flow

## Scope

The sale confirmation combines one financial income and the required inventory exits in one visible operation. The review table identifies products, quantities, applied prices, price origin, and amounts. The account, income category, date, and collected amount remain visible before confirmation.

## HCI checks

- A catalog price is identified as the default price source.
- An explicit unit or line override is identified without changing the catalog price.
- The confirmation text states both effects and the all-or-nothing result.
- The confirm button has no automatic focus. The confirmation heading receives focus when the operation becomes actionable.
- The table has a caption and column headers. Horizontal movement is contained within the table wrapper on small screens.
- Cancellation produces no write. A rejected sale explains that neither the inventory nor the income changed.
- Re-submitting the unchanged failed message reuses its transcript entry. Editing it creates a new entry so prior intent remains visible.

## Validation limits

The review covers the implemented desktop, tablet, and mobile layout rules, keyboard semantics, and text states. It does not assert a remote write because the remote smoke remains read-only.

final result: passed
