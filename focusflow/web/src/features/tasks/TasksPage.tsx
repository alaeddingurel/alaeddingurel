import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { Task } from "@focusflow/shared";
import { api } from "../../api/client";
import { useTimer } from "../../state/timer";
import { useToast } from "../../state/toast";
import { Spinner } from "../../components/ui";
import { minutesLabel } from "../../lib/format";

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("");
  const [estimate, setEstimate] = useState(2);
  const [filter, setFilter] = useState<string>("all");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const timer = useTimer();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.listTasks().then((r) => setTasks(r.tasks)).catch((e) => { toast(e.message, "error"); setTasks([]); });
  }, [timer.sessionsVersion, toast]);

  const tags = useMemo(() => [...new Set((tasks ?? []).map((t) => t.tag).filter(Boolean))].sort(), [tasks]);
  const visible = (tasks ?? []).filter((t) => (showDone || !t.done) && (filter === "all" || t.tag === filter));
  const open = (tasks ?? []).filter((t) => !t.done);
  const remaining = open.reduce((a, t) => a + Math.max(0, t.estimatePomodoros - t.completedPomodoros), 0);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const { task } = await api.createTask({ title: title.trim(), tag: tag.trim(), estimatePomodoros: estimate });
      setTasks((ts) => [...(ts ?? []), task]);
      setTitle("");
    } catch (err) { toast((err as Error).message, "error"); }
  }

  async function patch(id: string, p: Parameters<typeof api.updateTask>[1]) {
    try {
      const { task } = await api.updateTask(id, p);
      setTasks((ts) => ts?.map((t) => (t.id === id ? task : t)) ?? null);
      if (p.done && timer.taskId === id) timer.setTask(null);
    } catch (err) { toast((err as Error).message, "error"); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this task? Its focus history stays in your stats.")) return;
    await api.deleteTask(id).catch((err) => toast(err.message, "error"));
    setTasks((ts) => ts?.filter((t) => t.id !== id) ?? null);
    if (timer.taskId === id) timer.setTask(null);
  }

  function focusOn(id: string) {
    timer.setTask(id);
    if (timer.mode !== "focus" && timer.status === "idle") timer.switchMode("focus");
    navigate("/");
  }

  if (!tasks) return <Spinner />;

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="muted">{open.length} open · ~{remaining} pomodoros (≈{minutesLabel(remaining * 25)}) left</p>
        </div>
      </header>

      <form className="card task-form" onSubmit={add}>
        <input className="grow" placeholder="What do you want to get done?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" />
        <input className="tag-input" placeholder="#tag" value={tag} onChange={(e) => setTag(e.target.value.replace(/^#/, ""))} list="tag-list" aria-label="Tag" />
        <datalist id="tag-list">{tags.map((t) => <option key={t} value={t} />)}</datalist>
        <label className="est" title="Estimated pomodoros">
          <span aria-hidden>🍅</span>
          <input type="number" min={1} max={50} value={estimate} onChange={(e) => setEstimate(Math.max(1, Number(e.target.value) || 1))} aria-label="Estimated pomodoros" />
        </label>
        <button className="btn primary" disabled={!title.trim()}>Add</button>
      </form>

      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All</button>
          {tags.map((t) => <button key={t} className={`chip ${filter === t ? "on" : ""}`} onClick={() => setFilter(t)}>#{t}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
      </div>

      {visible.length === 0 ? (
        <div className="empty card">
          <p><b>No tasks yet.</b></p>
          <p className="muted">Add what you want to work on, estimate it in pomodoros, and the coach can plan your day around it.</p>
        </div>
      ) : (
        <ul className="task-list">
          {visible.map((t) => {
            const pct = Math.min(1, t.completedPomodoros / t.estimatePomodoros);
            const over = t.completedPomodoros > t.estimatePomodoros;
            return (
              <li key={t.id} className={`task card ${t.done ? "done" : ""} ${timer.taskId === t.id ? "current" : ""}`}>
                <input type="checkbox" className="task-check" checked={t.done} onChange={(e) => void patch(t.id, { done: e.target.checked })} aria-label={`Mark ${t.title} done`} />
                <div className="task-main">
                  {editing === t.id ? (
                    <input autoFocus defaultValue={t.title} aria-label="Edit title"
                      onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== t.title) void patch(t.id, { title: e.target.value.trim() }); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
                  ) : (
                    <button className="task-title" onDoubleClick={() => setEditing(t.id)} onClick={() => !t.done && focusOn(t.id)} title="Click to focus on this · double-click to rename">
                      {t.title}
                    </button>
                  )}
                  <div className="task-meta">
                    {t.tag && <span className="tag">#{t.tag}</span>}
                    <span className={over ? "warn-text" : "muted"}>🍅 {t.completedPomodoros}/{t.estimatePomodoros}</span>
                    {t.focusSeconds > 0 && <span className="muted">{minutesLabel(t.focusSeconds / 60)} focused</span>}
                  </div>
                  <div className="task-progress"><span style={{ width: `${pct * 100}%` }} className={over ? "over" : ""} /></div>
                </div>
                <div className="task-actions">
                  <button className="icon-btn" aria-label="Fewer pomodoros" onClick={() => void patch(t.id, { estimatePomodoros: Math.max(1, t.estimatePomodoros - 1) })}>−</button>
                  <button className="icon-btn" aria-label="More pomodoros" onClick={() => void patch(t.id, { estimatePomodoros: Math.min(50, t.estimatePomodoros + 1) })}>+</button>
                  {!t.done && <button className="btn small" onClick={() => focusOn(t.id)}>Focus</button>}
                  <button className="icon-btn danger" aria-label={`Delete ${t.title}`} onClick={() => void remove(t.id)}>🗑</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
