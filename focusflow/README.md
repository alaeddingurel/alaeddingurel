# FocusFlow 🍅✦

An **AI-enhanced, highly customizable Pomodoro timer** with accounts, a Free/Pro plan, detailed focus analytics and a coach that helps you focus *longer and better* over time.

## Features

### Timer (everyone)
- Focus / short break / long break with configurable lengths, long-break interval and daily goal
- **Presets**: Classic 25/5, Deep work 50/10, Sprints 15/3, 52/17, plus your own
- Auto-start breaks or focus, **strict mode** (no pausing), confirm before ending early
- **Drift-free and reload-proof**: time comes from timestamps, so it stays accurate in background tabs and survives refreshes. If the tab was closed when a block ended, it completes correctly when you come back
- **Offline-safe**: finished sessions queue locally and sync when you're back online
- Synthesized sounds (bell, chime, digital, wood) with volume and repeat, optional ticking, and a heads-up chime before the end
- Desktop notifications and a countdown in the tab title
- Themes (system/light/dark), any focus and break color, ring/bar/minimal timer styles, and **zen mode**
- **Distraction log**: press ⚡ or `D` to record what pulled you away (phone, social, people, thought, noise)
- **Reflection**: rate focus and energy in about 3 seconds after each block
- Tasks with pomodoro estimates, tags, progress and time tracked per task
- Keyboard shortcuts: `Space` start/pause · `R` reset · `S` skip · `D` distraction · `Z` zen · `1/2/3` modes · `?` help

### Focus coach
| | Free | Pro |
|---|---|---|
| Adaptive next-session suggestion | ✓ | ✓ |
| Coach insights | 2 | all |
| Today / streak / 7-day stats | ✓ | ✓ |
| Detailed stats (heatmap, focus score, completion, distractions, tags, tasks, estimate accuracy) | | ✓ |
| 7d / 30d / 90d / 1y ranges and CSV export | | ✓ |
| Weekly/monthly **AI focus report** with experiments to try | | ✓ |
| **AI day planner** (puts your hardest tasks in your peak hours) | | ✓ |
| Custom presets | 2 | unlimited |

**How the coach works** (`server/src/ai/coach.ts`):
- **Adaptive timer**: if you finish ≥85% of blocks with good focus ratings, it stretches the next block by 5 min to build stamina. If you keep abandoning them, it shortens blocks toward the point where you usually stop. If you keep overrunning in flow mode, it matches your natural length. It also trims 5 min at hours where your ratings dip.
- **Peak hours**: ranks hours of the day by rating, completion rate and distraction rate.
- **Burnout guard**: 140+ min of focus in 3 hours without a real break triggers a longer break.
- **Focus score (0–100)**: 35% completion, 25% self-rated focus, 25% calm (distractions/hour), 15% volume toward your goal.
- **Insights**: trend vs the previous period, block length too long/short, your top distraction plus a specific fix, skipped breaks, estimate accuracy, deep-work time and goal consistency. Many come with a one-click "apply" button that changes your settings.

**Claude integration** (`server/src/ai/claude.ts`): when `ANTHROPIC_API_KEY` is set, Pro reports and day plans are written by Claude (`claude-opus-5-5`) using structured outputs. Server-side refusal fallbacks are enabled, and results are cached per data fingerprint so reopening the page doesn't re-bill. **Only aggregated statistics are sent**: no names, emails or notes. Without a key, or if a call fails, the built-in engine answers instead, so the app always works.

### Labs: experimental features as per-user flags
Instead of separate branches per experiment, each experimental technique is a **feature flag** that a user can switch on in *Settings → Labs*. You can try them side by side on one codebase:
- **Adaptive timer**: the coach sets each block's length
- **Flow mode**: the timer counts *up* past zero instead of interrupting you, and you hit Finish when ready
- **Ambient soundscapes**: generated white, pink or brown noise, or rain
- **Smart break ideas**: a concrete restorative activity for each break
- **Burnout guard**

To add a new experiment, add a key to `LabsFlags` in `shared/src/index.ts`, give it a default, and read `settings.labs.<flag>` where it applies.

## Architecture

```
focusflow/
├── shared/   Types, default settings and settings normalization (used by both sides)
├── server/   Express 5 + node:sqlite API (no native dependencies)
│   ├── src/routes/     account (auth), data (settings/tasks/sessions), insights (stats/AI/billing)
│   ├── src/ai/         coach.ts (heuristics engine) · claude.ts (optional Claude layer)
│   ├── src/stats.ts    pure statistics functions
│   ├── src/repo.ts     all SQL in one place
│   └── test/           API + coach unit tests (node:test)
└── web/      Vite + React 19 + React Router
    └── src/
        ├── state/      auth, settings (debounced sync), timer engine, toasts
        ├── features/   timer, tasks, stats (SVG charts), coach, settings, billing, auth
        └── lib/        Web Audio synth, notifications, formatting
```

**Security**: passwords are hashed with scrypt. Sessions use opaque random tokens (only their SHA-256 is stored) in an httpOnly, SameSite=Lax cookie. Every state-changing request needs a custom header as a CSRF guard. Auth routes are rate-limited, login runs in constant time, every query is scoped per user, and changing your password signs out your other devices. Account deletion removes all your data.

## Getting started

Requires **Node 22.13+** (uses the built-in `node:sqlite`).

```bash
cd focusflow
npm install
npm run seed        # optional: demo@focusflow.app / focusflow123 (Pro, 8 weeks of history)
npm run dev         # API on :8787, web on http://localhost:5173
```

Production:

```bash
npm run build       # builds web/dist
npm start           # serves API + built app on :8787
```

Other commands: `npm test` (server tests) and `npm run typecheck`.

Configuration lives in `.env` (see `.env.example`). To enable Claude, set `ANTHROPIC_API_KEY`.

## Billing
`POST /api/billing/upgrade` currently flips the account to Pro instantly (demo mode). For production, replace it with a Stripe Checkout session, and call `repo.setPlan(userId, "pro" | "free")` from the Stripe webhook. Pro gating is enforced on the server (`requirePro`), not only in the UI.

## Roadmap ideas
- PWA + service worker (background notifications, install to home screen)
- Calendar import so the day planner works around meetings
- Team rooms / body-doubling sessions
- Site blocker browser extension that follows the timer
- Weekly email digest of the AI report
