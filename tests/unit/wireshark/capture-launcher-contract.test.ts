import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readWorkspaceFile = async (path: string): Promise<string> => readFile(path, "utf8");

describe("remote Wireshark capture launcher", () => {
  it("requires an explicit interface and HTTPS MCP endpoint before capture", async () => {
    const launcher = await readWorkspaceFile("scripts/wireshark/capture-remote-mcp.ps1");

    expect(launcher).toContain("[Parameter(Mandatory = $true)]");
    expect(launcher).toContain('$uri.Scheme -ne "https"');
    expect(launcher).toContain('$uri.AbsolutePath -ne "/mcp"');
    expect(launcher).not.toContain(".env");
  });

  it("uses a local TLS key log and always stops the exact tshark process", async () => {
    const launcher = await readWorkspaceFile("scripts/wireshark/capture-remote-mcp.ps1");

    expect(launcher).toContain("--tls-keylog=$keyLog");
    expect(launcher).toContain("finally {");
    expect(launcher).toContain("Stop-Process -Id $captureProcess.Id -Force");
    expect(launcher).toContain("tcp port 443");
  });

  it("keeps captures, key logs, and tshark reports outside Git", async () => {
    const gitignore = await readWorkspaceFile(".gitignore");

    expect(gitignore).toContain("/docs/wireshark/local/");
  });

  it("adds a fixed Host-client capture mode without changing the temporary probe command", async () => {
    const launcher = await readWorkspaceFile("scripts/wireshark/capture-remote-mcp.ps1");
    const packageJson = await readWorkspaceFile("package.json");

    expect(launcher).toContain("[switch]$HostClient");
    expect(launcher).toContain("host-remote-mcp-probe.ts");
    expect(launcher).toContain("host-remote-preliminary");
    expect(launcher).toContain("GetHostAddresses");
    expect(launcher).toContain("tcp port 443 and (");
    expect(packageJson).toContain('"wireshark:host-remote:capture"');
  });
});
