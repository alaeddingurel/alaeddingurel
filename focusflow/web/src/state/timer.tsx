// The timer engine. Time is derived from timestamps (never from counting ticks), so it stays
// accurate in background tabs and survives page reloads via localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DistractionCategory, NewSessionInput, NextSessionSuggestion, SessionKind, Settings } from "@focusflow/shared";
import { api, flushSessionQueue, saveSessionReliably } from "../api/client";
import { useSettings } from "./settings";
import { useToast } from "./toast";
import { useUser } from "./auth";
import { playAlarm, playTick, playWarning, setAmbient, unlockAudio } from "../lib/sound";
import { notify } from "../lib/notify";
import { clock, KIND_LABEL } from "../lib/format";

export type TimerStatus = "idle" | "running" | "paused" | "overtime";

interface Persisted {
  mode: SessionKind;
  status: TimerStatus;
  plannedSeconds: number;
  accumulatedMs: number;
  resumedAt: number | null;
  startedAt: string | null;
  focusCount: number; // completed focus blocks since the last long break
  taskId: string | null;
  distractions: { at: string; category: DistractionCategory }[];
}

export interface PendingReview {
  sessionId: string | null;
  minutes: number;
  completed: boolean;
}

interface TimerCtx extends Persisted {
  elapsedSeconds: number;
  remainingSeconds: number; // negative in overtime
  progress: number; // 0..1
  suggestion: NextSessionSuggestion | null;
  review: PendingReview | null;
  sessionsVersion: number;
  canPause: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  finishFlow: () => void;
  switchMode: (m: SessionKind) => void;
  setTask: (id: string | null) => void;
  logDistraction: (c: DistractionCategory) => void;
  closeReview: () => void;
  plannedFor: (m: SessionKind) => number;
}

const Ctx = createContext<TimerCtx | null>(null);

