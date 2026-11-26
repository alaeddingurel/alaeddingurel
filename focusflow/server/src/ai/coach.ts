// The "focus coach" heuristics engine. Always available (no API key needed) and
// also used to give Claude a grounded, pre-digested view of the user's data.
import type {
  CoachReport, DayPlan, DayPlanBlock, DetailedStats, Insight, NextSessionSuggestion, Settings, Task,
} from "@focusflow/shared";
import type { SessionRow } from "../repo.ts";

const round5 = (n: number) => Math.round(n / 5) * 5;
const floor5 = (n: number) => Math.floor(n / 5) * 5;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

export const MIN_SESSIONS_FOR_ADAPTIVE = 5;

/** Hours where the user's focus is consistently best (needs ≥3 rated sessions in the hour). */
export function peakHours(sessions: SessionRow[]): { hour: number; score: number }[] {
  const focus = sessions.filter((s) => s.kind === "focus");
  const byHour = new Map<number, SessionRow[]>();
  for (const s of focus) byHour.set(s.localHour, [...(byHour.get(s.localHour) ?? []), s]);
  const scored: { hour: number; score: number }[] = [];
  for (const [hour, ss] of byHour) {
    if (ss.length < 3) continue;
    const completion = ss.filter((s) => s.completed).length / ss.length;
    const rating = avg(ss.map((s) => s.focusRating).filter((r): r is number => r != null)) ?? 3;
    const calm = 1 / (1 + avg(ss.map((s) => s.interruptions))!);
    scored.push({ hour, score: 0.45 * ((rating - 1) / 4) + 0.35 * completion + 0.2 * calm });
  }
  return scored.sort((a, b) => b.score - a.score);
}

const BREAK_ACTIVITIES = {
  short: [
    "Stand up and stretch your neck, shoulders and wrists for 60 seconds.",
    "Look at something 20+ feet away for 20 seconds — your eyes will thank you.",
    "Refill your water and take a few slow breaths (4s in, 6s out).",
    "Walk to a window and get some daylight on your face.",
    "Do 10 squats or calf raises to get blood moving.",
  ],
  long: [
    "Take a 10-minute walk outside — no phone if you can manage it.",
    "Have a proper snack away from your desk.",
    "Do a short body-scan or NSDR session lying down.",
    "Tidy your workspace and write down what you'll tackle next.",
    "Call or chat with someone — social breaks recharge differently.",
  ],
  fatigue: [
    "You've been going hard. Step fully away — a walk or lying down beats scrolling.",
    "Consider a 20-minute nap or non-sleep deep rest; your next block will be sharper.",
  ],
};

/**
 * Suggest the next focus/break lengths from recent behaviour.
 * `recent` must be sorted newest first.
 */
