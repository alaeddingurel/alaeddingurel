import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.ts";
import { createRepo } from "./repo.ts";
import { loadUser } from "./auth.ts";
import { errorHandler, HttpError } from "./lib/http.ts";
import { accountRoutes } from "./routes/account.ts";
import { dataRoutes } from "./routes/data.ts";
import { insightRoutes } from "./routes/insights.ts";

export function createApp(db: DB) {
  const repo = createRepo(db);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // CSRF defence for cookie auth: state-changing calls must carry a custom header. Cross-site HTML forms
  // can't set one, and cross-origin fetch would need a CORS preflight that this server never approves.
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-requested-with"] !== "focusflow") {
      return next(new HttpError(403, "Missing X-Requested-With header"));
    }
    next();
  });

  app.use("/api", loadUser(repo));
  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });
  app.use("/api", accountRoutes(repo));
  app.use("/api", dataRoutes(repo));
  app.use("/api", insightRoutes(repo));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "NOT_FOUND")));

  // Serve the built web app in production.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(errorHandler);
  return { app, repo };
}
