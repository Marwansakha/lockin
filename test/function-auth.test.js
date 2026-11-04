import assert from "node:assert/strict";
import test from "node:test";
import { authRole, deriveReadToken, handleRequest } from "../netlify/functions/sync.js";

const WRITE = "test-write-token-not-a-real-secret";
const READ = deriveReadToken(WRITE);

function memoryStore() {
  let value = null;
  return {
    reads: 0,
    writes: 0,
    async get() {
      this.reads += 1;
      return value ? JSON.parse(JSON.stringify(value)) : null;
    },
    async setJSON(_key, next) {
      this.writes += 1;
      value = JSON.parse(JSON.stringify(next));
    },
  };
}

function closedStore() {
  return {
    async get() { throw new Error("store should not be read without auth"); },
    async setJSON() { throw new Error("store should not be written without auth"); },
  };
}

function req(url, options) {
  return new Request(url, options);
}

test("authRole rejects a missing or wrong token", () => {
  assert.equal(authRole(null, WRITE), null);
  assert.equal(authRole("", WRITE), null);
  assert.equal(authRole("Bearer", WRITE), null);
  assert.equal(authRole("Bearer wrong-token", WRITE), null);
  assert.equal(authRole("Bearer " + WRITE, ""), null);
  assert.equal(authRole("Bearer " + WRITE, WRITE), "write");
  assert.equal(authRole("bearer " + READ, WRITE), "read");
});

test("GET and POST return 401 without a token and do not touch the log", async () => {
  const store = closedStore();
  const get = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events"), { token: WRITE, store });
  assert.equal(get.status, 401);
  assert.deepEqual(await get.json(), { error: "unauthorized" });

  const post = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "video", date: "2026-11-03", delta: 1, source: "tyler" }),
  }), { token: WRITE, store });
  assert.equal(post.status, 401);

  const wrong = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    headers: { authorization: "Bearer not-the-token" },
  }), { token: WRITE, store });
  assert.equal(wrong.status, 401);

  const connect = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/connect", { method: "POST" }), { token: WRITE, store });
  assert.equal(connect.status, 401);
});

test("a read token can fetch events but cannot post them", async () => {
  const store = memoryStore();
  const denied = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    method: "POST",
    headers: { authorization: "Bearer " + READ, "content-type": "application/json" },
    body: JSON.stringify({ id: "x", op: "check", habitId: "h2", date: "2026-11-03", source: "tyler" }),
  }), { token: WRITE, store });
  assert.equal(denied.status, 401);
  assert.equal(store.writes, 0);

  const empty = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    headers: { authorization: "Bearer " + READ },
  }), { token: WRITE, store });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { events: [] });
});

test("the write token appends an event once and connect returns the read token", async () => {
  const store = memoryStore();
  const event = {
    id: "video-2026-11-03-1",
    source: "tyler",
    note: "Marwan posted a video on Nov 3",
    op: "video",
    date: "2026-11-03",
    delta: 1,
  };
  const posted = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    method: "POST",
    headers: { authorization: "Bearer " + WRITE, "content-type": "application/json" },
    body: JSON.stringify(event),
  }), { token: WRITE, store });
  assert.equal(posted.status, 200);
  const created = await posted.json();
  assert.equal(created.ok, true);
  assert.equal(created.events.length, 1);
  assert.equal(created.events[0].id, event.id);
  assert.equal(created.events[0].op, "video");
  assert.equal(created.events[0].delta, 1);
  assert.ok(created.events[0].ts);

  const again = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    method: "POST",
    headers: { authorization: "Bearer " + WRITE, "content-type": "application/json" },
    body: JSON.stringify(event),
  }), { token: WRITE, store });
  const duplicate = await again.json();
  assert.equal(duplicate.events[0].duplicate, true);
  assert.equal(store.writes, 1);

  const listed = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    headers: { authorization: "Bearer " + WRITE },
  }), { token: WRITE, store });
  const log = await listed.json();
  assert.equal(log.events.length, 1);

  const connect = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/connect", {
    method: "POST",
    headers: { authorization: "Bearer " + WRITE },
  }), { token: WRITE, store });
  assert.equal(connect.status, 200);
  assert.deepEqual(await connect.json(), { readToken: READ });
  assert.notEqual(READ, WRITE);
});

test("a bad event is rejected and an unconfigured token is not a silent success", async () => {
  const store = memoryStore();
  const bad = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events", {
    method: "POST",
    headers: { authorization: "Bearer " + WRITE, "content-type": "application/json" },
    body: JSON.stringify({ op: "check", source: "tyler", habitId: "h1", date: "2026-11-03", done: false }),
  }), { token: WRITE, store });
  assert.equal(bad.status, 400);
  assert.equal(store.writes, 0);

  const missing = await handleRequest(req("https://marwan-lockin.netlify.app/api/sync/events"), { token: "", store });
  assert.equal(missing.status, 500);
});
