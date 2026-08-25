import type { JsonRpcParams } from "@/shared/jsonrpc";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

export const MCP_METHODS = {
  INITIALIZE: "initialize",
  INITIALIZED_NOTIFICATION: "notifications/initialized",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
} as const;

export interface McpImplementationInfo {
  name: string;
  version: string;
}

export type McpClientCapabilities = Record<string, never>;

export interface McpServerCapabilities {
  tools: Record<string, never>;
}

export interface McpInitializeParams extends Record<string, unknown> {
  protocolVersion: typeof MCP_PROTOCOL_VERSION;
  capabilities: McpClientCapabilities;
  clientInfo: McpImplementationInfo;
}

export interface McpInitializeRequestParams extends Record<string, unknown> {
  protocolVersion: string;
  capabilities: McpClientCapabilities;
  clientInfo: McpImplementationInfo;
}

export interface McpInitializeResult {
  protocolVersion: typeof MCP_PROTOCOL_VERSION;
  capabilities: McpServerCapabilities;
  serverInfo: McpImplementationInfo;
}

export type McpJsonSchema = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
}

export interface McpListToolsResult {
  tools: McpTool[];
}

export interface McpCallToolParams extends Record<string, unknown> {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface McpAudioContent {
  type: "audio";
  data: string;
  mimeType: string;
}

export interface McpEmbeddedResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type McpContent =
  | McpTextContent
  | McpImageContent
  | McpAudioContent
  | McpEmbeddedResourceContent;

export interface McpCallToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImplementationInfo(value: unknown): value is McpImplementationInfo {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.version === "string" &&
    value.version.trim().length > 0
  );
}

export function isMcpInitializeRequestParams(value: JsonRpcParams | undefined): value is McpInitializeRequestParams {
  return (
    isRecord(value) &&
    typeof value.protocolVersion === "string" &&
    isRecord(value.capabilities) &&
    isImplementationInfo(value.clientInfo)
  );
}

export function isMcpInitializeParams(value: JsonRpcParams | undefined): value is McpInitializeParams {
  return isMcpInitializeRequestParams(value) && value.protocolVersion === MCP_PROTOCOL_VERSION;
}

export function isMcpInitializeResult(value: unknown): value is McpInitializeResult {
  return (
    isRecord(value) &&
    value.protocolVersion === MCP_PROTOCOL_VERSION &&
    isRecord(value.capabilities) &&
    isRecord(value.capabilities.tools) &&
    isImplementationInfo(value.serverInfo)
  );
}

export function isMcpListToolsParams(value: JsonRpcParams | undefined): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

export function isMcpCallToolParams(value: JsonRpcParams | undefined): value is McpCallToolParams {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.arguments === undefined || isRecord(value.arguments))
  );
}

export function toMcpCallToolParams(value: JsonRpcParams): McpCallToolParams {
  if (!isMcpCallToolParams(value)) {
    throw new TypeError("Invalid tools/call params");
  }

  return { name: value.name, arguments: value.arguments ?? {} };
}

function isMcpTool(value: unknown): value is McpTool {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    isRecord(value.inputSchema)
  );
}

export function isMcpListToolsResult(value: unknown): value is McpListToolsResult {
  return isRecord(value) && Array.isArray(value.tools) && value.tools.every(isMcpTool);
}

function isMcpTextContent(value: unknown): value is McpTextContent {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isMcpBinaryContent(value: unknown, type: "image" | "audio"): value is McpImageContent | McpAudioContent {
  return isRecord(value) && value.type === type && typeof value.data === "string" && typeof value.mimeType === "string";
}

function isMcpEmbeddedResourceContent(value: unknown): value is McpEmbeddedResourceContent {
  if (!isRecord(value) || value.type !== "resource" || !isRecord(value.resource) || typeof value.resource.uri !== "string") {
    return false;
  }

  const { mimeType, text, blob } = value.resource;
  return (
    (mimeType === undefined || typeof mimeType === "string") &&
    (text === undefined || typeof text === "string") &&
    (blob === undefined || typeof blob === "string") &&
    (typeof text === "string" || typeof blob === "string")
  );
}

function isMcpContent(value: unknown): value is McpContent {
  return (
    isMcpTextContent(value) ||
    isMcpBinaryContent(value, "image") ||
    isMcpBinaryContent(value, "audio") ||
    isMcpEmbeddedResourceContent(value)
  );
}

export function isMcpCallToolResult(value: unknown): value is McpCallToolResult {
  return (
    isRecord(value) &&
    Array.isArray(value.content) &&
    value.content.every(isMcpContent) &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    (value.structuredContent === undefined || isRecord(value.structuredContent))
  );
}
