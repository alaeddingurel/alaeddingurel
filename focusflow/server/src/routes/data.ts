// Settings, tasks and focus-session CRUD.
import { Router } from "express";
import { z } from "zod";
import { DEFAULT_PRESETS, DISTRACTION_CATEGORIES } from "@focusflow/shared";
import type { Repo } from "../repo.ts";
import { me, requireUser } from "../auth.ts";
import { h, HttpError } from "../lib/http.ts";

export const FREE_CUSTOM_PRESETS = 2;

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date");
const rating = z.number().int().min(1).max(5).nullable().optional();

const SessionInput = z.object({
  taskId: z.string().nullable().optional(),
  kind: z.enum(["focus", "short_break", "long_break"]),
  plannedSeconds: z.number().int().min(30).max(6 * 3600),
  actualSeconds: z.number().int().min(0).max(8 * 3600),
  startedAt: iso,
  endedAt: iso,
  completed: z.boolean(),
  focusRating: rating,
  energy: rating,
  note: z.string().max(1000).optional(),
  tag: z.string().trim().max(40).optional(),
  distractions: z.array(z.object({
    at: iso,
    category: z.enum(DISTRACTION_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
    note: z.string().max(200).optional(),
  })).max(200).optional(),
});

const TaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).optional(),
  tag: z.string().trim().max(40).optional(),
  estimatePomodoros: z.number().int().min(1).max(50).optional(),
});

export function dataRoutes(repo: Repo) {
  const r = Router();
  r.use(requireUser);

  // ---- settings ----
  r.get("/settings", (req, res) => {
    res.json({ settings: repo.getSettings(me(req).id) });
  });

  r.put("/settings", h((req, res) => {
    const input = z.record(z.string(), z.unknown()).parse(req.body);
    if (me(req).plan !== "pro" && Array.isArray(input.presets)) {
      const builtIn = new Set(DEFAULT_PRESETS.map((p) => p.id));
      const custom = input.presets.filter((p: any) => !builtIn.has(p?.id));
      if (custom.length > FREE_CUSTOM_PRESETS) {
        throw new HttpError(402, `Free accounts can save ${FREE_CUSTOM_PRESETS} custom presets. Upgrade to Pro for unlimited.`, "PRO_REQUIRED");
      }
    }
    res.json({ settings: repo.saveSettings(me(req).id, input) });
  }));

  // ---- tasks ----
  r.get("/tasks", (req, res) => {
    res.json({ tasks: repo.listTasks(me(req).id, req.query.includeDone !== "false") });
  });

  r.post("/tasks", h((req, res) => {
    res.status(201).json({ task: repo.createTask(me(req).id, TaskInput.parse(req.body)) });
  }));

  r.patch("/tasks/:id", h((req, res) => {
    const patch = TaskInput.partial().extend({ done: z.boolean().optional(), sortOrder: z.number().optional() }).parse(req.body);
    const task = repo.updateTask(me(req).id, String(req.params.id), patch);
    if (!task) throw new HttpError(404, "Task not found", "NOT_FOUND");
    res.json({ task });
  }));

  r.delete("/tasks/:id", (req, res, next) => {
    if (!repo.deleteTask(me(req).id, String(req.params.id))) return next(new HttpError(404, "Task not found", "NOT_FOUND"));
    res.status(204).end();
  });

  // ---- sessions ----
  r.post("/sessions", h((req, res) => {
    const input = SessionInput.parse(req.body);
    if (Date.parse(input.endedAt) < Date.parse(input.startedAt)) throw new HttpError(400, "endedAt is before startedAt", "VALIDATION");
    res.status(201).json({ session: repo.createSession(me(req).id, input as any, req.tz) });
  }));

  r.get("/sessions", h((req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(req.query);
    res.json({ sessions: repo.listSessions(me(req).id, { limit: q.limit }) });
  }));

  r.patch("/sessions/:id", h((req, res) => {
    const body = z.object({ focusRating: rating, energy: rating, note: z.string().max(1000).optional() }).parse(req.body);
    const session = repo.rateSession(me(req).id, String(req.params.id), body);
    if (!session) throw new HttpError(404, "Session not found", "NOT_FOUND");
    res.json({ session });
  }));

  r.delete("/sessions/:id", (req, res, next) => {
    if (!repo.deleteSession(me(req).id, String(req.params.id))) return next(new HttpError(404, "Session not found", "NOT_FOUND"));
    res.status(204).end();
  });

  return r;
}
