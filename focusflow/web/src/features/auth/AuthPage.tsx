import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../state/auth";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) await signup(name, email, password);
      else await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-hero" aria-hidden>
        <div className="auth-hero-inner">
          <div className="brand big"><span className="brand-dot" /> FocusFlow</div>
          <h1>Focus longer.<br />Focus <em>better</em>.</h1>
          <p>A Pomodoro timer that learns how you work — and coaches you to improve.</p>
          <ul className="auth-features">
            <li><b>Adaptive timer</b> — block lengths tuned to your real focus stamina</li>
            <li><b>Peak-hour detection</b> — know when your brain is sharpest</li>
            <li><b>Distraction log</b> — one tap to capture, patterns surfaced for you</li>
            <li><b>AI coach & day planner</b> — weekly reports and a schedule for your tasks</li>
          </ul>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-form card" onSubmit={submit} noValidate>
          <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">{isSignup ? "Free forever. Upgrade to Pro any time." : "Sign in to pick up where you left off."}</p>
          {isSignup && (
            <label className="field">
              <span>Name</span>
              <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 8 : 1}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            {isSignup && <small className="muted">At least 8 characters.</small>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? "…" : isSignup ? "Create account" : "Sign in"}</button>
          <p className="muted center">
            {isSignup ? <>Already have an account? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
          </p>
        </form>
      </section>
    </div>
  );
}
