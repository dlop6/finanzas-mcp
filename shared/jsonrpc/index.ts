/** The identifier shared by a request and its response. */
export type JsonRpcId = string | number;

/** A JSON-RPC 2.0 request that expects a response. */
export interface JsonRpcRequest<Params = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Params;
}

/** A JSON-RPC 2.0 notification that deliberately has no identifier. */
export interface JsonRpcNotification<Params = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: Params;
}

/** A successful JSON-RPC 2.0 response for a request. */
export interface JsonRpcSuccessResponse<Result = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Result;
}

/** The structured error payload carried by an error response. */
export interface JsonRpcErrorObject<Data = unknown> {
  code: number;
  message: string;
  data?: Data;
}

/** An error JSON-RPC 2.0 response. The id is null when no request id exists. */
export interface JsonRpcErrorResponse<Data = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorObject<Data>;
}
