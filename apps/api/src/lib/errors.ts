export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, "unauthorized", "Authentication required"),
  forbidden: () => new ApiError(403, "forbidden", "Not allowed"),
  adminRequired: () => new ApiError(403, "admin_required", "Admin privilege required"),
  validation: (message = "Invalid request") => new ApiError(400, "validation_error", message),
  notFound: (code = "resource_not_found", message = "Resource not found") =>
    new ApiError(404, code, message),
  conflict: (code = "conflict", message = "Conflict") => new ApiError(409, code, message),
  invalidCursor: () => new ApiError(400, "invalid_cursor", "Invalid cursor"),
  internal: (message = "Unexpected server error") => new ApiError(500, "internal_error", message),
  tooLarge: (message = "Request entity too large") => new ApiError(413, "validation_error", message),
};
