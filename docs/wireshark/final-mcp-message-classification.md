# Final MCP and JSON-RPC message classification

## Evidence scope

This document classifies the final UN-55 Host-to-remote Finance MCP session. It uses the local final capture, its temporary local TLS key log, and the safe Host-log summary. It deliberately omits complete JSON-RPC bodies, HTTP headers, MCP session identifiers, probe UUIDs, and financial values.

- Capture SHA-256: `0514c9bf96b8872efe3c83c14e1ed74dc9be7ab6d8d67f0a4887fc36073f943d`
- Transport: Streamable HTTP MCP `2025-11-25` over HTTP/1.1 and TLS
- Host-log transport label: `STREAMABLE_HTTP`
- Final-capture metadata: `remote-host-final-capture.md`

Without the local TLS key log, the packets contain encrypted TLS Application Data and neither HTTP nor JSON-RPC is readable. The classification below combines the decrypted HTTP frame sequence with the safe Host summary, which preserves method names, JSON-RPC IDs, directions, and lifecycle context without retaining sensitive payloads.

## Classification table

| Frames | TCP stream | HTTP evidence | MCP / JSON-RPC interaction | JSON-RPC ID | Classification |
|---|---:|---|---|---:|---|
| 13 / 15 | 0 | `POST /mcp` / `200` | `initialize` | 1 | Lifecycle JSON-RPC request and correlated response |
| 16 / 18 | 0 | `POST /mcp` / `202` | `notifications/initialized` | — | Lifecycle JSON-RPC notification and HTTP acceptance |
| 31 / 35 | 1 | `POST /mcp` / `200` | `tools/list` | 2 | Discovery JSON-RPC request and correlated response |
| 37 / 39 | 0 | `POST /mcp` / `200` | `tools/call` for `get_current_balance` | 3 | Tool JSON-RPC request and correlated response |
| 40 / 42 | 0 | `DELETE /mcp` / `204` | MCP session closure | — | Streamable HTTP transport management, not JSON-RPC |

## Classification rules applied to this session

- **Lifecycle:** `initialize`, its ID `1` response, and `notifications/initialized` establish the MCP session before discovery.
- **JSON-RPC request:** `initialize`, `tools/list`, and `tools/call` contain a method and a request ID. Each is sent from the Host to Finance MCP.
- **JSON-RPC response:** the `200` responses for IDs `1`, `2`, and `3` are correlated with their request by the same ID in the safe Host summary.
- **JSON-RPC notification:** `notifications/initialized` has no ID. Its `202` is an HTTP acceptance response, not a JSON-RPC response body.
- **Discovery:** `tools/list` is a protocol request, not a tool execution. Its response was validated by the Host as exactly 24 tools: 15 writes and 9 reads.
- **Tool execution:** the only `tools/call` is `get_current_balance`. It is a read operation; no finance write tool appears in the capture or Host summary.
- **Transport closure:** `DELETE /mcp` and its `204` close the remote MCP session. They are HTTP-level session management and do not carry a JSON-RPC request ID.

## Correlation and limits

The safe Host summary records `initialize`, `notifications/initialized`, and `tools/list` under the `HOST` context. It records the one `tools/call` under the alias `PROBE_SESSION`. The alias intentionally replaces the runtime UUID. Method order, request/response direction, IDs, and `STREAMABLE_HTTP` match the decrypted HTTP sequence.

This evidence demonstrates one successful, read-only protocol session. It does not demonstrate writes, errors, DeepSeek participation, direct PostgreSQL traffic, SSE, HTTP/2, or data outside the selected capture. The subsequent layer analysis is documented in `final-remote-layer-analysis.md`.
