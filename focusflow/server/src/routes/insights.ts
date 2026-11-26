// Stats (free + Pro), AI coach, and demo billing.
import { Router } from "express";
import { z } from "zod";
import type { DetailedStats } from "@focusflow/shared";
import type { Repo } from "../repo.ts";
import { me, requirePro, requireUser } from "../auth.ts";
import { h, HttpError, rateLimit } from "../lib/http.ts";
import { addDays, localParts } from "../lib/time.ts";
import { basicStats, detailedStats, sessionsToCsv } from "../stats.ts";
import { buildInsights, heuristicDayPlan, heuristicReport, peakHours, suggestNextSession } from "../ai/coach.ts";
import { claudeDayPlan, claudeEnabled, claudeReport } from "../ai/claude.ts";

export const FREE_INSIGHTS = 2;

export function insightRoutes(repo: Repo) {
  const r = Router();
  r.use(requireUser);
  const aiLimiter = rateLimit({ windowMs: 60 * 60_000, max: 30, key: (req) => req.user?.id ?? "anon" });

  const today = (tz: string) => localParts(new Date(), tz).date;

  function periodStats(userId: string, tz: string, days: number) {
    const to = today(tz);
    const from = addDays(to, -(days - 1));
    const prevFrom = addDays(from, -days);
    const sessions = repo.listSessions(userId, { from: prevFrom, to });
    const distractions = repo.listDistractions(userId, new Date(`${prevFrom}T00:00:00Z`).toISOString());
    const tasks = repo.listTasks(userId);
    const goal = repo.getSettings(userId).dailyGoalPomodoros;
    const cur = detailedStats(sessions, distractions, tasks, from, to, goal);
    const prevTo = addDays(from, -1);
    const prev = detailedStats(sessions, distractions, tasks, prevFrom, prevTo, goal);
    return { cur, prev: prev.totals.sessionsStarted ? prev : null, sessions: sessions.filter((s) => s.localDate >= from) };
  }

  // ---- stats ----
  r.get("/stats/basic", (req, res) => {
    const t = today(req.tz);
    const sessions = repo.listSessions(me(req).id, { from: addDays(t, -400), to: t });
    res.json({ stats: basicStats(sessions, t, repo.getSettings(me(req).id).dailyGoalPomodoros) });
  });

  r.get("/stats/detailed", requirePro, h((req, res) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const { cur, prev } = periodStats(me(req).id, req.tz, q.days);
    res.json({ stats: cur, previous: prev?.totals ?? null });
  }));

  r.get("/stats/export.csv", requirePro, (req, res) => {
    const userId = me(req).id;
    const csv = sessionsToCsv(repo.listSessions(userId), repo.listTasks(userId));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="focusflow-sessions-${today(req.tz)}.csv"`);
    res.send(csv);
  });

  // ---- AI coach ----
  r.get("/ai/status", (req, res) => {
    res.json({ claude: claudeEnabled(), plan: me(req).plan });
  });

  r.get("/ai/next-session", (req, res) => {
    const userId = me(req).id;
    const now = new Date();
    const lp = localParts(now, req.tz);
    const recent = repo.listSessions(userId, { from: addDays(lp.date, -30), limit: 200 });
    // Completed focus blocks today since the last long break.
    let sinceLong = 0;
    for (const s of recent) {
      if (s.localDate !== lp.date || s.kind === "long_break") break;
      if (s.kind === "focus" && s.completed) sinceLong++;
    }
    res.json({ suggestion: suggestNextSession(recent, repo.getSettings(userId), { now, localHour: lp.hour, focusSinceLongBreak: sinceLong }) });
  });

  r.get("/ai/insights", h((req, res) => {
    const { cur, prev, sessions } = periodStats(me(req).id, req.tz, 14);
    const insights = buildInsights(cur, prev, sessions, repo.getSettings(me(req).id));
    const pro = me(req).plan === "pro";
    res.json({ insights: pro ? insights : insights.slice(0, FREE_INSIGHTS), locked: pro ? 0 : Math.max(0, insights.length - FREE_INSIGHTS) });
  }));

  r.post("/ai/report", requirePro, aiLimiter, h(async (req, res) => {
    const body = z.object({ days: z.number().int().min(7).max(90).default(7), refresh: z.boolean().default(false) }).parse(req.body ?? {});
    const userId = me(req).id;
    const settings = repo.getSettings(userId);
    const { cur, prev, sessions } = periodStats(userId, req.tz, body.days);
    const insights = buildInsights(cur, prev, sessions, settings);
    const fallback = heuristicReport(cur, insights);
    if (!claudeEnabled() || cur.totals.sessionsStarted === 0) return res.json({ report: fallback });

    // Cache per (period, data fingerprint) so repeated opens don't re-bill the API.
    const key = `${body.days}:${cur.range.to}:${cur.totals.sessionsStarted}:${cur.totals.focusMinutes}`;
    const cached = !body.refresh && repo.getCache<typeof fallback>(userId, "report", key);
    if (cached) return res.json({ report: cached });
    try {
      const report = await claudeReport(cur, prev, insights, settings);
      repo.setCache(userId, "report", key, report);
      res.json({ report });
    } catch (e) {
      console.warn("Claude report failed, using heuristic:", (e as Error).message);
      res.json({ report: fallback, warning: "AI coach unavailable right now — showing the built-in analysis." });
    }
  }));

  r.post("/ai/plan", requirePro, aiLimiter, h(async (req, res) => {
    const hhmm = z.string().regex(/^\d\d:\d\d$/);
    const body = z.object({ start: hhmm, end: hhmm, intention: z.string().max(500).default(""), useAi: z.boolean().default(true) }).parse(req.body);
    if (body.end <= body.start) throw new HttpError(400, "End must be after start", "VALIDATION");
    const userId = me(req).id;
    const settings = repo.getSettings(userId);
    const tasks = repo.listTasks(userId, false);
    if (!tasks.length) throw new HttpError(400, "Add a few tasks first — the planner schedules your task list.", "VALIDATION");
    const t = today(req.tz);
    const peaks = peakHours(repo.listSessions(userId, { from: addDays(t, -30), to: t })).slice(0, 3).map((p) => p.hour);
    const window = { start: body.start, end: body.end };
    if (body.useAi && claudeEnabled()) {
      try {
        return res.json({ plan: await claudeDayPlan(tasks, settings, window, peaks, body.intention) });
      } catch (e) {
        console.warn("Claude plan failed, using heuristic:", (e as Error).message);
      }
    }
    res.json({ plan: heuristicDayPlan(tasks, settings, window, peaks) });
  }));

  // ---- billing (demo) ----
  // In production replace these with a Stripe Checkout session + webhook that calls repo.setPlan().
  r.post("/billing/upgrade", h((req, res) => {
    if (process.env.BILLING_MODE === "disabled") throw new HttpError(403, "Upgrades are disabled on this server.");
    res.json({ user: repo.setPlan(me(req).id, "pro") });
  }));

  r.post("/billing/downgrade", (req, res) => {
    res.json({ user: repo.setPlan(me(req).id, "free") });
  });

  return r;
}

export type { DetailedStats };
