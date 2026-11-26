// Types and defaults shared by the API server and the web client.
// Keep this file dependency-free so both sides can import it as TS source.

export type Plan = "free" | "pro";
export type SessionKind = "focus" | "short_break" | "long_break";
export type AlarmSound = "bell" | "chime" | "digital" | "wood" | "none";
export type AmbientSound = "none" | "white" | "pink" | "brown" | "rain";
export type Theme = "system" | "light" | "dark";
export type TimerStyle = "ring" | "bar" | "minimal";
export type DistractionCategory = "phone" | "social" | "people" | "thought" | "noise" | "other";

export const DISTRACTION_CATEGORIES: { id: DistractionCategory; label: string; emoji: string }[] = [
  { id: "phone", label: "Phone", emoji: "📱" },
  { id: "social", label: "Social / web", emoji: "🌐" },
  { id: "people", label: "People", emoji: "🗣️" },
  { id: "thought", label: "Wandering thought", emoji: "💭" },
  { id: "noise", label: "Noise", emoji: "🔊" },
  { id: "other", label: "Other", emoji: "❔" },
];

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  proSince: string | null;
  createdAt: string;
}

export interface TimerPreset {
  id: string;
  name: string;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
}

/** Experimental features. Each one can be switched on per user from Settings → Labs. */
export interface LabsFlags {
  /** AI suggests the length of the next focus block from your history. */
  adaptiveTimer: boolean;
  /** Timer keeps counting up past zero while you're in flow, until you stop it. */
  flowMode: boolean;
  /** Generated ambient noise (white / pink / brown / rain) during focus. */
  ambientSound: boolean;
  /** Suggests a concrete break activity based on how long you've been working. */
  smartBreaks: boolean;
  /** Warns you when the coach detects fatigue (long run without real breaks). */
  burnoutGuard: boolean;
}

export interface Settings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  dailyGoalPomodoros: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  strictMode: boolean;
  confirmSkip: boolean;
  askReflection: boolean;
  sound: {
    alarm: AlarmSound;
    alarmVolume: number; // 0..1
    alarmRepeat: number; // 1..5
    tick: boolean;
    tickVolume: number;
    ambient: AmbientSound;
    ambientVolume: number;
    ambientDuringBreaks: boolean;
  };
  notifications: {
    desktop: boolean;
    titleCountdown: boolean;
    preEndWarningSeconds: number; // 0 disables
  };
  appearance: {
    theme: Theme;
    accent: string; // hex
    timerStyle: TimerStyle;
    showSeconds: boolean;
    zenMode: boolean; // hide chrome while focusing
    breakAccent: string;
  };
  labs: LabsFlags;
  presets: TimerPreset[];
}

export const DEFAULT_PRESETS: TimerPreset[] = [
  { id: "classic", name: "Classic", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4 },
  { id: "deep", name: "Deep work", focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, longBreakInterval: 3 },
  { id: "sprint", name: "Sprints", focusMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 10, longBreakInterval: 4 },
  { id: "5217", name: "52 / 17", focusMinutes: 52, shortBreakMinutes: 17, longBreakMinutes: 30, longBreakInterval: 3 },
];

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  dailyGoalPomodoros: 8,
  autoStartBreaks: false,
  autoStartFocus: false,
  strictMode: false,
  confirmSkip: true,
  askReflection: true,
  sound: {
    alarm: "bell",
    alarmVolume: 0.6,
    alarmRepeat: 2,
    tick: false,
    tickVolume: 0.2,
    ambient: "none",
    ambientVolume: 0.3,
    ambientDuringBreaks: false,
  },
  notifications: {
    desktop: true,
    titleCountdown: true,
    preEndWarningSeconds: 0,
  },
  appearance: {
    theme: "system",
    accent: "#e5484d",
    timerStyle: "ring",
    showSeconds: true,
    zenMode: false,
    breakAccent: "#30a46c",
  },
  labs: {
    adaptiveTimer: false,
    flowMode: false,
    ambientSound: true,
    smartBreaks: true,
    burnoutGuard: true,
  },
  presets: DEFAULT_PRESETS,
};

export const LIMITS = {
  focusMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 120],
  longBreakInterval: [1, 12],
  dailyGoalPomodoros: [1, 40],
} as const;

