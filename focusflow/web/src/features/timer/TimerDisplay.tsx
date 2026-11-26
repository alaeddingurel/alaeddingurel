import type { TimerStyle } from "@focusflow/shared";
import { clock } from "../../lib/format";

/** Visual timer. Three styles: progress ring, horizontal bar, or minimal digits. */
export function TimerDisplay({ remaining, progress, overtime, style, showSeconds, label }: {
  remaining: number; progress: number; overtime: boolean; style: TimerStyle; showSeconds: boolean; label: string;
}) {
  const text = overtime ? `+${clock(-remaining, showSeconds)}` : clock(Math.ceil(remaining), showSeconds);
  const digits = <div className="timer-digits" aria-live="off">{text}</div>;
  const sub = <div className="timer-sub">{overtime ? "In flow — finish when ready" : label}</div>;

  if (style === "minimal") {
    return <div className="timer timer-minimal" role="timer" aria-label={`${label}: ${text}`}>{digits}{sub}</div>;
  }
  if (style === "bar") {
    return (
      <div className="timer timer-bar" role="timer" aria-label={`${label}: ${text}`}>
        {digits}{sub}
        <div className="bar-track"><div className="bar-fill" style={{ width: `${(overtime ? 1 : progress) * 100}%` }} /></div>
      </div>
    );
  }
  const r = 140, c = 2 * Math.PI * r;
  return (
    <div className="timer timer-ring" role="timer" aria-label={`${label}: ${text}`}>
      <svg viewBox="0 0 320 320" aria-hidden>
        <circle className="ring-track" cx="160" cy="160" r={r} />
        <circle className={`ring-fill ${overtime ? "pulse" : ""}`} cx="160" cy="160" r={r}
          strokeDasharray={c} strokeDashoffset={overtime ? 0 : c * (1 - progress)} transform="rotate(-90 160 160)" />
      </svg>
      <div className="ring-center">{digits}{sub}</div>
    </div>
  );
}
