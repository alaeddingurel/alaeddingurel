import type { Request, Response, NextFunction } from "express";
import type { User } from "@focusflow/shared";
import type { Repo } from "./repo.ts";
import { HttpError } from "./lib/http.ts";
import { newToken, sha256 } from "./lib/crypto.ts";
import { safeTz } from "./lib/time.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      tokenHash?: string;
      tz: string;
    }
  }
}

export const COOKIE = "ff_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function startSession(repo: Repo, req: Request, res: Response, userId: string) {
  const token = newToken();
  repo.createAuthSession(sha256(token), userId, SESSION_TTL_MS, req.headers["user-agent"]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function endSession(repo: Repo, req: Request, res: Response) {
  if (req.tokenHash) repo.deleteAuthSession(req.tokenHash);
  res.clearCookie(COOKIE, { path: "/" });
}

/** Attaches req.user (if signed in) and req.tz on every request. */
export const loadUser = (repo: Repo) => (req: Request, _res: Response, next: NextFunction) => {
  req.tz = safeTz(req.headers["x-timezone"]);
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const hash = sha256(token);
    const user = repo.getUserByToken(hash);
    if (user) { req.user = user; req.tokenHash = hash; }
  }
  next();
};

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in.", "UNAUTHORIZED"));
  next();
}

export function requirePro(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in.", "UNAUTHORIZED"));
  if (req.user.plan !== "pro") return next(new HttpError(402, "This feature is part of FocusFlow Pro.", "PRO_REQUIRED"));
  next();
}

/** Narrow req.user after requireUser has run. */
export const me = (req: Request): User => req.user!;
