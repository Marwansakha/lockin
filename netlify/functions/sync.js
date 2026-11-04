import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "lockin-sync";
const LOG_KEY = "events";
const MAX_EVENTS = 5000;
const OPS = new Set(["check", "video", "undo"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

export function deriveReadToken(writeToken) {
  return createHash("sha256").update("lockin-read-v1\n" + writeToken).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authRole(authorization, writeToken) {
  if (!writeToken) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization || "");
  if (!match) return null;
  const presented = match[1];
  if (safeEqual(presented, writeToken)) return "write";
  if (safeEqual(presented, deriveReadToken(writeToken))) return "read";
  return null;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeEvent(input, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("event must be an object");
  }
  const op = input.op;
  if (!OPS.has(op)) throw new Error("op must be check, video, or undo");
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (!source || source.length > 80) throw new Error("source is required");
  let id = typeof input.id === "string" ? input.id.trim() : "";
  if (id && !ID_RE.test(id)) throw new Error("id must be 1-80 chars: letters, numbers, dot, underscore, colon, hyphen");
  if (!id) id = "evt_" + randomUUID();
  const note = input.note == null || input.note === "" ? "" : String(input.note);
  if (note.length > 500) throw new Error("note is too long");
  let ts = now;
  if (typeof input.ts === "string" && !Number.isNaN(Date.parse(input.ts))) {
    ts = new Date(input.ts).toISOString();
  }
  const event = { id: id, ts: ts, source: source, op: op };
  if (note) event.note = note;

  if (op === "check") {
    if (typeof input.habitId !== "string" || !input.habitId.trim()) throw new Error("habitId is required");
    if (!DATE_RE.test(input.date || "")) throw new Error("date must be YYYY-MM-DD");
    if (input.done === false) throw new Error("check cannot set done to false; post an undo event");
    event.habitId = input.habitId.trim().slice(0, 40);
    event.date = input.date;
    event.done = true;
  } else if (op === "video") {
    if (!DATE_RE.test(input.date || "")) throw new Error("date must be YYYY-MM-DD");
    event.date = input.date;
    event.habitId = "h6";
    const hasCount = input.count != null && input.count !== "";
    const hasDelta = input.delta != null && input.delta !== "";
    if (hasCount === hasDelta) throw new Error("video event needs count or delta, not both");
    if (hasCount) {
      const count = Number(input.count);
      if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error("count must be an integer from 0 to 100");
      event.count = count;
    } else {
      const delta = Number(input.delta);
      if (!Number.isInteger(delta) || delta < 1 || delta > 100) throw new Error("delta must be an integer from 1 to 100");
      event.delta = delta;
    }
  } else {
    if (typeof input.undoId !== "string" || !ID_RE.test(input.undoId)) throw new Error("undoId is required");
    event.undoId = input.undoId;
  }
  return event;
}

function eventInputs(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.events)) return body.events;
  if (body && typeof body === "object") return [body];
  throw new Error("body must be an event or { events: [...] }");
}

async function readLog(store) {
  const data = await store.get(LOG_KEY, { type: "json" });
  if (!data || !Array.isArray(data.events)) return { events: [] };
  return { events: data.events };
}

export async function handleRequest(req, deps) {
  const token = deps && deps.token;
  if (!token) return json({ error: "sync token is not configured" }, 500);

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const role = authRole(req.headers.get("authorization"), token);
  if (!role) return json({ error: "unauthorized" }, 401);

  if (path === "/api/sync/connect" || path.endsWith("/api/sync/connect")) {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (role !== "write") return json({ error: "unauthorized" }, 401);
    return json({ readToken: deriveReadToken(token) });
  }

  if (path !== "/api/sync/events" && !path.endsWith("/api/sync/events")) {
    return json({ error: "not found" }, 404);
  }

  if (req.method === "GET") {
    const log = await readLog(deps.store);
    return json({ events: log.events });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (role !== "write") return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "invalid json" }, 400);
  }

  let inputs;
  try {
    inputs = eventInputs(body);
    if (!inputs.length) throw new Error("at least one event is required");
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const now = new Date().toISOString();
  let normalized;
  try {
    normalized = inputs.map(function (raw) { return normalizeEvent(raw, now); });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const log = await readLog(deps.store);
  const existing = new Map(log.events.map(function (ev) { return [ev.id, ev]; }));
  const stored = [];
  let added = 0;
  for (const ev of normalized) {
    if (existing.has(ev.id)) {
      stored.push(Object.assign({ duplicate: true }, existing.get(ev.id)));
      continue;
    }
    if (log.events.length >= MAX_EVENTS) return json({ error: "event log is full" }, 413);
    log.events.push(ev);
    existing.set(ev.id, ev);
    stored.push(ev);
    added += 1;
  }
  if (added) await deps.store.setJSON(LOG_KEY, log);
  return json({ ok: true, events: stored });
}

export default async function (req) {
  const token = Netlify.env.get("LOCKIN_SYNC_TOKEN");
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  return handleRequest(req, { token: token, store: store });
}

export const config = {
  path: ["/api/sync/events", "/api/sync/connect"],
};
