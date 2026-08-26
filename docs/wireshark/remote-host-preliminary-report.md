# Preliminary remote Host MCP capture

## Scope

This is the UN-44 preliminary evidence for the production Host remote client from UN-42. It is separate from the temporary HTTP probe documented in `remote-capture-report.md` and is not the final capture planned for UN-55.

- Endpoint: `https://finanzas-mcp-server.onrender.com/mcp`
- Capture date: 2026-08-26 UTC
- MCP protocol: `2025-11-25`
- Transport: Streamable HTTP over TLS
- Interface: Wi-Fi (`6`)
- Remote IP: `216.24.57.15:443`
- Capture SHA-256: `b93afc4830dbed9bb3a865a70543d30b0340c3cb9bb6e5a8ddbd4d354a4d8b8f`

The `.pcapng`, TLS key log, TShark logs, and Host-log summary are local ignored artifacts. This report does not include session IDs, headers, JSON-RPC payloads, or financial results.

## Reproduction

```powershell
npm run wireshark:host-remote:capture -- --interface 6 https://finanzas-mcp-server.onrender.com/mcp
```

The launcher resolves the public endpoint and captures only its TCP `443` traffic. The Host client completes its normal lifecycle, discovers 24 tools, calls only `get_current_balance`, and closes the MCP session.

The capture filter observed for this run was:

```text
tcp port 443 and (host 216.24.57.15)
```

## Encrypted observation

Before loading the local key log, these filters locate the connection:

```text
tcp.port == 443
tls.handshake.extensions_server_name contains "finanzas-mcp-server.onrender.com"
ip.addr == 216.24.57.15
```

The capture showed TLS handshake traffic and encrypted Application Data. JSON-RPC was not readable without the client-side key log.

## Decrypted correlation

Configure Wireshark at **Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename** using the local key log. The relevant HTTP frames were:

| Frames | HTTP | Correlated Host interaction | Status |
|---|---|---|---:|
| 11 / 13 | `POST /mcp` | `initialize`, JSON-RPC ID 1 | 200 |
| 14 / 16 | `POST /mcp` | `notifications/initialized` | 202 |
| 25 / 29 | `POST /mcp` | `tools/list`, JSON-RPC ID 2 | 200 |
| 31 / 33 | `POST /mcp` | `tools/call` `get_current_balance`, JSON-RPC ID 3 | 200 |
| 34 / 36 | `DELETE /mcp` | MCP session close | 204 |

The lifecycle and close requests used TCP stream `0`; `tools/list` used TCP stream `1`. The safe Host-log summary matched the method names, IDs, request/response direction, and `STREAMABLE_HTTP` transport. Exactly 24 tools were discovered and classified as 15 writes and 9 reads. `get_current_balance` was the only tool call; no finance write tool was sent.

Useful display filters after decryption:

```text
http.request or http.response
tcp.stream == 0
tcp.stream == 1
```

## Limits and cleanup

This capture validates the reproducibility of the Host-to-Render path only. It does not validate authentication, DeepSeek, writes, load behavior, browser UI, or the final Phase 8 evidence. The TLS key log was deleted after this analysis; the ignored capture remains local and is linked to this report only by its SHA-256 hash.
