// Pure statistics over a user's session history. No I/O here, so it is easy to unit-test.
import type { BasicStats, DetailedStats, DistractionCategory, Task } from "@focusflow/shared";
import type { SessionRow } from "./repo.ts";
import { addDays, dateRange } from "./lib/time.ts";

const mins = (s: number) => s / 60;
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const isFocus = (s: SessionRow) => s.kind === "focus";

/** Consecutive days (ending today or yesterday) with at least one completed focus session. */
export function currentStreak(sessions: SessionRow[], today: string): number {
  const days = new Set(sessions.filter((s) => isFocus(s) && s.completed).map((s) => s.localDate));
  let d = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(d)) { streak++; d = addDays(d, -1); }
  return streak;
}

export function bestStreak(sessions: SessionRow[]): number {
  const days = [...new Set(sessions.filter((s) => isFocus(s) && s.completed).map((s) => s.localDate))].sort();
  let best = 0, run = 0, prev = "";
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/**
 * Focus score (0–100): a composite that rewards *quality* focus, not just volume.
 *  - 35% completion rate of focus blocks you started
 *  - 25% self-rated focus (1–5), neutral 3 when unrated
 *  - 25% distraction-free-ness (fewer logged distractions per focused hour)
 *  - 15% volume toward the daily goal
 */
export function focusScore(sessions: SessionRow[], goalPomodorosPerDay: number, days: number): number {
  const focus = sessions.filter(isFocus);
  if (!focus.length) return 0;
  const completion = focus.filter((s) => s.completed).length / focus.length;
  const rating = avg(focus.map((s) => s.focusRating).filter((r): r is number => r != null)) ?? 3;
  const hours = focus.reduce((a, s) => a + s.actualSeconds, 0) / 3600;
  const distractions = focus.reduce((a, s) => a + s.interruptions, 0);
  const perHour = hours > 0 ? distractions / hours : 0;
  const calm = 1 / (1 + perHour / 2); // 0/hr → 1, 2/hr → .5, 6/hr → .25
  const volume = Math.min(1, focus.filter((s) => s.completed).length / Math.max(1, goalPomodorosPerDay * days));
  return Math.round(100 * (0.35 * completion + 0.25 * ((rating - 1) / 4) + 0.25 * calm + 0.15 * volume));
}

export function basicStats(sessions: SessionRow[], today: string, goal: number): BasicStats {
  const focus = sessions.filter(isFocus);
  const todays = focus.filter((s) => s.localDate === today);
  const from = addDays(today, -6);
  return {
    today: {
      focusMinutes: Math.round(mins(todays.reduce((a, s) => a + s.actualSeconds, 0))),
      pomodoros: todays.filter((s) => s.completed).length,
      goal,
    },
    streakDays: currentStreak(sessions, today),
    last7Days: dateRange(from, today).map((date) => {
      const day = focus.filter((s) => s.localDate === date);
      return {
        date,
        focusMinutes: Math.round(mins(day.reduce((a, s) => a + s.actualSeconds, 0))),
        pomodoros: day.filter((s) => s.completed).length,
      };
    }),
    totalFocusHours: round1(focus.reduce((a, s) => a + s.actualSeconds, 0) / 3600),
  };
}

export function detailedStats(
  all: SessionRow[], distractions: { category: string; session_id: string }[], tasks: Task[],
  from: string, to: string, goal: number,
): DetailedStats {
  const sessions = all.filter((s) => s.localDate >= from && s.localDate <= to);
  const focus = sessions.filter(isFocus);
  const completed = focus.filter((s) => s.completed);
  const days = dateRange(from, to);
  const focusSecs = focus.reduce((a, s) => a + s.actualSeconds, 0);
  const ratings = focus.map((s) => s.focusRating).filter((r): r is number => r != null);
  const sessionIds = new Set(focus.map((s) => s.id));
  const rangeDistractions = distractions.filter((d) => sessionIds.has(d.session_id));

  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const s of focus) heatmap[s.localWeekday]![s.localHour]! += mins(s.actualSeconds);

  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const hs = focus.filter((s) => s.localHour === hour);
    const r = avg(hs.map((s) => s.focusRating).filter((x): x is number => x != null));
    return {
      hour,
      focusMinutes: Math.round(mins(hs.reduce((a, s) => a + s.actualSeconds, 0))),
      avgRating: r == null ? null : round1(r),
      completionRate: hs.length ? round1(hs.filter((s) => s.completed).length / hs.length) : null,
    };
  });

  const byWeekday = Array.from({ length: 7 }, (_, weekday) => {
    const ws = focus.filter((s) => s.localWeekday === weekday);
    const r = avg(ws.map((s) => s.focusRating).filter((x): x is number => x != null));
    return { weekday, focusMinutes: Math.round(mins(ws.reduce((a, s) => a + s.actualSeconds, 0))), avgRating: r == null ? null : round1(r) };
  });

  const catCounts = new Map<string, number>();
  for (const d of rangeDistractions) catCounts.set(d.category, (catCounts.get(d.category) ?? 0) + 1);

  const tagMap = new Map<string, { focusMinutes: number; pomodoros: number }>();
  for (const s of focus) {
    const key = s.tag || "untagged";
    const e = tagMap.get(key) ?? { focusMinutes: 0, pomodoros: 0 };
    e.focusMinutes += mins(s.actualSeconds);
    if (s.completed) e.pomodoros++;
    tagMap.set(key, e);
  }

  const taskMap = new Map<string, number>();
  for (const s of focus) if (s.taskId) taskMap.set(s.taskId, (taskMap.get(s.taskId) ?? 0) + s.actualSeconds);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const buckets = [
    { bucket: "<15m", max: 15 }, { bucket: "15–24m", max: 25 }, { bucket: "25–39m", max: 40 },
    { bucket: "40–59m", max: 60 }, { bucket: "60m+", max: Infinity },
  ];
  const lengthDistribution = buckets.map((b, i) => {
    const lo = i === 0 ? 0 : buckets[i - 1]!.max;
    const inB = focus.filter((s) => mins(s.plannedSeconds) >= lo && mins(s.plannedSeconds) < b.max);
    return { bucket: b.bucket, completed: inB.filter((s) => s.completed).length, abandoned: inB.filter((s) => !s.completed).length };
  });

  const finished = tasks.filter((t) => t.done && t.completedPomodoros > 0);
  const estimateAccuracy = finished.length
    ? round1(finished.reduce((a, t) => a + t.completedPomodoros, 0) / finished.reduce((a, t) => a + t.estimatePomodoros, 0))
    : null;

  const deep = focus.filter((s) => s.completed && s.actualSeconds >= 45 * 60 && s.interruptions === 0);

  return {
    range: { from, to, days: days.length },
    totals: {
      focusMinutes: Math.round(mins(focusSecs)),
      pomodoros: completed.length,
      sessionsStarted: focus.length,
      completionRate: focus.length ? round1(completed.length / focus.length * 100) / 100 : 0,
      avgFocusRating: ratings.length ? round1(avg(ratings)!) : null,
      avgSessionMinutes: focus.length ? round1(mins(focusSecs) / focus.length) : 0,
      distractionsPerHour: focusSecs ? round1(rangeDistractions.length / (focusSecs / 3600)) : 0,
      deepWorkMinutes: Math.round(mins(deep.reduce((a, s) => a + s.actualSeconds, 0))),
      focusScore: focusScore(sessions, goal, days.length),
      bestStreakDays: bestStreak(all),
      activeDays: new Set(focus.map((s) => s.localDate)).size,
    },
    daily: days.map((date) => {
      const ds = sessions.filter((s) => s.localDate === date);
      const df = ds.filter(isFocus);
      const r = avg(df.map((s) => s.focusRating).filter((x): x is number => x != null));
      return {
        date,
        focusMinutes: Math.round(mins(df.reduce((a, s) => a + s.actualSeconds, 0))),
        pomodoros: df.filter((s) => s.completed).length,
        focusScore: focusScore(ds, goal, 1),
        avgRating: r == null ? null : round1(r),
      };
    }),
    heatmap: heatmap.map((row) => row.map((v) => Math.round(v))),
    byHour,
    byWeekday,
    distractions: [...catCounts.entries()]
      .map(([category, count]) => ({ category: category as DistractionCategory, count }))
      .sort((a, b) => b.count - a.count),
    byTag: [...tagMap.entries()]
      .map(([tag, v]) => ({ tag, focusMinutes: Math.round(v.focusMinutes), pomodoros: v.pomodoros }))
      .sort((a, b) => b.focusMinutes - a.focusMinutes),
    byTask: [...taskMap.entries()]
      .map(([taskId, secs]) => {
        const t = taskById.get(taskId);
        return {
          taskId, title: t?.title ?? "Deleted task", focusMinutes: Math.round(mins(secs)),
          estimatePomodoros: t?.estimatePomodoros ?? 0, completedPomodoros: t?.completedPomodoros ?? 0,
        };
      })
      .sort((a, b) => b.focusMinutes - a.focusMinutes)
      .slice(0, 15),
    lengthDistribution,
    estimateAccuracy,
  };
}

export function sessionsToCsv(sessions: SessionRow[], tasks: Task[]): string {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["started_at", "ended_at", "local_date", "kind", "planned_min", "actual_min", "completed", "task", "tag", "focus_rating", "energy", "distractions", "note"];
  const lines = sessions.map((s) =>
    [s.startedAt, s.endedAt, s.localDate, s.kind, round1(mins(s.plannedSeconds)), round1(mins(s.actualSeconds)), s.completed,
      s.taskId ? titles.get(s.taskId) ?? "" : "", s.tag, s.focusRating ?? "", s.energy ?? "", s.interruptions, s.note].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
