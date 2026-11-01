# Lock In

A personal habit and alignment tracker built as a single self-contained HTML file. No build step, no dependencies, no backend — open it in a browser and it works.

Live app: add your GitHub Pages or Netlify URL here once deployed.

## What it does

The app is built around a daily decision rather than a checklist. Each morning it asks which life you're choosing, then gets out of the way so you can execute it.

**Morning sequence** — A full-screen choice between Build and Drift. Drift requires a confirmation step; Build doesn't. Choosing Build plays a short reflective sequence: five random photos from your vision gallery, each paired with a message about perspective and long-term thinking, then a five-minute guided meditation with a breathing orb and a timer. The sequence runs once per day — reopening the app goes straight to Today.

**Today** — Season header, the day's choice, an animated alignment percentage, and your habits as a flat list with goal tags. Each habit tracks progress against a weekly target rather than demanding daily perfection.

**Goals and habits** — Habits belong to any number of goals, so "Reading / learning" can feed Find a wife, Make money and Mental peace at once. Habits can also auto-check each other: ticking Recovery ticks Workout, since recovery days replace training days.

**PAUSE** — A floating HOLD button for the moment before giving in. Pick what you're facing, move manually through three vision photos with their messages, then sit through a ten-minute hold timer before deciding. Logs whether you resisted.

**Mantras** — Read twice daily. First round turns the sun into a moon; completing both rounds plays a good-night sequence and checks off the habit.

**Vision gallery** — Photos of the people and the life you're building. Mark photos as family and they're reserved for the final frame of the morning sequence.

**Stats** — Weekly, monthly and quarterly views with an on-track gauge and recommendations that name the specific habits falling behind.

## Running it

Open `index.html` in any modern browser. That's the whole thing.

To deploy, point GitHub Pages at the repository root (Settings → Pages → Deploy from branch → `main` / root), or drag the file onto [Netlify Drop](https://app.netlify.com/drop).

On a phone, open the URL and use Add to Home Screen. It behaves like a native app from there.

## Data

Everything lives in the browser's `localStorage` under the key `happiness-v5`. Nothing is sent anywhere.

That means data is tied to one browser on one device. **Export a backup regularly** from Settings → Data → Export; it downloads a JSON file you can import on another device or restore after clearing site data. Photos are stored as base64 and dominate the storage budget, so if saving starts failing you'll see an explicit warning rather than silent data loss.

## Configuration

Values worth knowing, near the top of the script block:

| Constant | Purpose |
|---|---|
| `START` | First day of day 1. Currently `2026-08-23`. |
| `SEASON_LEN` | Days per season (90). |
| `TDAYS` | Total tracked days (365). |
| `SK` | localStorage key. Changing it starts fresh. |
| `CINE_SLIDES` | The five morning messages. |
| `PAUSE_SLIDES` | The three PAUSE messages. |
| `SEASON_GOALS` | Season context list. |
| `DEF_GOALS` / `DEF_HABITS` | Seed data for a fresh install. |

Goals, habits, weekly targets and mantras are all editable in-app from Settings — the constants only seed a first run.

## Alarms

Timers ring through several mechanisms at once, because mobile browsers each break a different one: a WAV bell generated at runtime and primed on first tap, a Web Audio backup scheduled on the audio clock, vibration, a system notification, and a full-screen visual flash. A near-silent loop keeps the audio session alive so the browser doesn't freeze the timer, and a screen wake lock holds the display on.

Settings has an Alarm section with immediate and delayed tests plus a diagnostic that reports what's actually working.

One limitation no web app can get around: **the iPhone silent switch mutes web audio entirely.** The vibration, notification and visual flash exist for that case.

## Theme

Light between 6am and 7pm, dark otherwise, checked hourly. Settings offers Auto, Light and Dark.

## Notes

Written as one file on purpose. The whole thing is readable top to bottom, deploys by copying, and has no toolchain to maintain or break.