export function suggestNextSession(
  recent: SessionRow[], settings: Settings, ctx: { now: Date; localHour: number; focusSinceLongBreak: number },
): NextSessionSuggestion {
  const base = settings.focusMinutes;
  const focus = recent.filter((s) => s.kind === "focus").slice(0, 30);
  const reasons: string[] = [];
  let minutes = base;
  let confidence = 0.3;

  if (focus.length < MIN_SESSIONS_FOR_ADAPTIVE) {
    reasons.push(`Using your configured ${base} min — the coach adapts after ${MIN_SESSIONS_FOR_ADAPTIVE} focus sessions (${focus.length} so far).`);
  } else {
    const last15 = focus.slice(0, 15);
    const completion = last15.filter((s) => s.completed).length / last15.length;
    const rating = avg(last15.map((s) => s.focusRating).filter((r): r is number => r != null));
    const completed = last15.filter((s) => s.completed);
    const abandoned = last15.filter((s) => !s.completed);
    const overruns = completed.filter((s) => s.actualSeconds > s.plannedSeconds * 1.15);
    const typical = median(completed.map((s) => s.plannedSeconds / 60)) || base;
    minutes = typical;
    confidence = Math.min(0.9, 0.4 + focus.length / 50);

    if (completed.length >= 4 && overruns.length / completed.length >= 0.4) {
      minutes = round5(median(overruns.map((s) => s.actualSeconds / 60)));
      reasons.push(`You kept going past the timer in ${overruns.length} of your last ${completed.length} blocks — matching your natural flow length.`);
    } else if (completion >= 0.85 && (rating ?? 4) >= 3.8) {
      minutes = typical + 5;
      reasons.push(`${Math.round(completion * 100)}% completion${rating ? ` with ${rating.toFixed(1)}/5 focus` : ""} — stretching by 5 min to build focus stamina.`);
    } else if (completion < 0.6 && abandoned.length) {
      const quitAt = median(abandoned.map((s) => s.actualSeconds / 60));
      minutes = Math.max(10, floor5(Math.max(quitAt * 1.1, typical - 10)));
      reasons.push(`You finished ${Math.round(completion * 100)}% of recent blocks and usually stop around ${Math.round(quitAt)} min — a shorter block you can win builds momentum.`);
    } else {
      reasons.push(`Your recent blocks are steady (${Math.round(completion * 100)}% completed) — keeping ${round5(typical)} min.`);
    }

    // Time-of-day adjustment.
    const hourRated = focus.filter((s) => s.localHour === ctx.localHour && s.focusRating != null);
    const allRated = focus.filter((s) => s.focusRating != null);
    if (hourRated.length >= 3 && allRated.length >= 6) {
      const h = avg(hourRated.map((s) => s.focusRating!))!;
      const all = avg(allRated.map((s) => s.focusRating!))!;
      if (h <= all - 0.5) {
        minutes -= 5;
        reasons.push(`Your focus around ${fmtHour(ctx.localHour)} averages ${h.toFixed(1)}/5 vs ${all.toFixed(1)} overall — trimming 5 min.`);
      } else if (h >= all + 0.4) {
        reasons.push(`${fmtHour(ctx.localHour)} is one of your sharper hours (${h.toFixed(1)}/5) — a good time for your hardest task.`);
      }
    }
  }

  minutes = Math.min(90, Math.max(10, round5(minutes)));

  const isLong = ctx.focusSinceLongBreak + 1 >= settings.longBreakInterval;
  let breakMinutes = isLong ? settings.longBreakMinutes : settings.shortBreakMinutes;

  // Fatigue: lots of focus in the last 3 hours with no long break.
  let fatigueWarning: string | undefined;
  const threeHoursAgo = ctx.now.getTime() - 3 * 3600_000;
  const recentWindow = recent.filter((s) => new Date(s.endedAt).getTime() >= threeHoursAgo);
  const focusMinLast3h = recentWindow.filter((s) => s.kind === "focus").reduce((a, s) => a + s.actualSeconds / 60, 0);
  const hadLongBreak = recentWindow.some((s) => s.kind === "long_break" || (s.kind === "short_break" && s.actualSeconds >= 15 * 60));
  if (settings.labs.burnoutGuard && focusMinLast3h >= 140 && !hadLongBreak) {
    fatigueWarning = `${Math.round(focusMinLast3h)} min of focus in the last 3 hours without a real break. Quality drops off from here — take a longer recharge.`;
    breakMinutes = Math.max(breakMinutes, settings.longBreakMinutes);
  }

  const pool = fatigueWarning ? BREAK_ACTIVITIES.fatigue : isLong ? BREAK_ACTIVITIES.long : BREAK_ACTIVITIES.short;
  const breakActivity = settings.labs.smartBreaks ? pool[(ctx.now.getMinutes() + focus.length) % pool.length] : undefined;

  return {
    focusMinutes: minutes,
    breakMinutes,
    breakKind: isLong || fatigueWarning ? "long_break" : "short_break",
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    breakActivity,
    fatigueWarning,
  };
}

const DISTRACTION_TIPS: Record<string, string> = {
  phone: "Put your phone in another room (or a drawer) during focus blocks — out of sight measurably reduces checking.",
  social: "Use a site blocker during focus blocks, and save a 'later' list for links you feel the urge to open.",
  people: "Signal you're in focus mode — headphones, a status message, or a 'back at :25' note.",
  thought: "Keep a scratch pad next to you. Write the stray thought down in 5 words and return to the task.",
  noise: "Try the ambient noise in Labs (brown noise masks speech well) or noise-cancelling headphones.",
  other: "Review your distraction notes after a few days — patterns are usually easy to fix once named.",
};

