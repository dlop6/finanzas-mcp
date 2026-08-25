import { describe, expect, it } from "vitest";
import { isMcpCallToolResult } from "@/shared/mcp";

describe("MCP content contracts", () => {
  it("accepts official Filesystem MCP text, image, audio, and embedded resources", () => {
    expect(isMcpCallToolResult({ content: [
      { type: "text", text: "text" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "audio", data: "aGVsbG8=", mimeType: "audio/wav" },
      { type: "resource", resource: { uri: "file:///tmp/file.bin", mimeType: "application/octet-stream", blob: "aGVsbG8=" } },
    ] })).toBe(true);
  });

  it("rejects malformed binary or embedded resource content", () => {
    expect(isMcpCallToolResult({ content: [{ type: "image", data: "bytes" }] })).toBe(false);
    expect(isMcpCallToolResult({ content: [{ type: "resource", resource: { uri: "file:///tmp/file" } }] })).toBe(false);
  });
});
