import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { ZodError } from 'zod';

export interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;

  if (err instanceof ZodError) {
    logger.warn({ path: req.path, errors: err.errors }, 'Validation error');
    res.status(400).json({
      error: 'Validation failed',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        statusCode,
      },
      path: req.path,
      method: req.method,
    },
    'Unhandled request error'
  );

  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(err.details ? { details: err.details } : {}),
  });
}
