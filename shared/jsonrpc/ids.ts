export class JsonRpcRequestIdGenerator {
  private nextId: number;

  constructor(start = 1) {
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error("JSON-RPC request ID start must be a non-negative safe integer");
    }

    this.nextId = start;
  }

  next(): number {
    if (this.nextId > Number.MAX_SAFE_INTEGER) {
      throw new Error("JSON-RPC request ID limit reached");
    }

    const id = this.nextId;
    this.nextId += 1;
    return id;
  }
}

export function createJsonRpcRequestIdGenerator(start = 1): JsonRpcRequestIdGenerator {
  return new JsonRpcRequestIdGenerator(start);
}
