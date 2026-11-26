import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { CoachReport, DayPlan, Insight } from "@focusflow/shared";
import { api } from "../../api/client";
import { useUser } from "../../state/auth";
import { useSettings } from "../../state/settings";
import { useTimer } from "../../state/timer";
import { useToast } from "../../state/toast";
import { Card, ProBadge, ProLock, Segmented, Spinner, Toggle } from "../../components/ui";

const ICON = { positive: "▲", info: "●", warning: "!" } as const;

function InsightCard({ i }: { i: Insight }) {
  const { update } = useSettings();
  const toast = useToast();
  return (
    <article className={`insight ${i.severity}`}>
      <span className="insight-icon" aria-label={i.severity}>{ICON[i.severity]}</span>
      <div className="insight-body">
        <h4>{i.title} {i.metric && <span className="metric">{i.metric}</span>}</h4>
        <p>{i.body}</p>
        {i.action?.settingsPatch && (
          <button className="btn small" onClick={() => { update(i.action!.settingsPatch!); toast("Applied ✓", "success"); }}>{i.action.label}</button>
        )}
      </div>
    </article>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="score-ring" role="img" aria-label={`Focus score ${score} out of 100`}>
      <svg viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r={r} className="ring-track" />
        <circle cx="40" cy="40" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 40 40)" />
      </svg>
      <span>{score}</span>
    </div>
  );
}

export function CoachPage() {
  const user = useUser();
  const pro = user.plan === "pro";
  const { suggestion } = useTimer();
  const [insights, setInsights] = useState<{ insights: Insight[]; locked: number } | null>(null);
  const [claude, setClaude] = useState(false);

  useEffect(() => {
    api.insights().then(setInsights).catch(() => setInsights({ insights: [], locked: 0 }));
    api.aiStatus().then((r) => setClaude(r.claude)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1><span className="sparkle" aria-hidden>✦</span> Focus coach</h1>
          <p className="muted">Personal insights from your own data{claude ? ", written by Claude" : ""}. The more sessions you rate, the sharper it gets.</p>
        </div>
      </header>

      {suggestion && (
        <Card title="Your next session">
          <p className="coach-big"><b>{suggestion.focusMinutes} min</b> focus → {suggestion.breakMinutes} min {suggestion.breakKind === "long_break" ? "long break" : "break"}</p>
          <ul className="reasons">{suggestion.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {suggestion.fatigueWarning && <p className="callout warning">{suggestion.fatigueWarning}</p>}
        </Card>
      )}

      <div className="grid-2 align-start">
        <Card title="Insights · last 14 days">
          {!insights ? <Spinner /> : (
            <div className="insights">
              {insights.insights.map((i) => <InsightCard key={i.id} i={i} />)}
              {insights.locked > 0 && (
                <div className="insight locked">
                  <span className="insight-icon">✦</span>
                  <div className="insight-body"><h4>{insights.locked} more insight{insights.locked > 1 ? "s" : ""} <ProBadge /></h4><p className="muted">Upgrade to see everything the coach found.</p></div>
                </div>
              )}
            </div>
          )}
        </Card>
        {pro ? <DayPlanner claude={claude} /> : (
          <ProLock title="AI day planner">Turn your task list into a realistic schedule with your hardest work placed in your peak focus hours.</ProLock>
        )}
      </div>

      {pro ? <ReportCard claude={claude} /> : (
        <ProLock title="Weekly AI focus report">A written review of your week — what's working, what's not, and small experiments to try next.</ProLock>
      )}
    </div>
  );
}

function ReportCard({ claude }: { claude: boolean }) {
  const [days, setDays] = useState<"7" | "30">("7");
  const [report, setReport] = useState<CoachReport | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function load(refresh = false) {
    setLoading(true);
    try {
      const r = await api.report(Number(days), refresh);
      setReport(r.report);
      if (r.warning) toast(r.warning, "info");
    } catch (e) { toast((e as Error).message, "error"); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="report" title={<>Focus report <ProBadge /></>} actions={
      <>
        <Segmented label="Report period" value={days} onChange={setDays} options={[{ value: "7", label: "Week" }, { value: "30", label: "Month" }]} />
        {claude && <button className="btn small ghost" onClick={() => void load(true)} disabled={loading}>Regenerate</button>}
      </>
    }>
      {loading || !report ? <div className="report-loading"><Spinner /><p className="muted">{claude ? "Claude is reviewing your sessions…" : "Analysing…"}</p></div> : (
        <>
          <div className="report-head">
            <ScoreRing score={report.focusScore} />
            <div>
              <h2>{report.headline}</h2>
              <p>{report.summary}</p>
              <span className={`source ${report.source}`}>{report.source === "claude" ? "✦ Written by Claude" : "Built-in analysis"}</span>
            </div>
          </div>
          <div className="report-grid">
            <div className="insights">{report.insights.map((i) => <InsightCard key={i.id} i={i} />)}</div>
            <div>
              <h4 className="eyebrow">Experiments to try</h4>
              <ol className="experiments">
                {report.experiments.map((e) => (
                  <li key={e.title}><b>{e.title}</b><p className="muted">{e.hypothesis}</p><p>{e.howTo}</p></li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function roundedNow() {
  const d = new Date(Date.now() + 5 * 60_000);
  const m = Math.ceil(d.getMinutes() / 5) * 5;
  d.setMinutes(m % 60); if (m >= 60) d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function DayPlanner({ claude }: { claude: boolean }) {
  const [start, setStart] = useState(roundedNow);
  const [end, setEnd] = useState(() => (Number(roundedNow().slice(0, 2)) < 14 ? "17:00" : "22:00"));
  const [intention, setIntention] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const timer = useTimer();
  const navigate = useNavigate();

  async function generate() {
    setLoading(true);
    try { setPlan((await api.plan({ start, end, intention, useAi })).plan); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setLoading(false); }
  }

  const focusBlocks = plan?.blocks.filter((b) => b.kind === "focus").length ?? 0;

  return (
    <Card title={<>Plan my day <ProBadge /></>}>
      <div className="planner-form">
        <label className="field inline"><span>From</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field inline"><span>To</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <label className="field">
        <span>Intention <small className="muted">(optional)</small></span>
        <textarea rows={2} maxLength={500} placeholder="e.g. Ship the billing refactor before lunch, keep afternoons light" value={intention} onChange={(e) => setIntention(e.target.value)} />
      </label>
      {claude && <Toggle label="Use Claude" hint="Off uses the built-in scheduler" checked={useAi} onChange={setUseAi} />}
      <button className="btn primary block" onClick={() => void generate()} disabled={loading}>{loading ? "Planning…" : "Generate plan"}</button>

      {plan && (
        <div className="day-plan">
          <p className="muted small">{plan.rationale} <span className={`source ${plan.source}`}>{plan.source === "claude" ? "✦ Claude" : "Built-in"}</span></p>
          <p className="small"><b>{focusBlocks}</b> focus blocks</p>
          <ol className="timeline">
            {plan.blocks.map((b, i) => (
              <li key={i} className={`tl ${b.kind}`}>
                <span className="tl-time">{b.start}–{b.end}</span>
                <span className="tl-label">{b.label}</span>
                {b.kind === "focus" && b.taskId && i === 0 && (
                  <button className="btn small" onClick={() => { timer.setTask(b.taskId); if (timer.status === "idle") timer.switchMode("focus"); navigate("/"); }}>Start</button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
