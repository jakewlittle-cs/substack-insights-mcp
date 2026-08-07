export class SubstackInsightsError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SubstackInsightsError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof SubstackInsightsError) {
    return {
      error: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  return {
    error: "internal_error",
    message: errorMessage(error),
  };
}
