// Data-access layer: every SQL statement lives here so routes stay thin.
import {
  normalizeSettings, type FocusSession, type NewSessionInput, type Plan, type Settings, type Task, type User,
} from "@focusflow/shared";
import { tx, type DB } from "./db.ts";
import { newId } from "./lib/crypto.ts";
import { localParts } from "./lib/time.ts";

type Row = Record<string, any>;

const toUser = (r: Row): User => ({
  id: r.id, email: r.email, name: r.name, plan: r.plan as Plan, proSince: r.pro_since ?? null, createdAt: r.created_at,
});

const toTask = (r: Row): Task => ({
  id: r.id, title: r.title, notes: r.notes, tag: r.tag,
  estimatePomodoros: r.estimate_pomodoros,
  completedPomodoros: Number(r.completed_pomodoros ?? 0),
  focusSeconds: Number(r.focus_seconds ?? 0),
  done: !!r.done, createdAt: r.created_at, completedAt: r.completed_at ?? null,
});

export const toSession = (r: Row): FocusSession => ({
  id: r.id, taskId: r.task_id ?? null, kind: r.kind, plannedSeconds: r.planned_seconds, actualSeconds: r.actual_seconds,
  startedAt: r.started_at, endedAt: r.ended_at, completed: !!r.completed,
  interruptions: Number(r.interruptions ?? 0), focusRating: r.focus_rating ?? null, energy: r.energy ?? null,
  note: r.note, tag: r.tag,
});

