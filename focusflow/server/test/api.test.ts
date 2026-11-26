import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";

process.env.FOCUSFLOW_AI = "off";
process.env.AUTH_RATE_LIMIT = "1000";

let server: Server;
let base = "";

before(async () => {
  const { app } = createApp(openDb(":memory:"));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

/** Minimal cookie-jar client. */
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json", "x-requested-with": "focusflow", "x-timezone": "Europe/Istanbul",
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, body: text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
}

test("signup → me → logout → login", async () => {
  const api = client();
  const s = await api("POST", "/auth/signup", { email: "Ada@Example.com", password: "supersecret", name: "Ada" });
  assert.equal(s.status, 201);
  assert.equal(s.body.user.email, "ada@example.com");
  assert.equal(s.body.user.plan, "free");

  assert.equal((await api("GET", "/auth/me")).body.user.name, "Ada");
  assert.equal((await api("POST", "/auth/signup", { email: "ada@example.com", password: "supersecret", name: "X" })).status, 409);

  assert.equal((await api("POST", "/auth/logout")).status, 204);
  assert.equal((await api("GET", "/auth/me")).body.user, null);

  assert.equal((await api("POST", "/auth/login", { email: "ada@example.com", password: "wrong-password" })).status, 401);
  assert.equal((await api("POST", "/auth/login", { email: "ADA@example.com", password: "supersecret" })).status, 200);
});

test("validation and CSRF header", async () => {
  const api = client();
  const r = await api("POST", "/auth/signup", { email: "bad", password: "short", name: "" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "VALIDATION");
  const noHeader = await fetch(`${base}/auth/logout`, { method: "POST" });
  assert.equal(noHeader.status, 403);
});

test("protected routes require sign-in", async () => {
  const api = client();
  assert.equal((await api("GET", "/settings")).status, 401);
  assert.equal((await api("GET", "/stats/basic")).status, 401);
});

test("settings are normalized and persisted", async () => {
  const api = client();
  await api("POST", "/auth/signup", { email: "s@example.com", password: "supersecret", name: "S" });
  const def = await api("GET", "/settings");
  assert.equal(def.body.settings.focusMinutes, 25);
  const put = await api("PUT", "/settings", { ...def.body.settings, focusMinutes: 999, appearance: { ...def.body.settings.appearance, accent: "nope" } });
  assert.equal(put.body.settings.focusMinutes, 180); // clamped
  assert.equal(put.body.settings.appearance.accent, "#e5484d"); // invalid color rejected
  assert.equal((await api("GET", "/settings")).body.settings.focusMinutes, 180);
});

test("free users are limited on custom presets; pro users are not", async () => {
  const api = client();
  await api("POST", "/auth/signup", { email: "p@example.com", password: "supersecret", name: "P" });
  const { settings } = (await api("GET", "/settings")).body;
  const custom = [1, 2, 3].map((i) => ({ id: `c${i}`, name: `C${i}`, focusMinutes: 30, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4 }));
  const r = await api("PUT", "/settings", { ...settings, presets: [...settings.presets, ...custom] });
  assert.equal(r.status, 402);
  await api("POST", "/billing/upgrade");
  assert.equal((await api("PUT", "/settings", { ...settings, presets: [...settings.presets, ...custom] })).status, 200);
});

test("sessions feed tasks, basic stats, and Pro-gated detailed stats", async () => {
  const api = client();
  await api("POST", "/auth/signup", { email: "t@example.com", password: "supersecret", name: "T" });
  const task = (await api("POST", "/tasks", { title: "Write essay", estimatePomodoros: 3, tag: "writing" })).body.task;

  const start = new Date(Date.now() - 30 * 60_000);
  const end = new Date(start.getTime() + 25 * 60_000);
  const created = await api("POST", "/sessions", {
    taskId: task.id, kind: "focus", plannedSeconds: 1500, actualSeconds: 1500,
    startedAt: start.toISOString(), endedAt: end.toISOString(), completed: true, focusRating: 4,
    distractions: [{ at: start.toISOString(), category: "phone" }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.session.interruptions, 1);
  assert.equal(created.body.session.tag, "writing"); // inherited from task

  const tasks = (await api("GET", "/tasks")).body.tasks;
  assert.equal(tasks[0].completedPomodoros, 1);
  assert.equal(tasks[0].focusSeconds, 1500);

  const basic = (await api("GET", "/stats/basic")).body.stats;
  assert.equal(basic.today.pomodoros, 1);
  assert.equal(basic.today.focusMinutes, 25);
  assert.equal(basic.streakDays, 1);
  assert.equal(basic.last7Days.length, 7);

  const locked = await api("GET", "/stats/detailed?days=7");
  assert.equal(locked.status, 402);
  assert.equal(locked.body.code, "PRO_REQUIRED");

  await api("POST", "/billing/upgrade");
  const detailed = (await api("GET", "/stats/detailed?days=7")).body.stats;
  assert.equal(detailed.totals.pomodoros, 1);
  assert.equal(detailed.totals.avgFocusRating, 4);
  assert.equal(detailed.distractions[0].category, "phone");
  assert.equal(detailed.heatmap.length, 7);
  assert.equal(detailed.heatmap[0].length, 24);
  assert.ok(detailed.totals.focusScore > 0);

  const csv = await api("GET", "/stats/export.csv");
  assert.match(csv.body, /^started_at,ended_at/);
  assert.match(csv.body, /Write essay/);

  const report = (await api("POST", "/ai/report", { days: 7 })).body.report;
  assert.equal(report.source, "heuristic");
  assert.ok(report.insights.length > 0);

  const plan = (await api("POST", "/ai/plan", { start: "09:00", end: "12:00" })).body.plan;
  assert.ok(plan.blocks.length > 0);
  assert.equal(plan.blocks[0].kind, "focus");
  assert.equal(plan.blocks[0].taskId, task.id);
});

test("users cannot see each other's data", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "a1@example.com", password: "supersecret", name: "A" });
  await b("POST", "/auth/signup", { email: "b1@example.com", password: "supersecret", name: "B" });
  const task = (await a("POST", "/tasks", { title: "private" })).body.task;
  assert.equal((await b("GET", "/tasks")).body.tasks.length, 0);
  assert.equal((await b("PATCH", `/tasks/${task.id}`, { title: "hacked" })).status, 404);
  assert.equal((await b("DELETE", `/tasks/${task.id}`)).status, 404);
});
