import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ApiError } from "@focusflow/shared";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: ApiError["code"]) {
    super(message);
  }
}

/** Wrap async handlers so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const body: ApiError = { error: `${first?.path.join(".") || "input"}: ${first?.message}`, code: "VALIDATION" };
    return res.status(400).json(body);
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiError);
  }
  if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body", code: "VALIDATION" } satisfies ApiError);
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" } satisfies ApiError);
}

/** Tiny fixed-window rate limiter (in-memory; swap for Redis when running multiple instances). */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req, _res, next) => {
    const key = opts.key?.(req) ?? req.ip ?? "anon";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + opts.windowMs });
      return next();
    }
    if (++entry.count > opts.max) return next(new HttpError(429, "Too many requests, slow down.", "RATE_LIMITED"));
    next();
  };
}
