import { describe, expect, it, vi } from "vitest";
import {
  GIT_MCP_SERVER_ID,
  gitMcpConfiguration,
  gitMcpDemoRepositoryPath,
  gitMcpPythonPath,
} from "@/host/mcp-clients/git-mcp-local";
import { GitWriteOperationDescriber } from "@/host/confirmation/git-write-describer";
import { HostWriteOperationDescriber } from "@/host/confirmation/host-write-describer";
import { gitMcpToolMetadata, registerGitMcpTools } from "@/host/orchestration/git-mcp-tools";
import { financeMcpToolMetadata, registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { filesystemMcpToolMetadata, registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { HostMcpToolRegistry, type McpToolClient } from "@/host/orchestration/mcp-tool-registry";
import type { McpTool } from "@/shared/mcp";

const gitToolNames = [
  "git_status", "git_diff_unstaged", "git_diff_staged", "git_diff", "git_commit", "git_add", "git_reset",
  "git_log", "git_create_branch", "git_checkout", "git_show", "git_branch",
] as const;

function tool(name: string): McpTool {
  return { name, description: `${name} description`, inputSchema: { type: "object", additionalProperties: false } };
}

describe("Git MCP Host integration", () => {
  it("uses a fixed local venv and the nested demo repository without inheriting secrets", () => {
    const root = "C:/workspace/project";
    const configuration = gitMcpConfiguration({ projectRoot: root, onStderr: () => undefined });
    expect(gitMcpDemoRepositoryPath(root)).toMatch(/docs[\\/]generated[\\/]git-demo$/);
    expect(gitMcpPythonPath(root)).toContain(".venv-git-mcp");
    expect(configuration).toMatchObject({
      args: ["-m", "mcp_server_git", "--repository", gitMcpDemoRepositoryPath(root)],
      cwd: root,
      serverId: GIT_MCP_SERVER_ID,
    });
    expect(configuration.env).not.toHaveProperty("DATABASE_URL");
    expect(configuration.env).not.toHaveProperty("DEEPSEEK_API_KEY");
  });

  it("classifies the exact official catalog and registers it without executing tools", async () => {
    expect(Object.keys(gitMcpToolMetadata)).toEqual(gitToolNames);
    expect(Object.values(gitMcpToolMetadata).filter((metadata) => metadata.isWriteOperation)).toHaveLength(5);
    expect(Object.values(gitMcpToolMetadata).filter((metadata) => !metadata.isWriteOperation)).toHaveLength(7);

    const client: McpToolClient = {
      toolsList: vi.fn(async () => ({ tools: gitToolNames.map(tool) })),
      toolsCall: vi.fn(async () => ({ content: [] })),
    };
    const registry = new HostMcpToolRegistry();
    await registerGitMcpTools(registry, client);

    expect(registry.list()).toHaveLength(12);
    expect(registry.resolve("git_status")).toMatchObject({ serverId: GIT_MCP_SERVER_ID, client, isWriteOperation: false });
    expect(registry.resolve("git_commit")).toMatchObject({ serverId: GIT_MCP_SERVER_ID, client, isWriteOperation: true });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("keeps all three server catalogs isolated while exposing 50 classified tools", async () => {
    const clientFor = (metadata: Readonly<Record<string, { isWriteOperation: boolean }>>): McpToolClient => ({
      toolsList: vi.fn(async () => ({ tools: Object.keys(metadata).map(tool) })),
      toolsCall: vi.fn(async () => ({ content: [] })),
    });
    const finance = clientFor(financeMcpToolMetadata);
    const filesystem = clientFor(filesystemMcpToolMetadata);
    const git = clientFor(gitMcpToolMetadata);
    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, finance);
    await registerFilesystemMcpTools(registry, filesystem);
    await registerGitMcpTools(registry, git);

    expect(registry.list()).toHaveLength(50);
    expect(registry.list().filter((entry) => entry.isWriteOperation)).toHaveLength(24);
    expect(registry.list().filter((entry) => !entry.isWriteOperation)).toHaveLength(26);
    expect(registry.resolve("git_log")).toMatchObject({ serverId: GIT_MCP_SERVER_ID, client: git });
  });

  it("describes each Git mutation with exact escaped arguments and fails closed", () => {
    const describer = new GitWriteOperationDescriber();
    const base = { serverId: GIT_MCP_SERVER_ID };
    expect(describer.describe({ ...base, toolCallId: "1", toolName: "git_add", arguments: { repo_path: "C:/demo", files: ["report.md", "notes.md"] } }))
      .toBe('Agregar al staging del repositorio "C:/demo" los archivos "report.md", "notes.md".');
    expect(describer.describe({ ...base, toolCallId: "2", toolName: "git_commit", arguments: { repo_path: "C:/demo", message: "docs: add report\n" } }))
      .toBe('Crear un commit en el repositorio "C:/demo" con el mensaje exacto "docs: add report\\n".');
    expect(describer.describe({ ...base, toolCallId: "3", toolName: "git_reset", arguments: { repo_path: "C:/demo" } }))
      .toBe('Retirar todos los cambios del staging en el repositorio "C:/demo" sin borrar archivos.');
    expect(describer.describe({ ...base, toolCallId: "4", toolName: "git_create_branch", arguments: { repo_path: "C:/demo", branch_name: "report", base_branch: "main" } }))
      .toBe('Crear la rama "report" en el repositorio "C:/demo" desde "main".');
    expect(describer.describe({ ...base, toolCallId: "5", toolName: "git_checkout", arguments: { repo_path: "C:/demo", branch_name: "main" } }))
      .toBe('Cambiar el repositorio "C:/demo" a la rama "main".');
    expect(() => describer.describe({ ...base, toolCallId: "6", toolName: "git_push", arguments: {} })).toThrow(/cannot be described safely/i);
    expect(new HostWriteOperationDescriber().describe({ ...base, toolCallId: "7", toolName: "git_reset", arguments: { repo_path: "C:/demo" } }))
      .toContain("Retirar todos los cambios");
  });
});
