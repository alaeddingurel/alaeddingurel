// Seeds a demo account with ~8 weeks of realistic history so the stats and coach have something to show.
//   npm run seed            → demo@focusflow.app / focusflow123 (Pro)
import { openDb } from "./db.ts";
import { createRepo } from "./repo.ts";
import { hashPassword } from "./lib/crypto.ts";
import type { DistractionCategory } from "@focusflow/shared";

const EMAIL = process.env.SEED_EMAIL ?? "demo@focusflow.app";
const PASSWORD = process.env.SEED_PASSWORD ?? "focusflow123";
const TZ = process.env.SEED_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

export async function seedDemo(dbFile?: string) {
  const db = openDb(dbFile);
  const repo = createRepo(db);
  const existing = repo.getUserWithHashByEmail(EMAIL);
  if (existing) repo.deleteUser(existing.id);

  const user = repo.createUser(EMAIL, "Demo User", await hashPassword(PASSWORD));
  repo.setPlan(user.id, "pro");
  repo.saveSettings(user.id, { labs: { adaptiveTimer: true, flowMode: false, ambientSound: true, smartBreaks: true, burnoutGuard: true } });

  const taskDefs = [
    { title: "Write Q4 product spec", tag: "writing", estimatePomodoros: 8 },
    { title: "Refactor billing module", tag: "coding", estimatePomodoros: 10 },
    { title: "Study for AWS certification", tag: "learning", estimatePomodoros: 12 },
    { title: "Inbox zero + admin", tag: "admin", estimatePomodoros: 3 },
    { title: "Design onboarding flow", tag: "design", estimatePomodoros: 6 },
    { title: "Read 'Deep Work' ch. 3–5", tag: "learning", estimatePomodoros: 4 },
  ];
  const tasks = taskDefs.map((t) => repo.createTask(user.id, t));

  const now = Date.now();
  const cats: DistractionCategory[] = ["phone", "phone", "phone", "social", "social", "thought", "people", "noise"];
  for (let daysAgo = 56; daysAgo >= 0; daysAgo--) {
    const day = new Date(now - daysAgo * 86400_000);
    const weekday = (day.getDay() + 6) % 7;
    if (weekday >= 5 && rand() < 0.65) continue; // lighter weekends
    if (rand() < 0.08) continue; // occasional day off
    const progress = 1 - daysAgo / 56; // improves over time
    const blocks = Math.round(3 + rand() * 4 + progress * 3);
    let t = new Date(day);
    t.setHours(8 + Math.floor(rand() * 2), Math.floor(rand() * 50), 0, 0);
    let sinceLong = 0;
    for (let b = 0; b < blocks; b++) {
      if (t.getTime() > now) break;
      const hour = t.getHours();
      const peak = hour >= 9 && hour <= 11;
      const slump = hour >= 14 && hour <= 15;
      const planned = (progress > 0.5 && peak && rand() < 0.5 ? (rand() < 0.5 ? 50 : 40) : 25) * 60;
      const quitChance = 0.28 - progress * 0.18 + (slump ? 0.15 : 0) - (peak ? 0.08 : 0);
      const completed = rand() > quitChance;
      const actual = completed ? planned : Math.round(planned * (0.3 + rand() * 0.5));
      const nDistr = Math.max(0, Math.round((slump ? 1.6 : 0.7) - progress * 0.6 + (rand() - 0.5) * 1.5));
      const rating = Math.max(1, Math.min(5, Math.round(3 + (peak ? 1 : 0) - (slump ? 1 : 0) + progress * 0.6 - nDistr * 0.4 + (rand() - 0.5))));
      const task = pick(tasks);
      const start = new Date(t);
      const end = new Date(t.getTime() + actual * 1000);
      repo.createSession(user.id, {
        taskId: task.id, kind: "focus", plannedSeconds: planned, actualSeconds: actual,
        startedAt: start.toISOString(), endedAt: end.toISOString(), completed,
        focusRating: rand() < 0.85 ? rating : null, energy: Math.max(1, Math.min(5, rating + Math.round(rand() - 0.5))),
        distractions: Array.from({ length: nDistr }, () => ({ at: new Date(start.getTime() + rand() * actual * 1000).toISOString(), category: pick(cats) })),
      }, TZ);
      t = end;
      if (completed) sinceLong++;
      const long = sinceLong >= 4;
      const brk = (long ? 15 : 5) * 60;
      if (rand() > 0.12 || long) {
        repo.createSession(user.id, {
          kind: long ? "long_break" : "short_break", plannedSeconds: brk, actualSeconds: brk,
          startedAt: t.toISOString(), endedAt: new Date(t.getTime() + brk * 1000).toISOString(), completed: true,
        }, TZ);
        t = new Date(t.getTime() + brk * 1000);
      }
      if (long) sinceLong = 0;
      if (hour === 12 && rand() < 0.7) t = new Date(t.getTime() + 50 * 60_000); // lunch
    }
  }
  // Realistic estimates: finished tasks ran ~20% over; open tasks still have a few pomodoros left.
  const done = new Set([tasks[3]!.id, tasks[5]!.id]);
  for (const t of repo.listTasks(user.id)) {
    const estimatePomodoros = done.has(t.id)
      ? Math.max(1, Math.round(t.completedPomodoros / 1.2))
      : t.completedPomodoros + 3 + Math.floor(rand() * 5);
    repo.updateTask(user.id, t.id, { estimatePomodoros: Math.min(50, estimatePomodoros), done: done.has(t.id) });
  }
  db.close();
  return { email: EMAIL, password: PASSWORD };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { email, password } = await seedDemo();
  console.log(`Seeded demo account → ${email} / ${password} (Pro, timezone ${TZ})`);
}
