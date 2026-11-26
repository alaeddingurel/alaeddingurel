import type {
  ApiError, BasicStats, CoachReport, DayPlan, DetailedStats, FocusSession, Insight, NewSessionInput,
  NextSessionSuggestion, Settings, Task, User,
} from "@focusflow/shared";

export class ApiRequestError extends Error {
  constructor(public status: number, message: string, public code?: ApiError["code"]) {
    super(message);
  }
  get isProRequired() { return this.code === "PRO_REQUIRED"; }
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "focusflow",
        "X-Timezone": tz,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "You appear to be offline.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, (data as ApiError).error ?? res.statusText, (data as ApiError).code);
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("GET", "/auth/me"),
  signup: (b: { email: string; password: string; name: string }) => request<{ user: User }>("POST", "/auth/signup", b),
  login: (b: { email: string; password: string }) => request<{ user: User }>("POST", "/auth/login", b),
  logout: () => request<void>("POST", "/auth/logout"),
  updateAccount: (b: { name: string }) => request<{ user: User }>("PATCH", "/account", b),
  changePassword: (b: { currentPassword: string; newPassword: string }) => request<void>("POST", "/account/password", b),
  deleteAccount: (password: string) => request<void>("DELETE", "/account", { password }),

  getSettings: () => request<{ settings: Settings }>("GET", "/settings"),
  saveSettings: (s: Settings) => request<{ settings: Settings }>("PUT", "/settings", s),

  listTasks: () => request<{ tasks: Task[] }>("GET", "/tasks"),
  createTask: (t: { title: string; tag?: string; estimatePomodoros?: number; notes?: string }) => request<{ task: Task }>("POST", "/tasks", t),
  updateTask: (id: string, p: Partial<Pick<Task, "title" | "tag" | "notes" | "estimatePomodoros" | "done">>) =>
    request<{ task: Task }>("PATCH", `/tasks/${id}`, p),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),

  createSession: (s: NewSessionInput) => request<{ session: FocusSession }>("POST", "/sessions", s),
  rateSession: (id: string, p: { focusRating?: number | null; energy?: number | null; note?: string }) =>
    request<{ session: FocusSession }>("PATCH", `/sessions/${id}`, p),
  listSessions: (limit = 50) => request<{ sessions: FocusSession[] }>("GET", `/sessions?limit=${limit}`),

  basicStats: () => request<{ stats: BasicStats }>("GET", "/stats/basic"),
  detailedStats: (days: number) => request<{ stats: DetailedStats; previous: DetailedStats["totals"] | null }>("GET", `/stats/detailed?days=${days}`),

  aiStatus: () => request<{ claude: boolean }>("GET", "/ai/status"),
  nextSession: () => request<{ suggestion: NextSessionSuggestion }>("GET", "/ai/next-session"),
  insights: () => request<{ insights: Insight[]; locked: number }>("GET", "/ai/insights"),
  report: (days: number, refresh = false) => request<{ report: CoachReport; warning?: string }>("POST", "/ai/report", { days, refresh }),
  plan: (b: { start: string; end: string; intention: string; useAi: boolean }) => request<{ plan: DayPlan }>("POST", "/ai/plan", b),

  upgrade: () => request<{ user: User }>("POST", "/billing/upgrade"),
  downgrade: () => request<{ user: User }>("POST", "/billing/downgrade"),
};

// ---- Offline queue for finished sessions: never lose a pomodoro to a flaky connection. ----
const QUEUE_KEY = "ff.pendingSessions";

function readQueue(): NewSessionInput[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(q: NewSessionInput[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage unavailable */ }
}

export async function saveSessionReliably(s: NewSessionInput): Promise<FocusSession | null> {
  try {
    return (await api.createSession(s)).session;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status !== 0 && e.status < 500) throw e;
    writeQueue([...readQueue(), s]);
    return null;
  }
}

export async function flushSessionQueue(): Promise<number> {
  const q = readQueue();
  if (!q.length) return 0;
  const remaining: NewSessionInput[] = [];
  let sent = 0;
  for (const s of q) {
    try { await api.createSession(s); sent++; } catch (e) {
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) continue; // drop invalid
      remaining.push(s);
    }
  }
  writeQueue(remaining);
  return sent;
}
