// Optional Claude-powered coaching. Only aggregated, anonymous statistics are sent —
// never email addresses, names or free-text notes.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { CoachReport, DayPlan, DetailedStats, Insight, Settings, Task } from "@focusflow/shared";

const MODEL = process.env.FOCUSFLOW_AI_MODEL ?? "claude-opus-5-5";

/** Claude is used when explicitly enabled, or when an API credential is present in the env. */
export function claudeEnabled(): boolean {
  const mode = process.env.FOCUSFLOW_AI;
  if (mode === "off") return false;
  if (mode === "claude") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

const SYSTEM = `You are FocusFlow's focus coach. You help people improve the quality and consistency of their focused work using the Pomodoro technique.

You receive pre-computed statistics about one user and a list of insights already detected by a rules engine. Ground every claim in those numbers; never invent data. When data is thin, say so and suggest how to collect better data (e.g. rating sessions).

Style: warm, direct and specific, like a good coach. Prefer one concrete next step over generic advice. No medical claims. Keep the summary under 80 words and each insight body under 50 words.`;

const ReportSchema = z.object({
  headline: z.string().describe("One short sentence, max 10 words"),
  summary: z.string(),
  insights: z.array(z.object({
    title: z.string(),
    body: z.string(),
    severity: z.enum(["positive", "info", "warning"]),
    metric: z.string().describe("A short number or label to display, or empty string"),
  })).describe("3 to 6 insights, most important first"),
  experiments: z.array(z.object({
    title: z.string(),
    hypothesis: z.string(),
    howTo: z.string(),
  })).describe("1 to 3 small experiments to run over the next week"),
});

const PlanSchema = z.object({
  rationale: z.string().describe("2-3 sentences explaining the plan"),
  blocks: z.array(z.object({
    start: z.string().describe("HH:MM 24h"),
    end: z.string().describe("HH:MM 24h"),
    kind: z.enum(["focus", "short_break", "long_break"]),
    taskId: z.string().describe("Task id for focus blocks, empty string for breaks"),
    label: z.string(),
  })),
});

function compactStats(s: DetailedStats) {
  // Keep the prompt small and stable: drop empty hours / days.
  return {
    range: s.range,
    totals: s.totals,
    byHour: s.byHour.filter((h) => h.focusMinutes > 0),
    byWeekday: s.byWeekday,
    distractions: s.distractions,
    byTag: s.byTag.slice(0, 8),
    lengthDistribution: s.lengthDistribution,
    estimateAccuracy: s.estimateAccuracy,
    dailyFocusMinutes: s.daily.map((d) => d.focusMinutes),
  };
}

async function parse<T extends z.ZodType>(schema: T, user: string, maxTokens = 16000): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // re-run on a fallback model if a safety classifier declines
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (!response.parsed_output) throw new Error(`Claude returned no structured output (stop_reason=${response.stop_reason})`);
  return response.parsed_output as z.infer<T>;
}

export async function claudeReport(
  cur: DetailedStats, prev: DetailedStats | null, ruleInsights: Insight[], settings: Settings,
): Promise<CoachReport> {
  const payload = {
    timerSettings: {
      focusMinutes: settings.focusMinutes, shortBreakMinutes: settings.shortBreakMinutes,
      longBreakMinutes: settings.longBreakMinutes, dailyGoalPomodoros: settings.dailyGoalPomodoros,
    },
    currentPeriod: compactStats(cur),
    previousPeriod: prev ? { totals: prev.totals } : null,
    rulesEngineInsights: ruleInsights.map(({ title, body, metric }) => ({ title, body, metric })),
  };
  const out = await parse(
    ReportSchema,
    `Write this user's focus report for the period.\n\n<data>\n${JSON.stringify(payload)}\n</data>`,
  );
  // Keep the rules engine's one-click actions: they map to real settings changes.
  const actions = ruleInsights.filter((i) => i.action);
  return {
    generatedAt: new Date().toISOString(),
    source: "claude",
    headline: out.headline,
    summary: out.summary,
    focusScore: cur.totals.focusScore,
    insights: [
      ...out.insights.map((i, n) => ({ id: `ai-${n}`, title: i.title, body: i.body, severity: i.severity, metric: i.metric || undefined })),
      ...actions,
    ],
    experiments: out.experiments.slice(0, 3),
  };
}

export async function claudeDayPlan(
  tasks: Task[], settings: Settings, window: { start: string; end: string }, peaks: number[], intention: string,
): Promise<DayPlan> {
  const open = tasks.filter((t) => !t.done).map((t) => ({
    id: t.id, title: t.title, tag: t.tag,
    remainingPomodoros: Math.max(1, t.estimatePomodoros - t.completedPomodoros),
  }));
  const payload = {
    window, peakFocusHours: peaks,
    rhythm: {
      focusMinutes: settings.focusMinutes, shortBreakMinutes: settings.shortBreakMinutes,
      longBreakMinutes: settings.longBreakMinutes, longBreakEvery: settings.longBreakInterval,
    },
    tasks: open,
    userIntention: intention.slice(0, 500),
  };
  const out = await parse(
    PlanSchema,
    `Plan this user's focus day as a sequence of non-overlapping blocks inside the window.
Rules: follow the rhythm (you may shorten the last block to fit); put the most demanding or highest-priority work in peak hours; respect the user's intention if given; only use the task ids provided; don't schedule more pomodoros for a task than it has remaining.

<data>\n${JSON.stringify(payload)}\n</data>`,
  );
  const ids = new Set(open.map((t) => t.id));
  return {
    source: "claude",
    rationale: out.rationale,
    blocks: out.blocks
      .filter((b) => /^\d\d:\d\d$/.test(b.start) && /^\d\d:\d\d$/.test(b.end))
      .map((b) => ({ ...b, taskId: b.kind === "focus" && ids.has(b.taskId) ? b.taskId : null })),
  };
}