export function createRepo(db: DB) {
  const now = () => new Date().toISOString();

  return {
    // ---------- users ----------
    createUser(email: string, name: string, passwordHash: string): User {
      const id = newId();
      db.prepare(`INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)`)
        .run(id, email, name, passwordHash, now());
      return this.getUser(id)!;
    },
    getUser(id: string): User | null {
      const r = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Row | undefined;
      return r ? toUser(r) : null;
    },
    getUserWithHashByEmail(email: string): (User & { passwordHash: string }) | null {
      const r = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Row | undefined;
      return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
    },
    getPasswordHash(userId: string): string | null {
      const r = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as Row | undefined;
      return r?.password_hash ?? null;
    },
    updateUser(id: string, patch: { name?: string; passwordHash?: string }) {
      if (patch.name !== undefined) db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(patch.name, id);
      if (patch.passwordHash !== undefined) db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(patch.passwordHash, id);
      return this.getUser(id)!;
    },
    setPlan(id: string, plan: Plan) {
      db.prepare(`UPDATE users SET plan = ?, pro_since = ? WHERE id = ?`).run(plan, plan === "pro" ? now() : null, id);
      return this.getUser(id)!;
    },
    deleteUser(id: string) {
      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    },

    // ---------- auth sessions ----------
    createAuthSession(tokenHash: string, userId: string, ttlMs: number, userAgent: string | undefined) {
      db.prepare(`INSERT INTO auth_sessions (token_hash,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)`)
        .run(tokenHash, userId, now(), new Date(Date.now() + ttlMs).toISOString(), userAgent?.slice(0, 200) ?? null);
    },
    getUserByToken(tokenHash: string): User | null {
      const r = db.prepare(
        `SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
      ).get(tokenHash, now()) as Row | undefined;
      return r ? toUser(r) : null;
    },
    deleteAuthSession(tokenHash: string) {
      db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
    },
    deleteOtherAuthSessions(userId: string, keepTokenHash: string) {
      db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?`).run(userId, keepTokenHash);
    },
    purgeExpiredAuthSessions() {
      db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).run(now());
    },

    // ---------- settings ----------
    getSettings(userId: string): Settings {
      const r = db.prepare(`SELECT json FROM settings WHERE user_id = ?`).get(userId) as Row | undefined;
      return normalizeSettings(r ? JSON.parse(r.json) : {});
    },
    saveSettings(userId: string, input: unknown): Settings {
      const s = normalizeSettings(input);
      db.prepare(
        `INSERT INTO settings (user_id,json,updated_at) VALUES (?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      ).run(userId, JSON.stringify(s), now());
      return s;
    },

    // ---------- tasks ----------
    listTasks(userId: string, includeDone = true): Task[] {
      const rows = db.prepare(
        `SELECT t.*,
           (SELECT COUNT(*) FROM sessions s WHERE s.task_id = t.id AND s.kind = 'focus' AND s.completed = 1) AS completed_pomodoros,
           (SELECT COALESCE(SUM(actual_seconds),0) FROM sessions s WHERE s.task_id = t.id AND s.kind = 'focus') AS focus_seconds
         FROM tasks t WHERE t.user_id = ? ${includeDone ? "" : "AND t.done = 0"}
         ORDER BY t.done ASC, t.sort_order ASC, t.created_at ASC`,
      ).all(userId) as Row[];
      return rows.map(toTask);
    },
    getTask(userId: string, id: string): Task | null {
      return this.listTasks(userId).find((t) => t.id === id) ?? null;
    },
    createTask(userId: string, t: { title: string; notes?: string; tag?: string; estimatePomodoros?: number }): Task {
      const id = newId();
      const max = db.prepare(`SELECT COALESCE(MAX(sort_order),0) m FROM tasks WHERE user_id = ?`).get(userId) as Row;
      db.prepare(
        `INSERT INTO tasks (id,user_id,title,notes,tag,estimate_pomodoros,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, userId, t.title, t.notes ?? "", t.tag ?? "", t.estimatePomodoros ?? 1, Number(max.m) + 1, now());
      return this.getTask(userId, id)!;
    },
    updateTask(
      userId: string, id: string,
      p: Partial<{ title: string; notes: string; tag: string; estimatePomodoros: number; done: boolean; sortOrder: number }>,
    ): Task | null {
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      const map: Record<string, string> = { title: "title", notes: "notes", tag: "tag", estimatePomodoros: "estimate_pomodoros", sortOrder: "sort_order" };
      for (const [k, col] of Object.entries(map)) {
        const v = (p as Row)[k];
        if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); }
      }
      if (p.done !== undefined) {
        sets.push(`done = ?`, `completed_at = ?`);
        vals.push(p.done ? 1 : 0, p.done ? now() : null);
      }
      if (sets.length) db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
      return this.getTask(userId, id);
    },
    deleteTask(userId: string, id: string): boolean {
      return db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`).run(id, userId).changes > 0;
    },

    // ---------- sessions ----------
    createSession(userId: string, s: NewSessionInput, tz: string): FocusSession {
      const id = newId();
      const started = new Date(s.startedAt);
      const lp = localParts(started, tz);
      const task = s.taskId ? this.getTask(userId, s.taskId) : null;
      tx(db, () => {
        db.prepare(
          `INSERT INTO sessions (id,user_id,task_id,kind,planned_seconds,actual_seconds,started_at,ended_at,completed,
             focus_rating,energy,note,tag,local_hour,local_weekday,local_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, userId, task?.id ?? null, s.kind, s.plannedSeconds, s.actualSeconds, started.toISOString(),
          new Date(s.endedAt).toISOString(), s.completed ? 1 : 0, s.focusRating ?? null, s.energy ?? null,
          s.note ?? "", s.tag || task?.tag || "", lp.hour, lp.weekday, lp.date,
        );
        const ins = db.prepare(`INSERT INTO distractions (id,session_id,user_id,at,category,note) VALUES (?,?,?,?,?,?)`);
        for (const d of s.distractions ?? []) ins.run(newId(), id, userId, new Date(d.at).toISOString(), d.category, d.note ?? "");
      });
      return this.getSession(userId, id)!;
    },
    getSession(userId: string, id: string): FocusSession | null {
      const r = db.prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM distractions d WHERE d.session_id = s.id) AS interruptions
         FROM sessions s WHERE s.id = ? AND s.user_id = ?`,
      ).get(id, userId) as Row | undefined;
      return r ? toSession(r) : null;
    },
    rateSession(userId: string, id: string, p: { focusRating?: number | null; energy?: number | null; note?: string }) {
      if (p.focusRating !== undefined) db.prepare(`UPDATE sessions SET focus_rating = ? WHERE id = ? AND user_id = ?`).run(p.focusRating, id, userId);
      if (p.energy !== undefined) db.prepare(`UPDATE sessions SET energy = ? WHERE id = ? AND user_id = ?`).run(p.energy, id, userId);
      if (p.note !== undefined) db.prepare(`UPDATE sessions SET note = ? WHERE id = ? AND user_id = ?`).run(p.note, id, userId);
      return this.getSession(userId, id);
    },
    deleteSession(userId: string, id: string) {
      return db.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`).run(id, userId).changes > 0;
    },
    listSessions(userId: string, opts: { from?: string; to?: string; limit?: number } = {}): (FocusSession & { localHour: number; localWeekday: number; localDate: string })[] {
      const rows = db.prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM distractions d WHERE d.session_id = s.id) AS interruptions
         FROM sessions s WHERE s.user_id = ? AND s.local_date >= ? AND s.local_date <= ?
         ORDER BY s.started_at DESC LIMIT ?`,
      ).all(userId, opts.from ?? "0000-00-00", opts.to ?? "9999-99-99", opts.limit ?? 10_000) as Row[];
      return rows.map((r) => ({ ...toSession(r), localHour: r.local_hour, localWeekday: r.local_weekday, localDate: r.local_date }));
    },
    listDistractions(userId: string, fromIso: string) {
      return db.prepare(`SELECT category, at, session_id FROM distractions WHERE user_id = ? AND at >= ?`).all(userId, fromIso) as {
        category: string; at: string; session_id: string;
      }[];
    },

    // ---------- AI cache ----------
    getCache<T>(userId: string, kind: string, key: string): T | null {
      const r = db.prepare(`SELECT json FROM ai_cache WHERE user_id = ? AND kind = ? AND key = ?`).get(userId, kind, key) as Row | undefined;
      return r ? (JSON.parse(r.json) as T) : null;
    },
    setCache(userId: string, kind: string, key: string, value: unknown) {
      db.prepare(
        `INSERT INTO ai_cache (user_id,kind,key,json,created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id,kind) DO UPDATE SET key = excluded.key, json = excluded.json, created_at = excluded.created_at`,
      ).run(userId, kind, key, JSON.stringify(value), now());
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
export type SessionRow = ReturnType<Repo["listSessions"]>[number];
