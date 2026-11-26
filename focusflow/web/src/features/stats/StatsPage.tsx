import { useEffect, useState } from "react";
import { DISTRACTION_CATEGORIES, type BasicStats, type DetailedStats } from "@focusflow/shared";
import { api } from "../../api/client";
import { useUser } from "../../state/auth";
import { useTimer } from "../../state/timer";
import { ProBadge, ProLock, Segmented, Spinner } from "../../components/ui";
import { hourLabel, minutesLabel, shortDate, WEEKDAYS } from "../../lib/format";
import { BarChart, ChartCard, Heatmap, HBars, LineChart, StackedBars } from "./charts";

const RANGES = [
  { value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1y" },
] as const;

function Delta({ cur, prev, unit = "%", invert = false }: { cur: number; prev: number | null | undefined; unit?: string; invert?: boolean }) {
  if (prev == null || prev === 0) return null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.01) return <span className="delta flat">±0{unit}</span>;
  const good = invert ? d < 0 : d > 0;
  return <span className={`delta ${good ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(Math.round(d * 100))}{unit}</span>;
}

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="kpi card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{delta}{sub && <span className="muted"> {sub}</span>}</span>
    </div>
  );
}

export function StatsPage() {
  const user = useUser();
  const { sessionsVersion } = useTimer();
  const [basic, setBasic] = useState<BasicStats | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("30");
  const [detailed, setDetailed] = useState<{ stats: DetailedStats; previous: DetailedStats["totals"] | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const pro = user.plan === "pro";

  useEffect(() => { api.basicStats().then((r) => setBasic(r.stats)).catch(() => {}); }, [sessionsVersion]);
  useEffect(() => {
    if (!pro) return;
    setLoading(true);
    api.detailedStats(Number(range)).then(setDetailed).catch(() => {}).finally(() => setLoading(false));
  }, [pro, range, sessionsVersion]);

  if (!basic) return <Spinner />;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Statistics</h1><p className="muted">Your focus, measured honestly.</p></div>
        {pro && (
          <div className="filters">
            <Segmented label="Date range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
            <a className="btn small" href="/api/stats/export.csv" download>Export CSV</a>
          </div>
        )}
      </header>

      <div className="kpis">
        <Kpi label="Today" value={minutesLabel(basic.today.focusMinutes)} sub={`${basic.today.pomodoros}/${basic.today.goal} pomodoros`} />
        <Kpi label="Streak" value={`${basic.streakDays} day${basic.streakDays === 1 ? "" : "s"}`} sub={basic.streakDays ? "keep it going" : "start today"} />
        <Kpi label="All-time focus" value={`${basic.totalFocusHours}h`} />
      </div>

      {!pro && (
        <>
          <ChartCard title="Focus minutes · last 7 days"
            table={{ columns: ["Date", "Minutes", "Pomodoros"], rows: basic.last7Days.map((d) => [d.date, d.focusMinutes, d.pomodoros]) }}>
            <BarChart data={basic.last7Days.map((d) => ({ label: shortDate(d.date), value: d.focusMinutes, tip: <><b>{minutesLabel(d.focusMinutes)}</b><span>{shortDate(d.date)} · {d.pomodoros} 🍅</span></> }))}
              format={(v) => `${Math.round(v)}m`} highlight={6} />
          </ChartCard>
          <ProLock title="Detailed statistics">
            Peak-hour heatmap, focus score trends, completion rates, distraction analysis, time per task &amp; tag, estimate accuracy,
            90-day &amp; yearly ranges and CSV export.
          </ProLock>
        </>
      )}

      {pro && (loading && !detailed ? <Spinner /> : detailed && <DetailedView d={detailed.stats} prev={detailed.previous} />)}
    </div>
  );
}

function DetailedView({ d, prev }: { d: DetailedStats; prev: DetailedStats["totals"] | null }) {
  const t = d.totals;
  const longRange = d.daily.length > 45;
  const catLabel = (c: string) => DISTRACTION_CATEGORIES.find((x) => x.id === c);

  // Aggregate to weeks for long ranges so bars stay readable.
  const series = longRange
    ? d.daily.reduce<{ label: string; value: number; n: number; score: number }[]>((acc, day, i) => {
        if (i % 7 === 0) acc.push({ label: shortDate(day.date), value: 0, n: 0, score: 0 });
        const w = acc[acc.length - 1]!;
        w.value += day.focusMinutes; w.n++; w.score += day.focusScore;
        return acc;
      }, [])
    : d.daily.map((day) => ({ label: shortDate(day.date), value: day.focusMinutes, n: 1, score: day.focusScore }));

  if (t.sessionsStarted === 0) {
    return <div className="empty card"><p><b>No focus sessions in this range.</b></p><p className="muted">Pick a longer range or start a session.</p></div>;
  }

  return (
    <>
      <div className="kpis six">
        <Kpi label="Focus time" value={minutesLabel(t.focusMinutes)} delta={<Delta cur={t.focusMinutes} prev={prev?.focusMinutes} />} sub="vs prev." />
        <Kpi label={`Focus score`} value={`${t.focusScore}`} delta={<Delta cur={t.focusScore} prev={prev?.focusScore} />} sub="/ 100" />
        <Kpi label="Completion" value={`${Math.round(t.completionRate * 100)}%`} sub={`${t.pomodoros}/${t.sessionsStarted} blocks`} />
        <Kpi label="Avg focus rating" value={t.avgFocusRating ? `${t.avgFocusRating}/5` : "—"} sub={t.avgFocusRating ? "" : "rate sessions"} />
        <Kpi label="Distractions" value={`${t.distractionsPerHour}/h`} delta={<Delta cur={t.distractionsPerHour} prev={prev?.distractionsPerHour} invert />} />
        <Kpi label="Deep work" value={minutesLabel(t.deepWorkMinutes)} sub="45m+ uninterrupted" />
      </div>

      <div className="grid-2">
        <ChartCard title={longRange ? "Focus time per week" : "Focus time per day"} subtitle={`${t.activeDays} active days · best streak ${t.bestStreakDays}d`}
          table={{ columns: ["Period", "Minutes"], rows: series.map((s) => [s.label, s.value]) }}>
          <BarChart data={series.map((s) => ({ label: s.label, value: s.value, tip: <><b>{minutesLabel(s.value)}</b><span>{longRange ? `Week of ${s.label}` : s.label}</span></> }))}
            format={(v) => (v >= 120 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`)} />
        </ChartCard>
        <ChartCard title="Focus score" subtitle="Completion, rating, calm and volume combined"
          table={{ columns: ["Period", "Score"], rows: series.map((s) => [s.label, Math.round(s.score / s.n)]) }}>
          <LineChart data={series.map((s) => ({ label: s.label, value: s.value > 0 ? Math.round(s.score / s.n) : null }))} max={100} />
        </ChartCard>
      </div>

      <ChartCard title="When you focus" subtitle="Focus minutes by weekday and hour — darker is more"
        table={{ columns: ["Day", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))], rows: d.heatmap.map((r, i) => [WEEKDAYS[i]!, ...r]) }}>
        <Heatmap matrix={d.heatmap} rowLabels={WEEKDAYS} colLabel={hourLabel} format={(v) => minutesLabel(v)} />
      </ChartCard>

      <div className="grid-2">
        <ChartCard title="Focus by hour of day" subtitle="Hover to see your average focus rating per hour"
          table={{ columns: ["Hour", "Minutes", "Avg rating", "Completion"], rows: d.byHour.filter((h) => h.focusMinutes).map((h) => [hourLabel(h.hour), h.focusMinutes, h.avgRating ?? "—", h.completionRate != null ? `${Math.round(h.completionRate * 100)}%` : "—"]) }}>
          <BarChart data={d.byHour.map((h) => ({
            label: hourLabel(h.hour), value: h.focusMinutes,
            tip: <><b>{minutesLabel(h.focusMinutes)}</b><span>{hourLabel(h.hour)}{h.avgRating ? ` · ${h.avgRating}/5 focus` : ""}{h.completionRate != null ? ` · ${Math.round(h.completionRate * 100)}% done` : ""}</span></>,
          }))} format={(v) => (v >= 120 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`)} />
        </ChartCard>
        <ChartCard title="Completed vs abandoned" subtitle="By planned block length — % shows completion"
          table={{ columns: ["Length", "Completed", "Abandoned"], rows: d.lengthDistribution.map((r) => [r.bucket, r.completed, r.abandoned]) }}>
          <StackedBars rows={d.lengthDistribution.map((r) => ({ label: r.bucket, a: r.completed, b: r.abandoned }))} series={["Completed", "Abandoned"]} />
        </ChartCard>
      </div>

      <div className="grid-3">
        <ChartCard title="Distractions" subtitle={`${t.distractionsPerHour} per focused hour`}
          table={{ columns: ["Type", "Count"], rows: d.distractions.map((x) => [catLabel(x.category)?.label ?? x.category, x.count]) }}>
          {d.distractions.length
            ? <HBars rows={d.distractions.map((x) => ({ label: <>{catLabel(x.category)?.emoji} {catLabel(x.category)?.label ?? x.category}</>, value: x.count }))} />
            : <p className="muted">No distractions logged. Use the ⚡ button (or D) during focus.</p>}
        </ChartCard>
        <ChartCard title="By tag" table={{ columns: ["Tag", "Minutes", "Pomodoros"], rows: d.byTag.map((x) => [x.tag, x.focusMinutes, x.pomodoros]) }}>
          <HBars rows={d.byTag.slice(0, 8).map((x) => ({ label: `#${x.tag}`, value: x.focusMinutes }))} format={minutesLabel} />
        </ChartCard>
        <ChartCard title="By weekday" table={{ columns: ["Day", "Minutes", "Avg rating"], rows: d.byWeekday.map((x) => [WEEKDAYS[x.weekday]!, x.focusMinutes, x.avgRating ?? "—"]) }}>
          <HBars rows={d.byWeekday.map((x) => ({ label: WEEKDAYS[x.weekday], value: x.focusMinutes, sub: x.avgRating ? `${x.avgRating}/5` : undefined }))} format={minutesLabel} />
        </ChartCard>
      </div>

      <ChartCard title="Time per task" subtitle={d.estimateAccuracy != null ? `Finished tasks took ${d.estimateAccuracy}× your estimates` : "Finish tasks to see estimate accuracy"}
        table={{ columns: ["Task", "Minutes", "Done / estimate"], rows: d.byTask.map((x) => [x.title, x.focusMinutes, `${x.completedPomodoros}/${x.estimatePomodoros}`]) }}>
        {d.byTask.length
          ? <HBars rows={d.byTask.map((x) => ({ label: x.title, value: x.focusMinutes, sub: `${x.completedPomodoros}/${x.estimatePomodoros} pomodoros` }))} format={minutesLabel} />
          : <p className="muted">Pick a task on the timer to track time per task.</p>}
      </ChartCard>
      <p className="muted small center"><ProBadge /> Range {shortDate(d.range.from)} – {shortDate(d.range.to)}</p>
    </>
  );
}
