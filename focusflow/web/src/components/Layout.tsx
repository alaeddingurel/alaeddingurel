import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth, useUser } from "../state/auth";
import { useTimer } from "../state/timer";
import { useSettings } from "../state/settings";
import { clock } from "../lib/format";
import { ProBadge } from "./ui";
import { ReflectionModal } from "../features/timer/ReflectionModal";

const NAV = [
  { to: "/", label: "Timer", icon: "◷" },
  { to: "/tasks", label: "Tasks", icon: "☰" },
  { to: "/stats", label: "Stats", icon: "▤" },
  { to: "/coach", label: "Coach", icon: "✦" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const timer = useTimer();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const zen = settings.appearance.zenMode && timer.mode === "focus" && (timer.status === "running" || timer.status === "overtime");

  return (
    <div className={`shell ${zen ? "zen" : ""}`} data-mode={timer.mode}>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="FocusFlow home">
          <span className="brand-dot" aria-hidden /> FocusFlow
        </NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {timer.status !== "idle" && (
            <button className="mini-timer" onClick={() => navigate("/")} aria-label="Back to timer">
              <span className="dot" /> {timer.status === "overtime" ? `+${clock(-timer.remainingSeconds)}` : clock(timer.remainingSeconds)}
            </button>
          )}
          {user.plan === "pro" ? <ProBadge /> : <NavLink to="/pricing" className="btn small upgrade">Upgrade</NavLink>}
          <details className="account-menu">
            <summary aria-label="Account menu"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span></summary>
            <div className="menu">
              <div className="menu-head"><strong>{user.name}</strong><span className="muted">{user.email}</span></div>
              <NavLink to="/settings#account">Account</NavLink>
              <NavLink to="/pricing">Plan: {user.plan === "pro" ? "Pro" : "Free"}</NavLink>
              <button onClick={() => logout().then(() => navigate("/login"))}>Sign out</button>
            </div>
          </details>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <ReflectionModal />
    </div>
  );
}