function load(settings: Settings, key: string): Persisted {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch { /* ignore */ }
  return {
    mode: "focus", status: "idle", plannedSeconds: settings.focusMinutes * 60, accumulatedMs: 0,
    resumedAt: null, startedAt: null, focusCount: 0, taskId: null, distractions: [],
  };
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const toast = useToast();
  const KEY = `ff.timer.${useUser().id}`; // per account, so a shared browser never mixes timers
  const [s, setS] = useState<Persisted>(() => load(settings, KEY));
  const [now, setNow] = useState(Date.now());
  const [suggestion, setSuggestion] = useState<NextSessionSuggestion | null>(null);
  const [review, setReview] = useState<PendingReview | null>(null);
  const [sessionsVersion, setSessionsVersion] = useState(0);

  const sRef = useRef(s); sRef.current = s;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const suggestionRef = useRef(suggestion); suggestionRef.current = suggestion;
  const warnedRef = useRef(false);
  const lastTickSec = useRef<number | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [s, KEY]);

  const plannedFor = useCallback((mode: SessionKind) => {
    const st = settingsRef.current;
    const sug = suggestionRef.current;
    if (mode === "focus") return (st.labs.adaptiveTimer && sug ? sug.focusMinutes : st.focusMinutes) * 60;
    const base = mode === "long_break" ? st.longBreakMinutes : st.shortBreakMinutes;
    // Burnout guard may extend a break even when the adaptive timer is off.
    if (sug && (st.labs.adaptiveTimer || sug.fatigueWarning) && sug.breakKind === mode) return Math.max(base, sug.breakMinutes) * 60;
    return base * 60;
  }, []);

  const refreshSuggestion = useCallback(() => {
    api.nextSession().then((r) => setSuggestion(r.suggestion)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSuggestion();
    flushSessionQueue().then((n) => { if (n) { toast(`Synced ${n} offline session${n > 1 ? "s" : ""}.`, "success"); setSessionsVersion((v) => v + 1); } });
  }, [refreshSuggestion, toast]);

  // Keep the idle timer in sync with settings / suggestions.
  useEffect(() => {
    if (s.status !== "idle") return;
    const p = plannedFor(s.mode);
    if (p !== s.plannedSeconds) setS((x) => ({ ...x, plannedSeconds: p }));
  }, [settings, suggestion, s.status, s.mode, s.plannedSeconds, plannedFor]);

  const elapsedMs = s.accumulatedMs + (s.resumedAt ? now - s.resumedAt : 0);
  const remainingSeconds = s.plannedSeconds - elapsedMs / 1000;

  const idleState = useCallback((mode: SessionKind, extra: Partial<Persisted> = {}): Persisted => ({
    ...sRef.current, mode, status: "idle", plannedSeconds: plannedFor(mode), accumulatedMs: 0, resumedAt: null,
    startedAt: null, distractions: [], ...extra,
  }), [plannedFor]);

  const runningState = (mode: SessionKind, extra: Partial<Persisted> = {}): Persisted => ({
    ...sRef.current, mode, status: "running", plannedSeconds: plannedFor(mode), accumulatedMs: 0,
    resumedAt: Date.now(), startedAt: new Date().toISOString(), distractions: [], ...extra,
  });

  /** Log the current session and move to the next phase. */
  const finish = useCallback(async (completed: boolean, opts: { auto?: boolean } = {}) => {
    if (finishing.current) return;
    finishing.current = true;
    const cur = sRef.current;
    const st = settingsRef.current;
    const t = Date.now();
    let elapsed = cur.accumulatedMs + (cur.resumedAt ? t - cur.resumedAt : 0);
    let endedAt = new Date(t);
    if (opts.auto && cur.status !== "overtime") {
      // Auto-complete: cap at the planned length (tab may have been closed past the end).
      elapsed = Math.min(elapsed, cur.plannedSeconds * 1000);
      if (cur.resumedAt) endedAt = new Date(cur.resumedAt + (cur.plannedSeconds * 1000 - cur.accumulatedMs));
    }
    const actualSeconds = Math.round(elapsed / 1000);

    // Decide what comes next.
    let next: SessionKind = "focus";
    let focusCount = cur.focusCount;
    if (cur.mode === "focus") {
      if (completed) {
        focusCount++;
        const sug = suggestionRef.current;
        const long = focusCount >= st.longBreakInterval || (st.labs.burnoutGuard && !!sug?.fatigueWarning);
        next = long ? "long_break" : "short_break";
        if (long) focusCount = 0;
      } else {
        next = "focus";
      }
    }
    const autoStart = completed && (next === "focus" ? st.autoStartFocus : st.autoStartBreaks);
    setS(autoStart ? runningState(next, { focusCount }) : idleState(next, { focusCount }));
    warnedRef.current = false;

    if (cur.startedAt && actualSeconds >= 10) {
      const input: NewSessionInput = {
        kind: cur.mode, taskId: cur.mode === "focus" ? cur.taskId : null,
        plannedSeconds: Math.max(30, cur.plannedSeconds), actualSeconds,
        startedAt: cur.startedAt, endedAt: endedAt.toISOString(), completed,
        distractions: cur.distractions,
      };
      try {
        const saved = await saveSessionReliably(input);
        if (!saved) toast("Offline — session saved locally and will sync later.", "info");
        if (cur.mode === "focus" && st.askReflection && (completed || actualSeconds >= 120)) {
          setReview({ sessionId: saved?.id ?? null, minutes: Math.round(actualSeconds / 60), completed });
        }
      } catch (e) {
        toast(`Couldn't save session: ${(e as Error).message}`, "error");
      }
      setSessionsVersion((v) => v + 1);
      refreshSuggestion();
    }
    finishing.current = false;
  }, [idleState, refreshSuggestion, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- The tick ----
  useEffect(() => {
    if (s.status !== "running" && s.status !== "overtime") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [s.status]);

  useEffect(() => {
    const st = settingsRef.current;
    if (s.status === "running") {
      const sec = Math.ceil(remainingSeconds);
      if (st.sound.tick && s.mode === "focus" && lastTickSec.current !== sec && sec > 0) playTick(st.sound.tickVolume);
      lastTickSec.current = sec;
      const warn = st.notifications.preEndWarningSeconds;
      if (warn > 0 && !warnedRef.current && remainingSeconds <= warn && remainingSeconds > 0) {
        warnedRef.current = true;
        playWarning(st.sound.alarmVolume);
      }
      if (remainingSeconds <= 0) {
        const label = KIND_LABEL[s.mode];
        if (s.mode === "focus" && st.labs.flowMode) {
          playAlarm(st.sound.alarm, st.sound.alarmVolume * 0.6, 1);
          if (st.notifications.desktop) notify("Focus block done — keep flowing?", "Timer keeps counting. Hit Finish when you're ready for a break.");
          setS((x) => ({ ...x, status: "overtime" }));
        } else {
          playAlarm(st.sound.alarm, st.sound.alarmVolume, st.sound.alarmRepeat);
          if (st.notifications.desktop) {
            notify(`${label} complete`, s.mode === "focus" ? "Nice work. Time for a break." : "Break's over — ready to focus?");
          }
          void finish(true, { auto: true });
        }
      }
    }
  }, [now, s.status, s.mode, remainingSeconds, finish]);

  // ---- Ambient sound ----
  useEffect(() => {
    const st = settings;
    const active = (s.status === "running" || s.status === "overtime") && st.labs.ambientSound &&
      (s.mode === "focus" || st.sound.ambientDuringBreaks);
    setAmbient(active ? st.sound.ambient : "none", st.sound.ambientVolume);
  }, [s.status, s.mode, settings]);
  useEffect(() => () => setAmbient("none", 0), []);

  // ---- Title countdown ----
  useEffect(() => {
    const st = settings.notifications;
    if (st.titleCountdown && s.status !== "idle") {
      const t = s.status === "overtime" ? `+${clock(-remainingSeconds)}` : clock(remainingSeconds);
      document.title = `${s.status === "paused" ? "⏸ " : ""}${t} · ${KIND_LABEL[s.mode]}`;
    } else {
      document.title = "FocusFlow";
    }
  }, [now, s.status, s.mode, remainingSeconds, settings.notifications]);

  const canPause = !(settings.strictMode && s.mode === "focus");

  // ---- Actions ----
  const start = useCallback(() => {
    unlockAudio();
    setS((x) => {
      if (x.status === "running" || x.status === "overtime") return x;
      if (x.status === "paused") return { ...x, status: "running", resumedAt: Date.now() };
      return { ...x, status: "running", resumedAt: Date.now(), startedAt: new Date().toISOString(), accumulatedMs: 0, distractions: [] };
    });
    setNow(Date.now());
  }, []);

  const pause = useCallback(() => {
    if (!canPause) return;
    setS((x) => (x.status !== "running" || !x.resumedAt ? x : {
      ...x, status: "paused", accumulatedMs: x.accumulatedMs + (Date.now() - x.resumedAt), resumedAt: null,
    }));
  }, [canPause]);

  const reset = useCallback(() => {
    const cur = sRef.current;
    if (cur.status === "idle") return;
    const elapsed = cur.accumulatedMs + (cur.resumedAt ? Date.now() - cur.resumedAt : 0);
    // A focus block abandoned after a minute is real data for the coach; shorter is a false start.
    if (cur.mode === "focus" && elapsed >= 60_000) void finish(false);
    else setS(idleState(cur.mode));
  }, [finish, idleState]);

  const skip = useCallback(() => {
    const cur = sRef.current;
    if (cur.mode === "focus") {
      if (cur.status === "idle") { setS(idleState("short_break")); return; }
      void finish(false);
    } else {
      if (cur.status === "idle") { setS(idleState("focus")); return; }
      void finish(true);
    }
  }, [finish, idleState]);

  const finishFlow = useCallback(() => { void finish(true); }, [finish]);

  const switchMode = useCallback((m: SessionKind) => {
    setS(idleState(m));
  }, [idleState]);

  const setTask = useCallback((taskId: string | null) => setS((x) => ({ ...x, taskId })), []);

  const logDistraction = useCallback((category: DistractionCategory) => {
    setS((x) => (x.status === "idle" ? x : { ...x, distractions: [...x.distractions, { at: new Date().toISOString(), category }] }));
  }, []);

  const value = useMemo<TimerCtx>(() => ({
    ...s,
    elapsedSeconds: elapsedMs / 1000,
    remainingSeconds,
    progress: Math.min(1, Math.max(0, elapsedMs / 1000 / s.plannedSeconds)),
    suggestion, review, sessionsVersion, canPause,
    start, pause, reset, skip, finishFlow, switchMode, setTask, logDistraction,
    closeReview: () => setReview(null),
    plannedFor,
  }), [s, elapsedMs, remainingSeconds, suggestion, review, sessionsVersion, canPause, start, pause, reset, skip, finishFlow, switchMode, setTask, logDistraction, plannedFor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTimer() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimer outside TimerProvider");
  return c;
}
