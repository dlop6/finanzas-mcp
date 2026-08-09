import type { JsonRpcErrorObject, JsonRpcErrorResponse, JsonRpcId } from "./index";

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];

export interface JsonRpcErrorResponseOptions<Data = unknown> {
  id: JsonRpcId | null;
  code: JsonRpcErrorCode;
  message: string;
  data?: Data;
}

export function createJsonRpcErrorResponse<Data = unknown>(
  options: JsonRpcErrorResponseOptions<Data>,
): JsonRpcErrorResponse<Data> {
  const error: JsonRpcErrorObject<Data> = {
    code: options.code,
    message: options.message,
  };

  if (options.data !== undefined) {
    error.data = options.data;
  }

  return {
    jsonrpc: "2.0",
    id: options.id,
    error,
  };
}

export const createErrorResponse = createJsonRpcErrorResponse;

export function createParseErrorResponse(): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse({
    id: null,
    code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
    message: "Parse error",
  });
}

export function createInvalidRequestResponse(id: JsonRpcId | null = null): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse({
    id,
    code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid Request",
  });
}

export function createMethodNotFoundResponse(id: JsonRpcId | null): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse({
    id,
    code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
    message: "Method not found",
  });
}

export function createInvalidParamsResponse(id: JsonRpcId | null): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse({
    id,
    code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
    message: "Invalid params",
  });
}

export function createInternalErrorResponse(id: JsonRpcId | null): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse({
    id,
    code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
    message: "Internal error",
  });
}
