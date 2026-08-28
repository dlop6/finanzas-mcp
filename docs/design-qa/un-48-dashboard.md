# UN-48 dashboard design QA

## Objective

Verify that the read-only financial dashboard makes the current financial state easy to scan, retains the established neobrutalist product language, and keeps the chat available without losing its in-page state.

## Visual direction

The review extends the existing warm canvas, white paper surfaces, 2 px black borders, solid offset shadows, heavy Geist headings, and teal/yellow/pink semantic accents. The supplied neobrutalist reference informed the visual language only; no portfolio composition, illustrations, stickers, or assets were copied.

## HCI checks

- Visibility of system status: skeleton loading, explicit update state, last successful update, and safe partial-error feedback.
- Match with the real world: Spanish financial labels, GTQ display, and Guatemala calendar dates.
- Control and freedom: manual refresh, account disclosure, expandable lists, and keyboard-operable tabs.
- Recognition rather than recall: persistent period labels, named projection fields, and visible currency.
- Error recovery: independent section failures retain the other usable information and offer a global retry.
- Progressive disclosure: each attention list initially shows five MCP-ordered records.

## Reviewed states and evidence

The current local implementation was reviewed in the browser at desktop layout (1280 × 720 during the interaction check). The responsive grid rules were additionally inspected for the required desktop, tablet, and mobile breakpoints.

| State | Result |
| --- | --- |
| Initial dashboard loading | Skeletons have no synthetic financial values and expose `aria-busy`. |
| Complete dashboard | KPI cards, projections, pending lists, and manual refresh are visible and ordered. |
| Tab navigation | Arrow and Home navigation work; the dashboard is selected initially. |
| Dashboard → Chat → Dashboard | The chat draft remains mounted and is preserved. |
| Exact money | Decimal strings appear as `GTQ 19,475.00` without numeric conversion. |
| Keyboard/focus | Tab controls and action controls have visible focus treatments. |
| Visual hierarchy | A duplicate page heading found during review was corrected; the workspace now has exactly one `h1`. |

No screenshot or runtime data was added to version control. Browser captures used during the local review remain local.

## Accessibility review

- One page `h1`; dashboard sections use subordinate headings.
- Tabs use the WAI-ARIA tablist, tab, and tabpanel pattern.
- Errors use alert semantics and loading uses `aria-busy`.
- Interactive targets are at least 44 px high in the supplied styles.
- Motion is reduced for users requesting reduced motion.
- Tables are not used for dense financial visualization; code or lists cannot force page-wide horizontal scrolling.

## Findings

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | The initial dashboard heading duplicated the page `h1`. | Changed it to `h2` and verified one `h1` in the rendered page. |
| P2 | A direct state update from the initial dashboard effect triggered a React lint violation. | Initial loading now resolves asynchronously before state is updated; manual refresh remains explicit. |
| P3 | Narrow-layout rendering could not be captured from the available browser viewport controller. | CSS breakpoints were inspected and automated component coverage verifies disclosure and tab behavior. |

final result: passed
