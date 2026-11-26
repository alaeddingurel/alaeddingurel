import { Router } from "express";
import { z } from "zod";
import type { Repo } from "../repo.ts";
import { endSession, me, requireUser, startSession } from "../auth.ts";
import { h, HttpError, rateLimit } from "../lib/http.ts";
import { hashPassword, verifyPassword } from "../lib/crypto.ts";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, "must be at least 8 characters").max(200);

export function accountRoutes(repo: Repo) {
  const r = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.AUTH_RATE_LIMIT ?? 30) });

  r.post("/auth/signup", authLimiter, h(async (req, res) => {
    const body = z.object({ email, password, name: z.string().trim().min(1).max(80) }).parse(req.body);
    if (repo.getUserWithHashByEmail(body.email)) throw new HttpError(409, "An account with this email already exists.", "CONFLICT");
    const user = repo.createUser(body.email, body.name, await hashPassword(body.password));
    startSession(repo, req, res, user.id);
    res.status(201).json({ user });
  }));

  r.post("/auth/login", authLimiter, h(async (req, res) => {
    const body = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
    const found = repo.getUserWithHashByEmail(body.email);
    // Always run a hash comparison so response time doesn't reveal whether the email exists.
    const ok = await verifyPassword(body.password, found?.passwordHash ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    if (!found || !ok) throw new HttpError(401, "Wrong email or password.", "UNAUTHORIZED");
    const { passwordHash: _omit, ...user } = found;
    startSession(repo, req, res, user.id);
    res.json({ user });
  }));

  r.post("/auth/logout", (req, res) => {
    endSession(repo, req, res);
    res.status(204).end();
  });

  r.get("/auth/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });

  r.patch("/account", requireUser, h((req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    res.json({ user: repo.updateUser(me(req).id, body) });
  }));

  r.post("/account/password", requireUser, h(async (req, res) => {
    const body = z.object({ currentPassword: z.string(), newPassword: password }).parse(req.body);
    const stored = repo.getPasswordHash(me(req).id)!;
    if (!(await verifyPassword(body.currentPassword, stored))) throw new HttpError(400, "Current password is incorrect.", "VALIDATION");
    repo.updateUser(me(req).id, { passwordHash: await hashPassword(body.newPassword) });
    repo.deleteOtherAuthSessions(me(req).id, req.tokenHash!); // sign out other devices
    res.status(204).end();
  }));

  r.delete("/account", requireUser, h(async (req, res) => {
    const body = z.object({ password: z.string() }).parse(req.body);
    if (!(await verifyPassword(body.password, repo.getPasswordHash(me(req).id)!))) {
      throw new HttpError(400, "Password is incorrect.", "VALIDATION");
    }
    endSession(repo, req, res);
    repo.deleteUser(me(req).id);
    res.status(204).end();
  }));

  return r;
}
