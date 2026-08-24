export type ConfirmationErrorCode =
  | "UNSUPPORTED_WRITE_DESCRIPTION"
  | "PENDING_OPERATION_MISMATCH"
  | "CONFIRMED_WRITE_FAILED"
  | "CONFIRMED_WRITE_RESPONSE_FAILED";

export class ConfirmationError extends Error {
  constructor(
    public readonly code: ConfirmationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConfirmationError";
  }
}
