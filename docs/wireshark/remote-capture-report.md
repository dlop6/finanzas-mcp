# Remote Finance MCP capture report

## Scope

This report records a local, read-only validation of the public Finance MCP endpoint. The temporary probe is not the remote Host client; that integration remains outside this validation.

- Endpoint: `https://finanzas-mcp-server.onrender.com/mcp`
- Capture date: 2026-08-25 UTC
- MCP protocol version: `2025-11-25`
- Capture interface: Wi-Fi (`6`)
- Capture SHA-256: `ac8bafa179c1774c666c7478eb3fcfef39fb95c9295ab5ca4ddde702bddae926`

The `.pcapng` capture and its TLS key log are local, ignored artifacts. This document deliberately omits their paths, session identifiers, full JSON-RPC payloads, response bodies, and TLS key material.

## Procedure

The capture was generated with:

```powershell
npm run wireshark:remote:capture -- --interface 6 https://finanzas-mcp-server.onrender.com/mcp
```

The probe completed this read-only sequence:

1. `initialize` (JSON-RPC ID 1)
2. `notifications/initialized` (notification, no ID)
3. `tools/list` (JSON-RPC ID 2; 24 tools validated)
4. `tools/call` for `get_current_balance` (JSON-RPC ID 3)
5. `DELETE /mcp` to close the MCP session

No finance write tool was sent.

## Encrypted observation

Before loading the TLS key log, these Wireshark filters identified the connection:

```text
tcp.port == 443
tls.handshake.extensions_server_name contains "finanzas-mcp-server.onrender.com"
ip.addr == 216.24.57.7
```

Observed layers were Wi-Fi/Ethernet link, IPv4, TCP, TLS, and encrypted TLS Application Data. The client was `192.168.1.38`; the remote endpoint was `216.24.57.7:443`. No HTTP request was readable before the local TLS key log was configured.

## Local TLS decryption

In Wireshark, configure **Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename** with the local key-log file, then use:

```text
http
tcp.stream == <matching stream>
```

With the local key log loaded, the capture showed five HTTP requests on `/mcp`: four `POST` requests followed by `DELETE`. The HTTP responses were `200`, `202`, `200`, `200`, and `204`, matching the lifecycle, discovery, read-only call, and session closure sequence above.

## Limits and cleanup

The TLS key log makes this one client-side capture decryptable; it does not expose a server private key and must remain local. Delete the capture and key log after review. This report does not validate a remote Host, authentication, or any write operation.
