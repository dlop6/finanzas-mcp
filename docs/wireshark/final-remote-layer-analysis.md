# Final remote communication layer analysis

## Evidence and method

This UN-57 analysis is based on the final UN-55 capture, its temporary local TLS key log, and the message classification in `final-mcp-message-classification.md`. The capture has 48 packets, uses `ether` encapsulation, and lasts `3.470840` seconds. Its SHA-256 is `0514c9bf96b8872efe3c83c14e1ed74dc9be7ab6d8d67f0a4887fc36073f943d`.

Two evidence modes were used:

- **Encrypted capture:** TCP, TLS handshakes, SNI, and encrypted Application Data are observable without keys.
- **Local decryption:** the Node-generated NSS key log permits local inspection of HTTP metadata and correlation with the safe Host summary. The key, capture, raw payloads, headers, session identifiers, and complete MAC addresses are not versioned.

## Link layer

The capture was made through the active Wi-Fi interface selected as index `6` for the UN-55 run. Npcap exposes the captured frames to TShark with Ethernet encapsulation (`ether`), so the capture shows Ethernet II framing rather than raw IEEE 802.11 headers. Frame `1` is the first client-to-gateway Ethernet frame and carries IPv4. The capture contains 48 frames in this representation.

The local host and next-hop MAC addresses are observable in the local artifact but are intentionally omitted here. Consequently, this evidence supports Ethernet framing and local next-hop delivery; it does not demonstrate Wi-Fi management or radio-layer behavior.

## Network layer

The observed IPv4 endpoints are:

| Direction | Source | Destination | Observed TTL |
|---|---|---|---:|
| Host to Render | `192.168.1.38` | `216.24.57.15` | 128 |
| Render to Host, stream 0 | `216.24.57.15` | `192.168.1.38` | 54 |
| Render to Host, stream 1 | `216.24.57.15` | `192.168.1.38` | 57 |

The capture filter was limited to the resolved Render address and TCP port `443`, so DNS resolution is not present in the packet set. The public SNI value `finanzas-mcp-server.onrender.com` associates the TLS handshakes with the intended public endpoint, but it is not DNS evidence. Router hops or NAT are possible network inferences; they are not directly demonstrated by this capture.

## Transport layer

The Host opened two independent TCP connections to the HTTPS service:

| TCP stream | Client socket | Server socket | Three-way handshake |
|---:|---|---|---|
| 0 | `192.168.1.38:50811` | `216.24.57.15:443` | frames 1, 2, and 3 |
| 1 | `192.168.1.38:50812` | `216.24.57.15:443` | frames 19, 20, and 21 |

TCP stream `0` transports `initialize`, `notifications/initialized`, the one `tools/call`, and the HTTP session close. Stream `1` transports `tools/list`. This is two HTTP/1.1 connections used by the same MCP session, not HTTP/2 multiplexing.

TCP provides ordered, reliable byte streams for both connections. The client begins termination with FIN packets in frames `43` and `44`; the server sends FIN packets in frames `45` and `47`. The remaining acknowledgements complete the observed close. This describes only the selected session, not a general connection-pooling policy outside the capture.

## TLS and HTTP

Both TCP streams negotiate TLS independently:

| Stream | Client Hello | Server Hello | Negotiated TLS | Selected cipher | ALPN |
|---:|---:|---:|---|---|---|
| 0 | 5 | 9 | TLS 1.3 (`0x0304`) | `TLS_AES_256_GCM_SHA384` (`0x1302`) | `http/1.1` |
| 1 | 23 | 27 | TLS 1.3 (`0x0304`) | `TLS_AES_256_GCM_SHA384` (`0x1302`) | `http/1.1` |

Some TLS handshake fields retain `0x0303` as a legacy version marker. The negotiated supported version is `0x0304`, which is TLS 1.3. Before supplying the local key log, the application payload appears only as encrypted TLS Application Data. After local decryption, the protocol is HTTP/1.1; there is no HTTP/2 or SSE evidence in this session.

## Application layer

The observed and correlated stack is:

```text
MCP 2025-11-25
→ JSON-RPC 2.0
→ Streamable HTTP
→ HTTP/1.1
→ TLS 1.3
→ TCP
→ IPv4
→ Ethernet/Npcap on the selected Wi-Fi interface
```

The decrypted HTTP evidence shows these interactions:

| Frames | Stream | HTTP result | Application action |
|---|---:|---|---|
| 13 / 15 | 0 | `POST /mcp` / `200` | MCP `initialize` |
| 16 / 18 | 0 | `POST /mcp` / `202` | `notifications/initialized` accepted |
| 31 / 35 | 1 | `POST /mcp` / `200` | `tools/list` |
| 37 / 39 | 0 | `POST /mcp` / `200` | `tools/call` for read-only `get_current_balance` |
| 40 / 42 | 0 | `DELETE /mcp` / `204` | MCP HTTP session closure |

The complete JSON-RPC request, response, and notification classification—including IDs `1`, `2`, and `3`—is in `final-mcp-message-classification.md`. The `202` accepts a JSON-RPC notification and is not itself a JSON-RPC response. The `DELETE` exchange is transport-level session management, not a JSON-RPC request.

The Host is the observed client and the remote Finance MCP deployment is the observed server. PostgreSQL may exist behind that deployment as an architectural component, but it is not a network peer or visible protocol in this capture. The selected probe uses neither DeepSeek nor write tools, and no SSE traffic, database traffic, or financial result values are included in this evidence.

## Observed facts, limits, and reuse

Observed facts are the frames, streams, endpoint addresses, TCP behavior, TLS negotiation, HTTP metadata, and safe Host-log correlation stated above. Inferences about routing, NAT, service internals, database access, or behavior outside the session are intentionally limited.

This analysis and the companion message-classification document are ready to be reused by UN-58. They do not replace the final project report, its conclusions, or its required academic format.
