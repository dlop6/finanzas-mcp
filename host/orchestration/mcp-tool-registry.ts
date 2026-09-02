import type { DeepSeekToolDefinition } from "@/host/llm";
import type { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import type { McpTool } from "@/shared/mcp";

export type McpServerId = string;

export type HostToolMetadata = {
  isWriteOperation: boolean;
};

export type McpToolClient = Pick<McpLifecycleClient, "toolsList" | "toolsCall">;

export type RegisterMcpServerInput = {
  serverId: McpServerId;
  client: McpToolClient;
  metadata: Readonly<Record<string, HostToolMetadata>>;
};

export type RegisteredMcpTool = {
  serverId: McpServerId;
  definition: McpTool;
  isWriteOperation: boolean;
  client: McpToolClient;
};

export type HostToolRegistryErrorCode =
  | "INVALID_SERVER_ID"
  | "SERVER_ALREADY_REGISTERED"
  | "DISCOVERY_FAILED"
  | "DUPLICATE_TOOL"
  | "MISSING_METADATA"
  | "UNEXPECTED_METADATA"
  | "INCOMPATIBLE_TOOL"
  | "UNKNOWN_TOOL";

export class HostToolRegistryError extends Error {
  readonly code: HostToolRegistryErrorCode;

  constructor(code: HostToolRegistryErrorCode, message: string) {
    super(message);
    this.name = "HostToolRegistryError";
    this.code = code;
  }
}

const DEEPSEEK_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function cloneDefinition(tool: McpTool): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: structuredClone(tool.inputSchema),
  };
}

function cloneRegisteredTool(tool: RegisteredMcpTool): RegisteredMcpTool {
  return {
    serverId: tool.serverId,
    definition: cloneDefinition(tool.definition),
    isWriteOperation: tool.isWriteOperation,
    client: tool.client,
  };
}

function toDeepSeekTool(tool: RegisteredMcpTool): DeepSeekToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: structuredClone(tool.definition.inputSchema),
    },
  };
}

export class HostMcpToolRegistry {
  private readonly tools = new Map<string, RegisteredMcpTool>();
  private readonly serverIds = new Set<McpServerId>();

  async registerServer(input: RegisterMcpServerInput): Promise<void> {
    const serverId = input.serverId.trim();
    if (!serverId) {
      throw new HostToolRegistryError("INVALID_SERVER_ID", "MCP server ID must contain text.");
    }
    if (this.serverIds.has(serverId)) {
      throw new HostToolRegistryError("SERVER_ALREADY_REGISTERED", `MCP server ${serverId} is already registered.`);
    }

    let discovered: McpTool[];
    try {
      discovered = (await input.client.toolsList()).tools;
    } catch {
      throw new HostToolRegistryError("DISCOVERY_FAILED", `Could not discover tools for MCP server ${serverId}.`);
    }

    const discoveredNames = new Set<string>();
    for (const tool of discovered) {
      if (discoveredNames.has(tool.name) || this.tools.has(tool.name)) {
        throw new HostToolRegistryError("DUPLICATE_TOOL", `MCP tool ${tool.name} is already registered.`);
      }
      discoveredNames.add(tool.name);

      if (!Object.hasOwn(input.metadata, tool.name)) {
        throw new HostToolRegistryError("MISSING_METADATA", `MCP tool ${tool.name} has no Host metadata.`);
      }
      if (!DEEPSEEK_TOOL_NAME.test(tool.name)) {
        throw new HostToolRegistryError("INCOMPATIBLE_TOOL", `MCP tool ${tool.name} is incompatible with DeepSeek.`);
      }
    }

    for (const toolName of Object.keys(input.metadata)) {
      if (!discoveredNames.has(toolName)) {
        throw new HostToolRegistryError("UNEXPECTED_METADATA", `Host metadata references unknown MCP tool ${toolName}.`);
      }
    }

    // Discovery and metadata must agree before anything is registered, making this registry the Host's ownership and write-policy boundary.
    const prepared = discovered.map((tool) => {
      const metadata = input.metadata[tool.name];
      if (typeof metadata.isWriteOperation !== "boolean") {
        throw new HostToolRegistryError("MISSING_METADATA", `MCP tool ${tool.name} has invalid Host metadata.`);
      }
      return {
        serverId,
        definition: cloneDefinition(tool),
        isWriteOperation: metadata.isWriteOperation,
        client: input.client,
      } satisfies RegisteredMcpTool;
    });

    this.serverIds.add(serverId);
    for (const tool of prepared) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  /** Removes a server that was registered by a failed higher-level composition. */
  unregisterServer(serverId: McpServerId): void {
    const normalizedServerId = serverId.trim();
    if (!normalizedServerId || !this.serverIds.delete(normalizedServerId)) return;
    for (const [toolName, tool] of this.tools) {
      if (tool.serverId === normalizedServerId) this.tools.delete(toolName);
    }
  }

  list(): RegisteredMcpTool[] {
    return [...this.tools.values()].map(cloneRegisteredTool);
  }

  toDeepSeekTools(): DeepSeekToolDefinition[] {
    return [...this.tools.values()].map(toDeepSeekTool);
  }

  resolve(toolName: string): RegisteredMcpTool {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new HostToolRegistryError("UNKNOWN_TOOL", `MCP tool ${toolName} is not registered.`);
    }
    return cloneRegisteredTool(tool);
  }
}
