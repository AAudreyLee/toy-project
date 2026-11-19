import type { DeliveryErrorCode } from "../types";

export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryErrorCode,
    message: string,
  ) {
    super(message);
  }
}
