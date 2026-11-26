import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { DEFAULT_PRESETS, DEFAULT_SETTINGS, type AlarmSound, type AmbientSound, type LabsFlags, type Settings, type Theme, type TimerStyle } from "@focusflow/shared";
import { api } from "../../api/client";
import { useAuth, useUser } from "../../state/auth";
import { useSettings } from "../../state/settings";
import { useToast } from "../../state/toast";
import { NumberField, ProBadge, Segmented, Slider, Toggle } from "../../components/ui";
import { playAlarm, setAmbient, unlockAudio } from "../../lib/sound";
import { notificationsSupported, requestNotificationPermission } from "../../lib/notify";

const SECTIONS = [
  ["timer", "Timer"], ["presets", "Presets"], ["behavior", "Behavior"], ["sound", "Sound"],
  ["notifications", "Notifications"], ["appearance", "Appearance"], ["labs", "Labs"], ["account", "Account"],
] as const;

const ACCENTS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];

const LABS: { key: keyof LabsFlags; title: string; body: string }[] = [
  { key: "adaptiveTimer", title: "Adaptive timer", body: "The coach sets the length of each focus block from your completion rate, ratings and time of day — growing your focus stamina gradually." },
  { key: "flowMode", title: "Flow mode", body: "When a focus block ends, the timer keeps counting up instead of interrupting you. Hit Finish when you're ready. Overtime teaches the adaptive timer your natural rhythm." },
  { key: "ambientSound", title: "Ambient soundscapes", body: "Generated white, pink, brown noise or rain during focus. Choose the sound under Sound." },
  { key: "smartBreaks", title: "Smart break ideas", body: "Suggests a concrete, restorative activity for each break instead of reaching for your phone." },
  { key: "burnoutGuard", title: "Burnout guard", body: "Detects long stretches of focus without a real break and extends your next break." },
];

