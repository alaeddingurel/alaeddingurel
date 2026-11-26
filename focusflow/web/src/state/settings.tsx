import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "@focusflow/shared";
import { api, ApiRequestError } from "../api/client";
import { useToast } from "./toast";

interface SettingsCtx {
  settings: Settings;
  loaded: boolean;
  saving: boolean;
  /** Apply a change locally right away; persisted to the server after a short debounce. */
  update: (patch: Partial<Settings> | ((s: Settings) => Settings)) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);
const CACHE_KEY = "ff.settings";

function cached(): Settings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(cached);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef<Settings>(settings);
  const toast = useToast();

  useEffect(() => {
    api.getSettings().then(({ settings }) => {
      setSettings(settings);
      lastSaved.current = settings;
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    applyAppearance(settings);
  }, [settings]);

  const update = useCallback<SettingsCtx["update"]>((patch) => {
    setSettings((prev) => {
      const next = normalizeSettings(typeof patch === "function" ? patch(prev) : { ...prev, ...patch });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        setSaving(true);
        try {
          const { settings: saved } = await api.saveSettings(next);
          lastSaved.current = saved;
        } catch (e) {
          if (e instanceof ApiRequestError && e.isProRequired) {
            toast(e.message, "error");
            setSettings(lastSaved.current);
          } else {
            toast("Couldn't save settings — they'll stay on this device for now.", "error");
          }
        } finally {
          setSaving(false);
        }
      }, 600);
      return next;
    });
  }, [toast]);

  return <Ctx.Provider value={{ settings, loaded, saving, update }}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSettings outside SettingsProvider");
  return c;
}

/** Theme + accent colors are CSS custom properties on <html>. */
export function applyAppearance(s: Settings) {
  const root = document.documentElement;
  if (s.appearance.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", s.appearance.theme);
  root.style.setProperty("--focus", s.appearance.accent);
  root.style.setProperty("--break", s.appearance.breakAccent);
}
