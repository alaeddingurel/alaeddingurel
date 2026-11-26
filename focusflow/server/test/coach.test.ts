import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type Settings } from "@focusflow/shared";
import type { SessionRow } from "../src/repo.ts";
import { suggestNextSession, heuristicDayPlan, peakHours } from "../src/ai/coach.ts";
import { currentStreak, bestStreak, focusScore } from "../src/stats.ts";

let n = 0;
function session(p: Partial<SessionRow> & { minutesAgo?: number }): SessionRow {
  const planned = p.plannedSeconds ?? 1500;
  const actual = p.actualSeconds ?? planned;
  const end = new Date(Date.now() - (p.minutesAgo ?? 600) * 60_000);
  return {
    id: `s${n++}`, taskId: null, kind: "focus", plannedSeconds: planned, actualSeconds: actual,
    startedAt: new Date(end.getTime() - actual * 1000).toISOString(), endedAt: end.toISOString(),
    completed: true, interruptions: 0, focusRating: 4, energy: null, note: "", tag: "",
    localHour: 10, localWeekday: 1, localDate: "2026-11-20", ...p,
  };
}
const settings: Settings = { ...DEFAULT_SETTINGS, labs: { ...DEFAULT_SETTINGS.labs } };
const ctx = { now: new Date(), localHour: 10, focusSinceLongBreak: 0 };

test("uses configured length until enough history exists", () => {
  const s = suggestNextSession([session({}), session({})], settings, ctx);
  assert.equal(s.focusMinutes, 25);
  assert.ok(s.confidence < 0.5);
});

test("stretches block length when completion and focus are high", () => {
  const recent = Array.from({ length: 10 }, () => session({ focusRating: 5 }));
  assert.equal(suggestNextSession(recent, settings, ctx).focusMinutes, 30);
});

test("shortens block length when the user keeps abandoning", () => {
  const recent = Array.from({ length: 10 }, (_, i) =>
    i % 3 === 0 ? session({}) : session({ completed: false, actualSeconds: 14 * 60 }),
  );
  const s = suggestNextSession(recent, settings, ctx);
  assert.ok(s.focusMinutes < 25, `expected < 25, got ${s.focusMinutes}`);
  assert.ok(s.focusMinutes >= 10);
});

test("follows natural flow length when the user overruns the timer", () => {
  const recent = Array.from({ length: 8 }, () => session({ actualSeconds: 42 * 60 }));
  assert.equal(suggestNextSession(recent, settings, ctx).focusMinutes, 40);
});

test("long break after the configured interval; fatigue guard kicks in", () => {
  assert.equal(suggestNextSession([], settings, { ...ctx, focusSinceLongBreak: 3 }).breakKind, "long_break");
  const heavy = Array.from({ length: 6 }, (_, i) => session({ minutesAgo: 10 + i * 26 }));
  const s = suggestNextSession(heavy, settings, ctx);
  assert.ok(s.fatigueWarning);
  assert.equal(s.breakMinutes, settings.longBreakMinutes);
});

test("peak hours rank better-rated hours first", () => {
  const ss = [
    ...Array.from({ length: 4 }, () => session({ localHour: 9, focusRating: 5 })),
    ...Array.from({ length: 4 }, () => session({ localHour: 15, focusRating: 2, completed: false })),
  ];
  assert.deepEqual(peakHours(ss).map((p) => p.hour), [9, 15]);
});

test("streaks", () => {
  const ss = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-22"].map((d) => session({ localDate: d }));
  assert.equal(currentStreak(ss, "2026-11-22"), 1);
  assert.equal(currentStreak(ss, "2026-11-21"), 3); // yesterday counts if today is empty
  assert.equal(bestStreak(ss), 3);
});

test("focus score rewards completion, rating and calm", () => {
  const good = Array.from({ length: 8 }, () => session({ focusRating: 5 }));
  const bad = Array.from({ length: 8 }, () => session({ focusRating: 1, completed: false, interruptions: 4, actualSeconds: 600 }));
  assert.ok(focusScore(good, 8, 1) > 90);
  assert.ok(focusScore(bad, 8, 1) < 20);
});

test("day plan fits the window and alternates focus / break", () => {
  const tasks = [
    { id: "a", title: "A", notes: "", tag: "", estimatePomodoros: 2, completedPomodoros: 0, focusSeconds: 0, done: false, createdAt: "", completedAt: null },
    { id: "b", title: "B", notes: "", tag: "", estimatePomodoros: 5, completedPomodoros: 0, focusSeconds: 0, done: false, createdAt: "", completedAt: null },
  ];
  const plan = heuristicDayPlan(tasks, settings, { start: "09:00", end: "11:00" }, [9]);
  assert.equal(plan.blocks[0]!.taskId, "b"); // biggest task in the peak hour
  assert.ok(plan.blocks.every((b) => b.end <= "11:00"));
  assert.equal(plan.blocks.at(-1)!.kind, "focus");
  for (let i = 1; i < plan.blocks.length; i++) assert.notEqual(plan.blocks[i]!.kind === "focus", plan.blocks[i - 1]!.kind === "focus");
});
