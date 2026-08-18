import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { isMcpCallToolResult, type McpCallToolResult, type McpJsonSchema, type McpTool } from "@/shared/mcp";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

export interface FinanceToolDefinition extends McpTool {
  isWriteOperation: boolean;
  handler: (arguments_: Record<string, unknown>) => McpCallToolResult | Promise<McpCallToolResult>;
}

interface RegisteredFinanceTool extends FinanceToolDefinition {
  validate: ValidateFunction;
}

export type FinanceToolExecution =
  | { ok: true; result: McpCallToolResult }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_ARGUMENTS"; result: McpCallToolResult };

function assertToolDefinition(tool: FinanceToolDefinition): void {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error("Finance MCP tool name must use 1-128 letters, digits, dots, underscores, or hyphens");
  }

  if (tool.description.trim().length === 0) {
    throw new Error(`Finance MCP tool ${tool.name} must have a description`);
  }

  if (typeof tool.inputSchema !== "object" || tool.inputSchema === null || Array.isArray(tool.inputSchema)) {
    throw new Error(`Finance MCP tool ${tool.name} must have an object input schema`);
  }

  if (tool.inputSchema.type !== "object") {
    throw new Error(`Finance MCP tool ${tool.name} input schema root type must be object`);
  }
}

function publicTool(tool: FinanceToolDefinition): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: structuredClone(tool.inputSchema),
  };
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Tool arguments do not match the input schema.";
  }

  const details = errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
  return `Tool arguments do not match the input schema: ${details}.`;
}

export class FinanceToolRegistry {
  private readonly tools = new Map<string, RegisteredFinanceTool>();

  constructor(definitions: FinanceToolDefinition[] = []) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });

    for (const definition of definitions) {
      assertToolDefinition(definition);
      if (this.tools.has(definition.name)) {
        throw new Error(`Duplicate Finance MCP tool: ${definition.name}`);
      }

      const validate = ajv.compile(definition.inputSchema as McpJsonSchema);
      this.tools.set(definition.name, { ...definition, validate });
    }
  }

  list(): McpTool[] {
    return [...this.tools.values()].map(publicTool);
  }

  async execute(name: string, arguments_: Record<string, unknown>): Promise<FinanceToolExecution> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, reason: "NOT_FOUND" };
    }

    if (!tool.validate(arguments_)) {
      return {
        ok: false,
        reason: "INVALID_ARGUMENTS",
        result: {
          content: [{ type: "text", text: formatValidationErrors(tool.validate.errors) }],
          isError: true,
        },
      };
    }

    const result = await tool.handler(arguments_);
    if (!isMcpCallToolResult(result)) {
      throw new Error(`Finance MCP tool ${name} returned an invalid result`);
    }

    return { ok: true, result };
  }
}
