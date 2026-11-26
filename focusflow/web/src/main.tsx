import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./state/auth";
import { SettingsProvider } from "./state/settings";
import { TimerProvider } from "./state/timer";
import { ToastProvider } from "./state/toast";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AuthPage } from "./features/auth/AuthPage";
import { TimerPage } from "./features/timer/TimerPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { StatsPage } from "./features/stats/StatsPage";
import { CoachPage } from "./features/coach/CoachPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { PricingPage } from "./features/billing/PricingPage";
import "./styles.css";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Settings + timer are per-user: remount them when the user changes.
  return (
    <SettingsProvider key={user.id}>
      <TimerProvider>{children}</TimerProvider>
    </SettingsProvider>
  );
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
            <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<TimerPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="coach" element={<CoachPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="pricing" element={<PricingPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
