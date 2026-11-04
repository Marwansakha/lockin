# Remote sync

Lock In keeps Marwan's habits on the phone, under `localStorage` key `lockin-14d-v1`. This sync path lets a bot (Tyler) append a log of updates on the site. The phone pulls that log and merges it in. The phone is still the copy he taps. The server never stores the habit file, the photos, or the mantras.

The log is one JSON document in a site-scoped Netlify Blobs store (`lockin-sync`, key `events`). Blobs is on the free plan with no database to keep running. Events survive the next production deploy. A deploy preview, if one is ever built, uses that same log.

Production base URL: `https://marwan-lockin.netlify.app`

## How the phone connects

The write token (`LOCKIN_SYNC_TOKEN`) can post events. The phone should not keep that token. It exchanges it once for a read-only key and stores only the read key.

1. Open the app → Settings → Sync.
2. Paste the sync key (the value of `LOCKIN_SYNC_TOKEN`) and tap **Connect sync**.
3. The phone calls `POST /api/sync/connect`, saves the returned `readToken` on this phone, and does not keep the write token.
4. It then pulls the log. After that, opening the app pulls again. **Sync now** pulls on demand.

One-time link, same exchange, useful to send to his phone:

```text
https://marwan-lockin.netlify.app/#sync=YOUR_LOCKIN_SYNC_TOKEN
```

The token sits in the URL hash, so the browser does not send it to the server as a query string. The page reads it, exchanges it, then strips the hash. Treat the link like the write token: anyone with it can post events until it is rotated.

**Disconnect** forgets the read key on this phone. It does not delete habits or the event log.

Until Connect sync has succeeded, the app never calls the server.

## Auth

`LOCKIN_SYNC_TOKEN` is a Netlify environment variable, already set for production, deploy previews, and branch deploys. The function reads it with `Netlify.env.get("LOCKIN_SYNC_TOKEN")`. It is not in source.

Every request needs `Authorization: Bearer <token>`.

| Token | How you get it | Can post | Can read |
|---|---|---|---|
| Write | `LOCKIN_SYNC_TOKEN` | Yes | Yes |
| Read | `POST /api/sync/connect` with the write token, or the hash below | No | Yes |

The read token is the hex SHA-256 of the UTF-8 string `lockin-read-v1\n` followed by the write token. A bot that already has the write token does not need to store a second secret. Missing or wrong credentials get `401` and the log is not read or written.

```bash
curl -sS -X POST "https://marwan-lockin.netlify.app/api/sync/connect" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN"
```

```json
{ "readToken": "…" }
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/sync/events` | Write | Append one event, or a batch |
| `GET` | `/api/sync/events` | Read or write | Return the log, oldest first |
| `POST` | `/api/sync/connect` | Write | Return the read token |

`GET` responds with `{ "events": [ ... ] }`. `POST` responds with `{ "ok": true, "events": [ ... ] }`. Posting an id that is already in the log returns that event with `"duplicate": true` and does not add a second copy.

A single event can be the JSON body, or you can send `{ "events": [ ... ] }`.

## Event format

Every stored event has:

| Field | Required | Meaning |
|---|---|---|
| `id` | No | 1–80 characters: letters, numbers, `.`, `_`, `:`, `-`. The server generates `evt_<uuid>` when this is omitted. Reuse an id to retry safely. |
| `ts` | No | ISO timestamp. The server uses the time it received the event when this is omitted or invalid. |
| `source` | Yes | Who posted it, for example `tyler`. Up to 80 characters. |
| `note` | No | Short human note, up to 500 characters. |
| `op` | Yes | `check`, `video`, or `undo`. |

`check` — mark a habit done on a date. This never turns a habit off. Send `undo` for that.

| Field | Required | Meaning |
|---|---|---|
| `habitId` | Yes | `h1` … `h9` (see the list below). |
| `date` | Yes | `YYYY-MM-DD`. |
| `done` | No | `true`. `false` is rejected. |

