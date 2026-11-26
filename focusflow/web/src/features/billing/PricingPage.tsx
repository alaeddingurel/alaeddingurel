import { useState } from "react";
import { api } from "../../api/client";
import { useAuth, useUser } from "../../state/auth";
import { useToast } from "../../state/toast";
import { ProBadge } from "../../components/ui";

const FREE = [
  "Fully customizable timer, sounds & themes",
  "Tasks with pomodoro estimates",
  "Distraction logging & reflections",
  "Adaptive timer & all Labs features",
  "Today, streak & 7-day stats",
  "2 coach insights · 2 custom presets",
];
const PRO = [
  "Everything in Free",
  "Detailed statistics: heatmap, focus score, completion, distractions, tags, tasks",
  "Up to 1-year ranges & CSV export",
  "Weekly & monthly AI focus reports",
  "AI day planner built around your peak hours",
  "All coach insights · unlimited presets",
];

export function PricingPage() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pro = user.plan === "pro";

  async function change(to: "pro" | "free") {
    setBusy(true);
    try {
      const { user: u } = to === "pro" ? await api.upgrade() : await api.downgrade();
      setUser(u);
      toast(to === "pro" ? "Welcome to Pro ✦" : "You're on the Free plan.", "success");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  }

  return (
    <div className="page narrow">
      <header className="page-head center-head">
        <h1>Focus is a skill. Train it.</h1>
        <p className="muted">Free covers the timer completely. Pro adds deep analytics and an AI coach.</p>
      </header>
      <div className="pricing">
        <div className={`plan-card card ${!pro ? "current" : ""}`}>
          <h2>Free</h2>
          <p className="price">$0</p>
          <ul>{FREE.map((f) => <li key={f}>{f}</li>)}</ul>
          {pro ? <button className="btn ghost block" disabled={busy} onClick={() => void change("free")}>Downgrade</button> : <button className="btn ghost block" disabled>Current plan</button>}
        </div>
        <div className={`plan-card card featured ${pro ? "current" : ""}`}>
          <h2>Pro <ProBadge /></h2>
          <p className="price">$4<small>/month</small></p>
          <ul>{PRO.map((f) => <li key={f}>{f}</li>)}</ul>
          {pro ? <button className="btn primary block" disabled>Current plan</button> : <button className="btn primary block" disabled={busy} onClick={() => void change("pro")}>Upgrade to Pro</button>}
        </div>
      </div>
      <p className="hint center">Demo billing: upgrading is instant and free on this server. Wire Stripe Checkout into <code>POST /api/billing/upgrade</code> for production.</p>
    </div>
  );
}
