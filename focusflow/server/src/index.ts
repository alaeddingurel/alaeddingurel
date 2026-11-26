import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { claudeEnabled } from "./ai/claude.ts";

const db = openDb();
const { app, repo } = createApp(db);
const port = Number(process.env.PORT ?? 8787);

repo.purgeExpiredAuthSessions();
setInterval(() => repo.purgeExpiredAuthSessions(), 6 * 3600_000).unref();

app.listen(port, () => {
  console.log(`FocusFlow API listening on http://localhost:${port}`);
  console.log(`AI coach: ${claudeEnabled() ? "Claude enabled" : "built-in heuristics (set ANTHROPIC_API_KEY to enable Claude)"}`);
});