`video` — add to the Post 10 videos counter (`h6`) on that date. Send `delta` or `count`, not both.

| Field | Required | Meaning |
|---|---|---|
| `date` | Yes | `YYYY-MM-DD`. |
| `delta` | One of these | Integer from 1 to 100. Added to that day's count. |
| `count` | One of these | Integer from 0 to 100. Raises that day's count up to this number. It does not lower a count the phone already has. |

`undo` — reverse one earlier event, and only what that event added.

| Field | Required | Meaning |
|---|---|---|
| `undoId` | Yes | The `id` of the event to reverse. |

Habit ids for this sprint:

| Id | Habit |
|---|---|
| `h1` | No junk food |
| `h2` | 10 gym visits |
| `h3` | No fapping |
| `h4` | Set up the course |
| `h5` | Stella dashboards |
| `h6` | Post 10 videos |
| `h7` | Main Stella work |
| `h8` | Quelo docs and meet Khaled |
| `h9` | Technical ecosystem |

## Curl examples

Use a placeholder in scripts and pass the real token from the environment. Do not commit it.

Marwan posted a video on Nov 3:

```bash
curl -sS -X POST "https://marwan-lockin.netlify.app/api/sync/events" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "video-2026-11-03-1",
    "source": "tyler",
    "note": "Marwan posted a video on Nov 3",
    "op": "video",
    "date": "2026-11-03",
    "delta": 1
  }'
```

Set that day's video count to 2 (this will not reduce a higher count already on the phone):

```bash
curl -sS -X POST "https://marwan-lockin.netlify.app/api/sync/events" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "video-2026-11-03-set",
    "source": "tyler",
    "note": "Two videos on Nov 3",
    "op": "video",
    "date": "2026-11-03",
    "count": 2
  }'
```

Mark gym done on Nov 3:

```bash
curl -sS -X POST "https://marwan-lockin.netlify.app/api/sync/events" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "gym-2026-11-03",
    "source": "tyler",
    "note": "Gym confirmed",
    "op": "check",
    "habitId": "h2",
    "date": "2026-11-03"
  }'
```

Undo the video event above:

```bash
curl -sS -X POST "https://marwan-lockin.netlify.app/api/sync/events" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "undo-video-2026-11-03-1",
    "source": "tyler",
    "note": "Count was wrong",
    "op": "undo",
    "undoId": "video-2026-11-03-1"
  }'
```

Read the log back (write token or read token):

```bash
curl -sS "https://marwan-lockin.netlify.app/api/sync/events" \
  -H "Authorization: Bearer YOUR_LOCKIN_SYNC_TOKEN"
```

A request with no token:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://marwan-lockin.netlify.app/api/sync/events"
```

That returns `401`.

## What the phone does with the log

On a successful pull the phone merges events that it has not applied yet.

- The merge adds. It does not clear the day log, reset progress, or change the storage key `lockin-14d-v1`.
- Applied event ids are remembered on the phone under `lockin-sync-v1`, so the same event is not applied twice. A video contribution is also stored on that day, so a retry still will not add it twice.
- A `check` turns a habit on. If it was already on, the event is remembered and a later undo does not turn it off.
- A `check` for `h6`, a `video` delta, or a `video` count adds videos. A count only raises the day. It never lowers what is already there.
- `undo` removes only the checks or videos that same event added.
- The + and − buttons on the phone change the visible count for that day, including videos a bot added. An undo still removes only that event's own contribution.
- An old `h6` tick with no video count yet counts as 1 video. Opening the app does not rewrite that day. The count is written when the phone or a sync event changes it.
- Before the first merge that actually changes habit data, the phone copies the current `lockin-14d-v1` value into `lockin-14d-v1-presync-backup`. If that copy cannot be saved, the merge is skipped.
- If the request fails, times out, or returns a non-200 status, the habit data is left exactly as it was.

Sprint progress for videos is the sum across 2–15 Nov 2026, shown as `n/10`. Other habits are unchanged.