/** Deep-merge a partial settings object onto defaults, clamping numeric ranges. */
export function normalizeSettings(input: unknown): Settings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const out: any = structuredClone(DEFAULT_SETTINGS);
  for (const key of Object.keys(out)) {
    const v = src[key];
    if (v === undefined) continue;
    if (key === "presets") {
      if (Array.isArray(v)) out.presets = v.slice(0, 12).filter(isPreset);
    } else if (typeof out[key] === "object" && out[key] !== null) {
      if (v && typeof v === "object") {
        for (const sub of Object.keys(out[key])) {
          if (v[sub] !== undefined && typeof v[sub] === typeof out[key][sub]) out[key][sub] = v[sub];
        }
      }
    } else if (typeof v === typeof out[key]) {
      out[key] = v;
    }
  }
  for (const [k, [min, max]] of Object.entries(LIMITS)) {
    out[k] = clamp(Math.round(out[k]), min, max);
  }
  for (const k of ["alarmVolume", "tickVolume", "ambientVolume"] as const) {
    out.sound[k] = clamp(out.sound[k], 0, 1);
  }
  out.sound.alarmRepeat = clamp(Math.round(out.sound.alarmRepeat), 1, 5);
  out.notifications.preEndWarningSeconds = clamp(Math.round(out.notifications.preEndWarningSeconds), 0, 600);
  if (!/^#[0-9a-f]{6}$/i.test(out.appearance.accent)) out.appearance.accent = DEFAULT_SETTINGS.appearance.accent;
  if (!/^#[0-9a-f]{6}$/i.test(out.appearance.breakAccent)) out.appearance.breakAccent = DEFAULT_SETTINGS.appearance.breakAccent;
  return out as Settings;
}

function isPreset(p: any): p is TimerPreset {
  return (
    p && typeof p.id === "string" && typeof p.name === "string" &&
    [p.focusMinutes, p.shortBreakMinutes, p.longBreakMinutes, p.longBreakInterval].every(
      (n) => typeof n === "number" && n >= 1 && n <= 180,
    )
  );
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  tag: string;
  estimatePomodoros: number;
  completedPomodoros: number;
  focusSeconds: number;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  kind: SessionKind;
  plannedSeconds: number;
  actualSeconds: number;
  startedAt: string;
  endedAt: string;
  completed: boolean;
  interruptions: number;
  focusRating: number | null; // 1..5
  energy: number | null; // 1..5
  note: string;
  tag: string;
}

export interface NewSessionInput {
  taskId?: string | null;
  kind: SessionKind;
  plannedSeconds: number;
  actualSeconds: number;
  startedAt: string;
  endedAt: string;
  completed: boolean;
  focusRating?: number | null;
  energy?: number | null;
  note?: string;
  tag?: string;
  distractions?: { at: string; category: DistractionCategory; note?: string }[];
}

// ---------- Stats ----------

export interface BasicStats {
  today: { focusMinutes: number; pomodoros: number; goal: number };
  streakDays: number;
  last7Days: { date: string; focusMinutes: number; pomodoros: number }[];
  totalFocusHours: number;
}

export interface DetailedStats {
  range: { from: string; to: string; days: number };
  totals: {
    focusMinutes: number;
    pomodoros: number;
    sessionsStarted: number;
    completionRate: number; // 0..1
    avgFocusRating: number | null;
    avgSessionMinutes: number;
    distractionsPerHour: number;
    deepWorkMinutes: number; // focus blocks >= 45 min uninterrupted
    focusScore: number; // 0..100 composite
    bestStreakDays: number;
    activeDays: number;
  };
  daily: { date: string; focusMinutes: number; pomodoros: number; focusScore: number; avgRating: number | null }[];
  /** 7 x 24 matrix — weekday (0=Mon) by hour — of focus minutes. */
  heatmap: number[][];
  byHour: { hour: number; focusMinutes: number; avgRating: number | null; completionRate: number | null }[];
  byWeekday: { weekday: number; focusMinutes: number; avgRating: number | null }[];
  distractions: { category: DistractionCategory; count: number }[];
  byTag: { tag: string; focusMinutes: number; pomodoros: number }[];
  byTask: { taskId: string; title: string; focusMinutes: number; estimatePomodoros: number; completedPomodoros: number }[];
  lengthDistribution: { bucket: string; completed: number; abandoned: number }[];
  estimateAccuracy: number | null; // actual / estimated pomodoros for finished tasks
}

// ---------- AI ----------

export interface NextSessionSuggestion {
  focusMinutes: number;
  breakMinutes: number;
  breakKind: Exclude<SessionKind, "focus">;
  confidence: number; // 0..1
  reasons: string[];
  breakActivity?: string;
  fatigueWarning?: string;
}

export type InsightSeverity = "positive" | "info" | "warning";

export interface Insight {
  id: string;
  title: string;
  body: string;
  severity: InsightSeverity;
  metric?: string;
  action?: { label: string; settingsPatch?: Partial<Settings> };
}

export interface CoachReport {
  generatedAt: string;
  source: "claude" | "heuristic";
  headline: string;
  summary: string;
  focusScore: number;
  insights: Insight[];
  experiments: { title: string; hypothesis: string; howTo: string }[];
}

export interface DayPlanBlock {
  start: string; // "HH:MM"
  end: string;
  kind: SessionKind;
  taskId: string | null;
  label: string;
}

export interface DayPlan {
  source: "claude" | "heuristic";
  rationale: string;
  blocks: DayPlanBlock[];
}

export interface ApiError {
  error: string;
  code?: "UNAUTHORIZED" | "PRO_REQUIRED" | "VALIDATION" | "NOT_FOUND" | "RATE_LIMITED" | "CONFLICT";
}
