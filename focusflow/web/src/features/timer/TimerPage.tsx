import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { DISTRACTION_CATEGORIES, type BasicStats, type SessionKind, type Task } from "@focusflow/shared";
import { api } from "../../api/client";
import { useTimer } from "../../state/timer";
import { useSettings } from "../../state/settings";
import { useUser } from "../../state/auth";
import { useToast } from "../../state/toast";
import { Modal, Segmented } from "../../components/ui";
import { greeting, KIND_LABEL } from "../../lib/format";
import { TimerDisplay } from "./TimerDisplay";

export function TimerPage() {
  const t = useTimer();
  const { settings, update } = useSettings();
  const user = useUser();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<BasicStats | null>(null);
  const [distractOpen, setDistractOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [quickTask, setQuickTask] = useState("");

  useEffect(() => {
    api.listTasks().then((r) => setTasks(r.tasks.filter((x) => !x.done))).catch(() => {});
    api.basicStats().then((r) => setStats(r.stats)).catch(() => {});
  }, [t.sessionsVersion]);

  const isFocus = t.mode === "focus";

  const confirmSkip = useCallback(() => {
    if (isFocus && t.status !== "idle" && settings.confirmSkip && !window.confirm("End this focus block early? It will be logged as incomplete.")) return;
    t.skip();
  }, [isFocus, t, settings.confirmSkip]);

  const logDistraction = (c: (typeof DISTRACTION_CATEGORIES)[number]) => {
    t.logDistraction(c.id);
    setDistractOpen(false);
    toast(`${c.emoji} Logged — now back to it.`, "info");
  };

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, dialog[open]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); if (t.status === "running") t.pause(); else if (t.status === "overtime") t.finishFlow(); else t.start(); }
      else if (k === "r") t.reset();
      else if (k === "s") confirmSkip();
      else if (k === "d" && t.status !== "idle" && isFocus) setDistractOpen(true);
      else if (k === "z") update((s) => ({ ...s, appearance: { ...s.appearance, zenMode: !s.appearance.zenMode } }));
      else if (k === "1" && t.status === "idle") t.switchMode("focus");
      else if (k === "2" && t.status === "idle") t.switchMode("short_break");
      else if (k === "3" && t.status === "idle") t.switchMode("long_break");
      else if (k === "?") setHelpOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, confirmSkip, isFocus, update]);

  async function addQuickTask() {
    if (!quickTask.trim()) return;
    try {
      const { task } = await api.createTask({ title: quickTask.trim() });
      setTasks((ts) => [...ts, task]);
      t.setTask(task.id);
      setQuickTask("");
    } catch (e) { toast((e as Error).message, "error"); }
  }

  const sug = t.suggestion;
  const currentTask = tasks.find((x) => x.id === t.taskId);
  const goal = stats?.today.goal ?? settings.dailyGoalPomodoros;
  const done = stats?.today.pomodoros ?? 0;
  const label = isFocus && currentTask ? currentTask.title : KIND_LABEL[t.mode];

  return (
    <div className="timer-page">
      <div className="timer-col">
        <p className="greeting muted">{greeting(user.name)}</p>
        <Segmented<SessionKind>
          label="Timer mode" value={t.mode}
          onChange={(m) => { if (t.status === "idle" || window.confirm("Switch mode? The current session will be discarded.")) t.switchMode(m); }}
          options={[{ value: "focus", label: "Focus" }, { value: "short_break", label: "Short break" }, { value: "long_break", label: "Long break" }]}
        />

        <TimerDisplay remaining={t.remainingSeconds} progress={t.progress} overtime={t.status === "overtime"}
          style={settings.appearance.timerStyle} showSeconds={settings.appearance.showSeconds} label={label} />

        <div className="controls">
          {t.status === "overtime" ? (
            <button className="btn primary xl" onClick={t.finishFlow}>Finish block</button>
          ) : t.status === "running" ? (
            <button className="btn primary xl" onClick={t.pause} disabled={!t.canPause} title={t.canPause ? "Pause (Space)" : "Strict mode: no pausing during focus"}>
              {t.canPause ? "Pause" : "🔒 Locked in"}
            </button>
          ) : (
            <button className="btn primary xl" onClick={t.start}>{t.status === "paused" ? "Resume" : "Start"}</button>
          )}
          <button className="btn ghost" onClick={t.reset} disabled={t.status === "idle"} title="Reset (R)">Reset</button>
          <button className="btn ghost" onClick={confirmSkip} title="Skip (S)">{isFocus && t.status !== "idle" ? "End early" : "Skip"}</button>
        </div>

        {isFocus && t.status !== "idle" && (
          <button className="btn distraction" onClick={() => setDistractOpen(true)} title="Log a distraction (D)">
            ⚡ Got distracted{t.distractions.length ? ` · ${t.distractions.length}` : ""}
          </button>
        )}

        <div className="task-picker">
          <label htmlFor="task-select" className="sr-only">Current task</label>
          <select id="task-select" value={t.taskId ?? ""} onChange={(e) => t.setTask(e.target.value || null)}>
            <option value="">No task selected</option>
            {tasks.map((x) => (
              <option key={x.id} value={x.id}>{x.title} ({x.completedPomodoros}/{x.estimatePomodoros})</option>
            ))}
          </select>
          <div className="quick-add">
            <input placeholder="Quick add a task…" value={quickTask} onChange={(e) => setQuickTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addQuickTask(); }} aria-label="Quick add task" />
            <button className="btn small" onClick={() => void addQuickTask()} disabled={!quickTask.trim()}>Add</button>
          </div>
        </div>

        <div className="today" aria-label={`${done} of ${goal} pomodoros today`}>
          <div className="dots">
            {Array.from({ length: Math.max(goal, done) }, (_, i) => (
              <span key={i} className={`pdot ${i < done ? "done" : ""} ${i >= goal ? "extra" : ""}`} />
            ))}
          </div>
          <span className="muted">{done}/{goal} today{stats?.streakDays ? ` · 🔥 ${stats.streakDays}-day streak` : ""}</span>
        </div>
        <button className="link-btn muted small" onClick={() => setHelpOpen(true)}>Keyboard shortcuts (?)</button>
      </div>

      <aside className="side-col">
        {(sug?.fatigueWarning && settings.labs.burnoutGuard) && (
          <div className="card callout warning" role="alert"><strong>Time to recharge.</strong> {sug.fatigueWarning}</div>
        )}

        {!isFocus && sug?.breakActivity && settings.labs.smartBreaks && (
          <div className="card callout break-idea"><span className="eyebrow">Break idea</span><p>{sug.breakActivity}</p></div>
        )}

        <div className="card coach-card">
          <header className="card-head">
            <h3><span className="sparkle" aria-hidden>✦</span> Coach</h3>
            {settings.labs.adaptiveTimer ? <span className="chip on">Adaptive on</span> : (
              <button className="chip" onClick={() => update((s) => ({ ...s, labs: { ...s.labs, adaptiveTimer: true } }))}>Enable adaptive</button>
            )}
          </header>
          {sug ? (
            <>
              <p className="coach-big">Next: <b>{sug.focusMinutes} min</b> focus · {sug.breakMinutes} min {sug.breakKind === "long_break" ? "long " : ""}break</p>
              <ul className="reasons">{sug.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              {!settings.labs.adaptiveTimer && sug.focusMinutes !== settings.focusMinutes && (
                <button className="btn small" onClick={() => update({ focusMinutes: sug.focusMinutes })}>Use {sug.focusMinutes} min</button>
              )}
              <div className="confidence" title="How much data the suggestion is based on">
                <span style={{ width: `${sug.confidence * 100}%` }} />
              </div>
            </>
          ) : <p className="muted">Complete a session to get personalised suggestions.</p>}
          <Link to="/coach" className="link small">Open coach →</Link>
        </div>

        <div className="card presets-card">
          <h3>Presets</h3>
          <div className="chips">
            {settings.presets.map((p) => {
              const on = p.focusMinutes === settings.focusMinutes && p.shortBreakMinutes === settings.shortBreakMinutes && p.longBreakMinutes === settings.longBreakMinutes;
              return (
                <button key={p.id} className={`chip ${on ? "on" : ""}`} disabled={t.status !== "idle"}
                  onClick={() => update({ focusMinutes: p.focusMinutes, shortBreakMinutes: p.shortBreakMinutes, longBreakMinutes: p.longBreakMinutes, longBreakInterval: p.longBreakInterval })}>
                  {p.name} <small>{p.focusMinutes}/{p.shortBreakMinutes}</small>
                </button>
              );
            })}
          </div>
          <Link to="/settings" className="link small">Customize →</Link>
        </div>

        {stats && (
          <div className="card mini-week">
            <h3>This week</h3>
            <div className="mini-bars" role="img" aria-label="Focus minutes, last 7 days">
              {stats.last7Days.map((d) => {
                const max = Math.max(60, ...stats.last7Days.map((x) => x.focusMinutes));
                return (
                  <div key={d.date} className="mini-bar" title={`${d.date}: ${d.focusMinutes} min`}>
                    <span style={{ height: `${(d.focusMinutes / max) * 100}%` }} />
                    <small>{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</small>
                  </div>
                );
              })}
            </div>
            <Link to="/stats" className="link small">All stats →</Link>
          </div>
        )}
      </aside>

      <Modal open={distractOpen} onClose={() => setDistractOpen(false)} title="What pulled you away?">
        <p className="muted">Name it, then let it go. Patterns show up in your stats.</p>
        <div className="distraction-grid">
          {DISTRACTION_CATEGORIES.map((c, i) => (
            <button key={c.id} className="distraction-opt" onClick={() => logDistraction(c)} autoFocus={i === 0}>
              <span className="emoji" aria-hidden>{c.emoji}</span>{c.label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          {[["Space", "Start / pause (finish in flow mode)"], ["R", "Reset"], ["S", "Skip / end early"], ["D", "Log a distraction"],
            ["Z", "Toggle zen mode"], ["1 · 2 · 3", "Focus · short break · long break"], ["?", "This help"]].map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
