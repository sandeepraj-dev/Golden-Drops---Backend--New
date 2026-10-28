import { ZodError } from "zod";
export function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
}
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500,
    code = err.code || "INTERNAL_ERROR",
    message = err.message || "Internal server error";
  if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Request validation failed";
    err.details = err.flatten();
  } else if (err.code === 11000) {
    status = 409;
    code = "DUPLICATE_RECORD";
    message = "A unique field value already exists. Check error.details to identify the conflicting field.";
    err.details = {
      keyPattern: err.keyPattern || {},
      keyValue: err.keyValue || {},
    };
  } else if (err.name === "CastError") {
    status = 400;
    code = "INVALID_ID";
    message = "Invalid identifier";
  }
  const body = { success: false, error: { code, message } };
  if (err.details) body.error.details = err.details;
  if (process.env.NODE_ENV !== "production" && status === 500)
    body.error.stack = err.stack;
  res.status(status).json(body);
}