/** Turn stats for the current period (and the one before) into concrete, actionable insights. */
export function buildInsights(
  cur: DetailedStats, prev: DetailedStats | null, sessions: SessionRow[], settings: Settings,
): Insight[] {
  const out: Insight[] = [];
  const t = cur.totals;

  if (t.sessionsStarted === 0) {
    return [{
      id: "start", severity: "info", title: "Let's collect some data",
      body: "Complete a few focus sessions and rate them afterwards. The coach starts spotting patterns after about 5 sessions.",
    }];
  }

  if (prev && prev.totals.focusMinutes > 0) {
    const delta = (t.focusMinutes - prev.totals.focusMinutes) / prev.totals.focusMinutes;
    if (Math.abs(delta) >= 0.15) {
      out.push({
        id: "trend", severity: delta > 0 ? "positive" : "warning",
        title: delta > 0 ? "Focus time is up" : "Focus time dipped",
        body: `${Math.round(t.focusMinutes / 60 * 10) / 10}h this period vs ${Math.round(prev.totals.focusMinutes / 60 * 10) / 10}h before (${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%).`,
        metric: `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`,
      });
    }
  }

  const peaks = peakHours(sessions).slice(0, 2);
  if (peaks.length) {
    const hours = peaks.map((p) => p.hour).sort((a, b) => a - b);
    out.push({
      id: "peak", severity: "info", title: "Your peak focus window",
      body: `You do your best work around ${hours.map(fmtHour).join(" and ")}. Protect that time for your hardest task and push meetings and email elsewhere.`,
      metric: hours.map(fmtHour).join(" · "),
    });
  }

  if (t.sessionsStarted >= 5 && t.completionRate < 0.65) {
    const suggested = Math.max(10, floor5(settings.focusMinutes * 0.75));
    out.push({
      id: "completion", severity: "warning", title: "Blocks may be too long",
      body: `You finish ${Math.round(t.completionRate * 100)}% of the focus blocks you start. Shorter blocks that you complete beat long ones you abandon — try ${suggested} minutes for a week.`,
      metric: `${Math.round(t.completionRate * 100)}%`,
      action: { label: `Switch to ${suggested} min`, settingsPatch: { focusMinutes: suggested } },
    });
  } else if (t.sessionsStarted >= 8 && t.completionRate >= 0.9 && (t.avgFocusRating ?? 0) >= 4) {
    const suggested = Math.min(90, settings.focusMinutes + 5);
    out.push({
      id: "stretch", severity: "positive", title: "Ready for longer blocks",
      body: `${Math.round(t.completionRate * 100)}% completion with ${t.avgFocusRating}/5 focus. You can likely handle ${suggested}-minute blocks.`,
      action: { label: `Try ${suggested} min`, settingsPatch: { focusMinutes: suggested } },
    });
  }

  const top = cur.distractions[0];
  if (top && t.distractionsPerHour >= 1) {
    out.push({
      id: "distraction", severity: "warning", title: `Biggest distraction: ${top.category}`,
      body: `${t.distractionsPerHour} distractions per focused hour; ${top.category} accounts for ${top.count}. ${DISTRACTION_TIPS[top.category] ?? ""}`,
      metric: `${t.distractionsPerHour}/h`,
    });
  } else if (t.focusMinutes >= 120 && t.distractionsPerHour < 0.5) {
    out.push({ id: "calm", severity: "positive", title: "Distraction-free", body: "Very few logged distractions — whatever your setup is, it's working." });
  }

  // Skipped breaks: focus block starting < 2 min after the previous focus ended.
  const chrono = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  let skipped = 0;
  for (let i = 1; i < chrono.length; i++) {
    const a = chrono[i - 1]!, b = chrono[i]!;
    if (a.kind === "focus" && b.kind === "focus" && new Date(b.startedAt).getTime() - new Date(a.endedAt).getTime() < 120_000) skipped++;
  }
  if (skipped >= 3) {
    out.push({
      id: "breaks", severity: "warning", title: "You're skipping breaks",
      body: `${skipped} times you went straight into another focus block. Breaks aren't lost time — they're when attention recovers. Turn on auto-start breaks to make them the default.`,
      action: { label: "Auto-start breaks", settingsPatch: { autoStartBreaks: true } },
    });
  }

  if (cur.estimateAccuracy != null && cur.estimateAccuracy >= 1.3) {
    out.push({
      id: "estimates", severity: "info", title: "Tasks take longer than planned",
      body: `Finished tasks took ${cur.estimateAccuracy}× your estimates. ${cur.estimateAccuracy >= 3 ? "Try breaking big tasks into smaller ones you can estimate in 1–4 pomodoros." : `Padding estimates by ~${Math.round((cur.estimateAccuracy - 1) * 100)}% will make your day plans realistic.`}`,
      metric: `${cur.estimateAccuracy}×`,
    });
  }

  if (t.deepWorkMinutes >= 90) {
    out.push({
      id: "deep", severity: "positive", title: "Real deep work",
      body: `${Math.round(t.deepWorkMinutes / 60 * 10) / 10}h of uninterrupted 45+ minute blocks. That's the kind of focus that moves hard problems.`,
    });
  }

  const goalDays = cur.daily.filter((d) => d.pomodoros >= settings.dailyGoalPomodoros).length;
  if (cur.range.days >= 7) {
    out.push({
      id: "goal", severity: goalDays >= cur.range.days / 2 ? "positive" : "info", title: "Daily goal",
      body: `You hit your goal of ${settings.dailyGoalPomodoros} pomodoros on ${goalDays} of ${cur.range.days} days.${goalDays === 0 && t.pomodoros > 0 ? " Consider a smaller goal you can hit consistently — consistency compounds." : ""}`,
      metric: `${goalDays}/${cur.range.days}`,
    });
  }

  return out;
}

