import type {
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from "./index";
import {
  createInvalidRequestResponse,
  createParseErrorResponse,
} from "./errors";

export type JsonRpcValidationResult =
  | { ok: true; message: JsonRpcMessage }
  | { ok: false; error: JsonRpcErrorResponse };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function isParams(value: unknown): boolean {
  return Array.isArray(value) || isObject(value);
}

function responseId(value: Record<string, unknown>): JsonRpcId | null {
  return isJsonRpcId(value.id) ? value.id : null;
}

function invalidRequest(value: Record<string, unknown>): JsonRpcValidationResult {
  return { ok: false, error: createInvalidRequestResponse(responseId(value)) };
}

function isErrorObject(value: unknown): value is JsonRpcErrorObject {
  if (!isObject(value)) {
    return false;
  }

  return Number.isInteger(value.code) && typeof value.message === "string";
}

function validateResponse(value: Record<string, unknown>): JsonRpcValidationResult {
  const hasResult = hasOwn(value, "result");
  const hasError = hasOwn(value, "error");

  if (hasResult === hasError || !hasOwn(value, "id")) {
    return invalidRequest(value);
  }

  if (hasResult) {
    if (!isJsonRpcId(value.id)) {
      return invalidRequest(value);
    }

    return {
      ok: true,
      message: value as unknown as JsonRpcSuccessResponse,
    };
  }

  if ((value.id !== null && !isJsonRpcId(value.id)) || !isErrorObject(value.error)) {
    return invalidRequest(value);
  }

  return {
    ok: true,
    message: value as unknown as JsonRpcErrorResponse,
  };
}

function validateRequestOrNotification(value: Record<string, unknown>): JsonRpcValidationResult {
  if (typeof value.method !== "string" || value.method.trim().length === 0) {
    return invalidRequest(value);
  }

  if (hasOwn(value, "id") && !isJsonRpcId(value.id)) {
    return invalidRequest(value);
  }

  if (hasOwn(value, "params") && !isParams(value.params)) {
    return invalidRequest(value);
  }

  return {
    ok: true,
    message: value as unknown as JsonRpcRequest | JsonRpcNotification,
  };
}

export function validateJsonRpcMessage(value: unknown): JsonRpcValidationResult {
  if (!isObject(value) || value.jsonrpc !== "2.0") {
    return { ok: false, error: createInvalidRequestResponse() };
  }

  const hasMethod = hasOwn(value, "method");
  const hasResult = hasOwn(value, "result");
  const hasError = hasOwn(value, "error");

  if (hasMethod && (hasResult || hasError)) {
    return invalidRequest(value);
  }

  if (hasMethod) {
    return validateRequestOrNotification(value);
  }

  if (hasResult || hasError) {
    return validateResponse(value);
  }

  return invalidRequest(value);
}

export function parseJsonRpcMessage(text: string): JsonRpcValidationResult {
  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: createParseErrorResponse() };
  }

  return validateJsonRpcMessage(value);
}

export const parseJsonRpc = parseJsonRpcMessage;

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return validateJsonRpcMessage(value).ok;
}