function Section({ id, title, children, badge }: { id: string; title: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section id={id} className="card settings-section">
      <h2>{title} {badge}</h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { settings: s, update, saving } = useSettings();
  const user = useUser();
  const toast = useToast();
  const location = useLocation();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);
  const sub = <K extends "sound" | "notifications" | "appearance" | "labs">(k: K, patch: Partial<Settings[K]>) =>
    update((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  // Preview ambient while adjusting, stop when leaving the page.
  const [previewAmbient, setPreviewAmbient] = useState(false);
  useEffect(() => { setAmbient(previewAmbient ? s.sound.ambient : "none", s.sound.ambientVolume); }, [previewAmbient, s.sound.ambient, s.sound.ambientVolume]);
  useEffect(() => () => setAmbient("none", 0), []);

  const [presetName, setPresetName] = useState("");
  const custom = s.presets.filter((p) => !DEFAULT_PRESETS.some((d) => d.id === p.id));

  return (
    <div className="page settings">
      <header className="page-head">
        <div><h1>Settings</h1><p className="muted">Everything syncs to your account. {saving ? "Saving…" : "All changes saved."}</p></div>
        <button className="btn ghost small" onClick={() => { if (window.confirm("Reset all settings to defaults?")) update(DEFAULT_SETTINGS); }}>Reset to defaults</button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="settings-body">
          <Section id="timer" title="Timer">
            <NumberField label="Focus" value={s.focusMinutes} min={1} max={180} suffix="min" onChange={(v) => set("focusMinutes", v)}
              hint={s.labs.adaptiveTimer ? "Adaptive timer is on — the coach may adjust this per session." : undefined} />
            <NumberField label="Short break" value={s.shortBreakMinutes} min={1} max={60} suffix="min" onChange={(v) => set("shortBreakMinutes", v)} />
            <NumberField label="Long break" value={s.longBreakMinutes} min={1} max={120} suffix="min" onChange={(v) => set("longBreakMinutes", v)} />
            <NumberField label="Long break every" value={s.longBreakInterval} min={1} max={12} suffix="blocks" onChange={(v) => set("longBreakInterval", v)} />
            <NumberField label="Daily goal" value={s.dailyGoalPomodoros} min={1} max={40} suffix="🍅" onChange={(v) => set("dailyGoalPomodoros", v)} />
          </Section>

          <Section id="presets" title="Presets" badge={user.plan !== "pro" ? <span className="muted small">2 custom on Free · unlimited with <ProBadge /></span> : undefined}>
            <div className="preset-list">
              {s.presets.map((p) => (
                <div key={p.id} className="preset-row">
                  <button className="chip" onClick={() => update({ focusMinutes: p.focusMinutes, shortBreakMinutes: p.shortBreakMinutes, longBreakMinutes: p.longBreakMinutes, longBreakInterval: p.longBreakInterval })}>Apply</button>
                  <span><b>{p.name}</b> <span className="muted">{p.focusMinutes} / {p.shortBreakMinutes} / {p.longBreakMinutes} · long every {p.longBreakInterval}</span></span>
                  {!DEFAULT_PRESETS.some((d) => d.id === p.id) && (
                    <button className="icon-btn danger" aria-label={`Delete preset ${p.name}`} onClick={() => set("presets", s.presets.filter((x) => x.id !== p.id))}>🗑</button>
                  )}
                </div>
              ))}
            </div>
            <form className="inline-form" onSubmit={(e) => {
              e.preventDefault();
              if (!presetName.trim()) return;
              set("presets", [...s.presets, {
                id: `custom-${Date.now()}`, name: presetName.trim(), focusMinutes: s.focusMinutes, shortBreakMinutes: s.shortBreakMinutes,
                longBreakMinutes: s.longBreakMinutes, longBreakInterval: s.longBreakInterval,
              }]);
              setPresetName("");
            }}>
              <input placeholder="Save current timer as…" value={presetName} onChange={(e) => setPresetName(e.target.value)} maxLength={30} aria-label="Preset name" />
              <button className="btn small" disabled={!presetName.trim()}>Save preset</button>
            </form>
            {custom.length > 0 && <p className="hint">{custom.length} custom preset{custom.length > 1 ? "s" : ""}</p>}
          </Section>

          <Section id="behavior" title="Behavior">
            <Toggle label="Auto-start breaks" hint="Breaks start as soon as a focus block ends." checked={s.autoStartBreaks} onChange={(v) => set("autoStartBreaks", v)} />
            <Toggle label="Auto-start focus" hint="The next focus block starts when a break ends." checked={s.autoStartFocus} onChange={(v) => set("autoStartFocus", v)} />
            <Toggle label="Strict mode" hint="No pausing during focus. You can still end early, but it's logged as incomplete." checked={s.strictMode} onChange={(v) => set("strictMode", v)} />
            <Toggle label="Confirm before ending focus early" checked={s.confirmSkip} onChange={(v) => set("confirmSkip", v)} />
            <Toggle label="Ask for a reflection after focus" hint="Rate focus & energy in one tap — this is what makes the coach accurate." checked={s.askReflection} onChange={(v) => set("askReflection", v)} />
          </Section>

          <Section id="sound" title="Sound">
            <div className="field-row">
              <div className="field-text"><label htmlFor="alarm">Alarm</label></div>
              <div className="row-gap">
                <select id="alarm" value={s.sound.alarm} onChange={(e) => sub("sound", { alarm: e.target.value as AlarmSound })}>
                  {(["bell", "chime", "digital", "wood", "none"] as AlarmSound[]).map((a) => <option key={a} value={a}>{a[0]!.toUpperCase() + a.slice(1)}</option>)}
                </select>
                <button className="btn small ghost" onClick={() => { unlockAudio(); playAlarm(s.sound.alarm, s.sound.alarmVolume, 1); }}>▶ Test</button>
              </div>
            </div>
            <Slider label="Alarm volume" value={s.sound.alarmVolume} onChange={(v) => sub("sound", { alarmVolume: v })} />
            <NumberField label="Repeat alarm" value={s.sound.alarmRepeat} min={1} max={5} suffix="×" onChange={(v) => sub("sound", { alarmRepeat: v })} />
            <Toggle label="Ticking during focus" checked={s.sound.tick} onChange={(v) => sub("sound", { tick: v })} />
            {s.sound.tick && <Slider label="Tick volume" value={s.sound.tickVolume} onChange={(v) => sub("sound", { tickVolume: v })} />}
            <div className="field-row">
              <div className="field-text">
                <label htmlFor="ambient">Ambient sound</label>
                {!s.labs.ambientSound && <p className="hint">Enable “Ambient soundscapes” in Labs to play during focus.</p>}
              </div>
              <div className="row-gap">
                <select id="ambient" value={s.sound.ambient} onChange={(e) => sub("sound", { ambient: e.target.value as AmbientSound })}>
                  {([["none", "None"], ["white", "White noise"], ["pink", "Pink noise"], ["brown", "Brown noise"], ["rain", "Rain"]] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className="btn small ghost" disabled={s.sound.ambient === "none"} aria-pressed={previewAmbient}
                  onClick={() => { unlockAudio(); setPreviewAmbient((p) => !p); }}>{previewAmbient ? "■ Stop" : "▶ Preview"}</button>
              </div>
            </div>
            <Slider label="Ambient volume" value={s.sound.ambientVolume} onChange={(v) => sub("sound", { ambientVolume: v })} />
            <Toggle label="Keep ambient sound during breaks" checked={s.sound.ambientDuringBreaks} onChange={(v) => sub("sound", { ambientDuringBreaks: v })} />
          </Section>

          <Section id="notifications" title="Notifications">
            <Toggle label="Desktop notifications" checked={s.notifications.desktop}
              hint={notificationsSupported() ? `Browser permission: ${Notification.permission}` : "Not supported in this browser."}
              onChange={async (v) => {
                if (v) {
                  const p = await requestNotificationPermission();
                  if (p !== "granted") toast("Notifications are blocked in your browser settings.", "error");
                }
                sub("notifications", { desktop: v });
              }} />
            <Toggle label="Countdown in tab title" checked={s.notifications.titleCountdown} onChange={(v) => sub("notifications", { titleCountdown: v })} />
            <NumberField label="Heads-up before the end" hint="A soft chime so you can wrap up a thought. 0 = off." value={s.notifications.preEndWarningSeconds}
              min={0} max={600} step={15} suffix="sec" onChange={(v) => sub("notifications", { preEndWarningSeconds: v })} />
          </Section>

          <Section id="appearance" title="Appearance">
            <div className="field-row">
              <div className="field-text"><label>Theme</label></div>
              <Segmented<Theme> label="Theme" value={s.appearance.theme} onChange={(v) => sub("appearance", { theme: v })}
                options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
            </div>
            <div className="field-row">
              <div className="field-text"><label>Focus color</label></div>
              <Swatches value={s.appearance.accent} onChange={(v) => sub("appearance", { accent: v })} />
            </div>
            <div className="field-row">
              <div className="field-text"><label>Break color</label></div>
              <Swatches value={s.appearance.breakAccent} onChange={(v) => sub("appearance", { breakAccent: v })} />
            </div>
            <div className="field-row">
              <div className="field-text"><label>Timer style</label></div>
              <Segmented<TimerStyle> label="Timer style" value={s.appearance.timerStyle} onChange={(v) => sub("appearance", { timerStyle: v })}
                options={[{ value: "ring", label: "Ring" }, { value: "bar", label: "Bar" }, { value: "minimal", label: "Minimal" }]} />
            </div>
            <Toggle label="Show seconds" checked={s.appearance.showSeconds} onChange={(v) => sub("appearance", { showSeconds: v })} />
            <Toggle label="Zen mode" hint="Hide navigation and everything but the timer while focusing (Z)." checked={s.appearance.zenMode} onChange={(v) => sub("appearance", { zenMode: v })} />
          </Section>

          <Section id="labs" title="Labs" badge={<span className="chip experimental">Experimental</span>}>
            <p className="muted">Try new focus techniques. Each one is independent — switch them on, see what works for you, switch off what doesn't.</p>
            {LABS.map((l) => (
              <Toggle key={l.key} label={l.title} hint={l.body} checked={s.labs[l.key]} onChange={(v) => sub("labs", { [l.key]: v } as Partial<LabsFlags>)} />
            ))}
          </Section>

          <AccountSection />
        </div>
      </div>
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatches">
      {ACCENTS.map((c) => (
        <button key={c} type="button" className={`swatch ${c === value ? "on" : ""}`} style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={c === value} onClick={() => onChange(c)} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom color" />
    </div>
  );
}

function AccountSection() {
  const user = useUser();
  const { setUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [delPw, setDelPw] = useState("");

  async function saveName(e: FormEvent) {
    e.preventDefault();
    try { setUser((await api.updateAccount({ name })).user); toast("Name updated", "success"); }
    catch (err) { toast((err as Error).message, "error"); }
  }
  async function changePw(e: FormEvent) {
    e.preventDefault();
    try { await api.changePassword({ currentPassword: cur, newPassword: next }); setCur(""); setNext(""); toast("Password changed. Other devices were signed out.", "success"); }
    catch (err) { toast((err as Error).message, "error"); }
  }
  async function del(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Permanently delete your account and all your data? This cannot be undone.")) return;
    try { await api.deleteAccount(delPw); await logout(); navigate("/signup"); }
    catch (err) { toast((err as Error).message, "error"); }
  }

  return (
    <Section id="account" title="Account">
      <form className="inline-form" onSubmit={saveName}>
        <label className="field grow"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <button className="btn small" disabled={!name.trim() || name === user.name}>Save</button>
      </form>
      <p className="muted small">Signed in as {user.email} · {user.plan === "pro" ? <>Pro since {new Date(user.proSince!).toLocaleDateString()}</> : "Free plan"}</p>
      <h3>Change password</h3>
      <form className="inline-form wrap" onSubmit={changePw}>
        <input type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Current password" />
        <input type="password" placeholder="New password (8+ chars)" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" />
        <button className="btn small" disabled={!cur || next.length < 8}>Change</button>
      </form>
      <details className="danger-zone">
        <summary>Delete account</summary>
        <form className="inline-form" onSubmit={del}>
          <input type="password" placeholder="Confirm with your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} aria-label="Password to confirm deletion" />
          <button className="btn small danger" disabled={!delPw}>Delete everything</button>
        </form>
      </details>
    </Section>
  );
}