export function heuristicReport(cur: DetailedStats, insights: Insight[]): CoachReport {
  const t = cur.totals;
  const hours = Math.round(t.focusMinutes / 6) / 10;
  const headline =
    t.sessionsStarted === 0 ? "Your focus story starts with the first session"
    : t.focusScore >= 75 ? "Strong, consistent focus"
    : t.focusScore >= 50 ? "Solid base — a few tweaks will compound"
    : "Lots of room to grow — start small";
  const experiments: CoachReport["experiments"] = [];
  if (insights.some((i) => i.id === "distraction")) experiments.push({
    title: "Phone-free focus for 3 days",
    hypothesis: "Removing the phone from sight will cut distractions per hour by at least half.",
    howTo: "Put the phone in another room before each focus block. Compare distractions/hour on the stats page afterwards.",
  });
  if (insights.some((i) => i.id === "peak")) experiments.push({
    title: "Hardest task first, in your peak window",
    hypothesis: "Scheduling your most demanding task in your peak hours raises your focus rating.",
    howTo: "Use 'Plan my day' each morning and keep the peak blocks for one hard task only.",
  });
  experiments.push({
    title: "Rate every session for a week",
    hypothesis: "More ratings make the adaptive timer and peak-hour detection noticeably more accurate.",
    howTo: "Leave 'Ask for reflection' on and rate focus 1–5 after each block. It takes 3 seconds.",
  });
  return {
    generatedAt: new Date().toISOString(),
    source: "heuristic",
    headline,
    summary: t.sessionsStarted
      ? `${hours}h of focus across ${t.pomodoros} completed pomodoros on ${t.activeDays} active days. Completion rate ${Math.round(t.completionRate * 100)}%, focus score ${t.focusScore}/100.`
      : "No sessions in this period yet.",
    focusScore: t.focusScore,
    insights,
    experiments: experiments.slice(0, 3),
  };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Greedy scheduler: fills the window with focus/break blocks, putting big tasks in peak hours. */
export function heuristicDayPlan(
  tasks: Task[], settings: Settings, window: { start: string; end: string }, peaks: number[],
): DayPlan {
  const queue = tasks.filter((t) => !t.done).map((t) => ({ t, remaining: Math.max(1, t.estimatePomodoros - t.completedPomodoros) }));
  const blocks: DayPlanBlock[] = [];
  let cur = toMin(window.start);
  const end = toMin(window.end);
  let sinceLong = 0;
  const peakSet = new Set(peaks);

  while (cur + settings.focusMinutes <= end && queue.length) {
    const inPeak = peakSet.has(Math.floor(cur / 60));
    queue.sort((a, b) => (inPeak ? b.remaining - a.remaining : 0));
    const item = queue[0]!;
    blocks.push({ start: toHHMM(cur), end: toHHMM(cur + settings.focusMinutes), kind: "focus", taskId: item.t.id, label: item.t.title });
    cur += settings.focusMinutes;
    if (--item.remaining <= 0) queue.shift();
    sinceLong++;
    const long = sinceLong >= settings.longBreakInterval;
    const len = long ? settings.longBreakMinutes : settings.shortBreakMinutes;
    if (cur + len > end) break;
    blocks.push({ start: toHHMM(cur), end: toHHMM(cur + len), kind: long ? "long_break" : "short_break", taskId: null, label: long ? "Long break" : "Short break" });
    cur += len;
    if (long) sinceLong = 0;
  }
  if (blocks.at(-1)?.kind !== "focus") blocks.pop();

  const unscheduled = queue.reduce((a, q) => a + q.remaining, 0);
  return {
    source: "heuristic",
    rationale:
      (peaks.length ? `Biggest tasks are placed in your peak hours (${peaks.map(fmtHour).join(", ")}). ` : "") +
      `Blocks follow your ${settings.focusMinutes}/${settings.shortBreakMinutes} rhythm with a long break every ${settings.longBreakInterval}.` +
      (unscheduled ? ` ${unscheduled} pomodoro(s) didn't fit — consider moving them to tomorrow.` : ""),
    blocks,
  };
}
