import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moduleShim = { exports: {} };
const loadMerge = new Function("module", "exports", "globalThis", fs.readFileSync(new URL("../sync-merge.js", import.meta.url), "utf8") + "\nreturn module.exports;");
const LockinSync = loadMerge(moduleShim, moduleShim.exports, globalThis);
const { videoCount, sprintVideoTotal, mergeEvents, adjustManual, planSync, copyBackup, VIDEO_HABIT, VIDEO_GOAL } = LockinSync;

const DATES = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

function phoneData() {
  return {
    goals: [{ id: "g1", name: "Health", emoji: "💪" }],
    habits: [
      { id: "h1", label: "No junk food", perWeek: 7 },
      { id: "h2", label: "10 gym visits", perWeek: 5 },
      { id: VIDEO_HABIT, label: "Post 10 videos", perWeek: 7 },
    ],
    mantras: [{ id: "m1", text: "I am in control of my day" }],
    trophies: [{ id: "t1", image: "data:image/png;base64,AAAA", caption: "family", family: true }],
    days: {
      "2026-11-02": { checks: { h1: true, h6: true }, chilled: false, choice: "build", urges: [{ type: "food", resisted: true, ts: 1 }] },
      "2026-11-04": { checks: { h2: true }, chilled: false, choice: "drift" },
    },
    theme: "dark",
    nicotineStart: "2026-11-02T00:00:00.000Z",
    v: 7,
  };
}

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
  };
}

test("a legacy h6 tick counts as 1 video and is not rewritten", () => {
  const data = phoneData();
  const before = JSON.stringify(data);
  assert.equal(videoCount(data.days["2026-11-02"]), 1);
  assert.equal(videoCount(data.days["2026-11-04"]), 0);
  assert.equal(videoCount(undefined), 0);
  assert.equal(sprintVideoTotal(data, DATES), 1);
  assert.equal(VIDEO_GOAL, 10);
  assert.equal(JSON.stringify(data), before);
});

test("manual add and remove keep other habits and can move the visible count", () => {
  const data = phoneData();
  const plus = adjustManual(data, "2026-11-02", 1);
  assert.equal(videoCount(plus.days["2026-11-02"]), 2);
  assert.equal(plus.days["2026-11-02"].checks.h1, true);
  assert.equal(plus.days["2026-11-02"].choice, "build");
  assert.equal(plus.days["2026-11-02"].urges.length, 1);
  assert.equal(videoCount(data.days["2026-11-02"]), 1);
  const minus = adjustManual(plus, "2026-11-02", -1);
  assert.equal(videoCount(minus.days["2026-11-02"]), 1);
  const cleared = adjustManual(minus, "2026-11-02", -1);
  assert.equal(videoCount(cleared.days["2026-11-02"]), 0);
  assert.equal(cleared.days["2026-11-02"].checks.h6, false);
  assert.equal(cleared.days["2026-11-02"].checks.h1, true);
  assert.equal(adjustManual(cleared, "2026-11-02", -1), cleared);
});

test("merge is additive and idempotent and does not mutate the input", () => {
  const data = phoneData();
  const before = JSON.stringify(data);
  const event = {
    id: "gym-2026-11-03",
    ts: "2026-11-03T12:00:00.000Z",
    source: "tyler",
    note: "confirmed",
    op: "check",
    habitId: "h2",
    date: "2026-11-03",
    done: true,
  };
  const once = mergeEvents(data, { applied: {}, effects: {}, backedUp: false }, [event]);
  assert.equal(JSON.stringify(data), before);
  assert.equal(once.changed, true);
  assert.deepEqual(once.appliedIds, ["gym-2026-11-03"]);
  assert.equal(once.data.days["2026-11-03"].checks.h2, true);
  assert.equal(once.data.days["2026-11-02"].checks.h1, true);
  assert.equal(once.data.days["2026-11-02"].checks.h6, true);
  assert.equal(once.data.days["2026-11-04"].checks.h2, true);
  assert.equal(once.data.trophies[0].image, "data:image/png;base64,AAAA");
  assert.equal(once.data.theme, "dark");
  assert.equal(once.data.nicotineStart, "2026-11-02T00:00:00.000Z");
  assert.equal(once.data.v, 7);
  assert.equal(videoCount(once.data.days["2026-11-02"]), 1);

  const twice = mergeEvents(once.data, once.syncState, [event]);
  assert.equal(twice.changed, false);
  assert.equal(twice.data, once.data);
  assert.deepEqual(twice.appliedIds, []);
  assert.equal(twice.data.days["2026-11-03"].checks.h2, true);
});

test("a check that was already on the phone is not undone", () => {
  const data = phoneData();
  const event = { id: "c-h1", ts: "2026-11-02T08:00:00.000Z", op: "check", habitId: "h1", date: "2026-11-02" };
  const merged = mergeEvents(data, {}, [event]);
  assert.equal(merged.changed, false);
  assert.equal(merged.syncState.effects["c-h1"].addedCheck, false);
  const undone = mergeEvents(merged.data, merged.syncState, [
    { id: "u-h1", ts: "2026-11-02T09:00:00.000Z", op: "undo", undoId: "c-h1" },
  ]);
  assert.equal(undone.data.days["2026-11-02"].checks.h1, true);
  assert.equal(videoCount(undone.data.days["2026-11-02"]), 1);
});

test("undo removes only the check sync added", () => {
  const data = phoneData();
  const event = { id: "c-h2", ts: "2026-11-05T08:00:00.000Z", op: "check", habitId: "h2", date: "2026-11-05" };
  const merged = mergeEvents(data, {}, [event]);
  assert.equal(merged.data.days["2026-11-05"].checks.h2, true);
  assert.equal(merged.data.days["2026-11-04"].checks.h2, true);
  const undone = mergeEvents(merged.data, merged.syncState, [
    { id: "u-h2", ts: "2026-11-05T09:00:00.000Z", op: "undo", undoId: "c-h2" },
  ]);
  assert.equal(undone.data.days["2026-11-05"].checks.h2, false);
  assert.equal(undone.data.days["2026-11-04"].checks.h2, true);
  assert.equal(undone.data.days["2026-11-02"].checks.h1, true);
});

test("video increment and set never lower a phone count, and undo drops only the sync delta", () => {
  let data = phoneData();
  data = adjustManual(data, "2026-11-03", 4);
  assert.equal(videoCount(data.days["2026-11-03"]), 4);

  const lower = { id: "set-low", ts: "2026-11-03T10:00:00.000Z", op: "video", date: "2026-11-03", count: 2 };
  const kept = mergeEvents(data, {}, [lower]);
  assert.equal(kept.changed, false);
  assert.equal(videoCount(kept.data.days["2026-11-03"]), 4);

  const raise = { id: "set-high", ts: "2026-11-03T11:00:00.000Z", op: "video", date: "2026-11-03", count: 6 };
  const raised = mergeEvents(kept.data, kept.syncState, [raise]);
  assert.equal(videoCount(raised.data.days["2026-11-03"]), 6);
  assert.equal(raised.data.days["2026-11-02"].checks.h1, true);

  const inc = { id: "inc-1", ts: "2026-11-03T12:00:00.000Z", op: "video", date: "2026-11-03", delta: 1 };
  const bumped = mergeEvents(raised.data, raised.syncState, [inc, inc]);
  assert.equal(videoCount(bumped.data.days["2026-11-03"]), 7);

  const undone = mergeEvents(bumped.data, bumped.syncState, [
    { id: "u-set", ts: "2026-11-03T13:00:00.000Z", op: "undo", undoId: "set-high" },
  ]);
  assert.equal(videoCount(undone.data.days["2026-11-03"]), 5);
  assert.equal(undone.data.days["2026-11-03"].checks.h6, true);

  const undoneInc = mergeEvents(undone.data, undone.syncState, [
    { id: "u-inc", ts: "2026-11-03T14:00:00.000Z", op: "undo", undoId: "inc-1" },
  ]);
  assert.equal(videoCount(undoneInc.data.days["2026-11-03"]), 4);
  assert.equal(sprintVideoTotal(undoneInc.data, DATES), 5);
});

test("the same video event does not add twice when the applied-id list is empty but the day already recorded it", () => {
  const data = phoneData();
  const event = { id: "vid-once", ts: "2026-11-03T16:00:00.000Z", op: "video", date: "2026-11-03", delta: 1 };
  const once = mergeEvents(data, {}, [event]);
  assert.equal(videoCount(once.data.days["2026-11-03"]), 1);
  const retry = mergeEvents(once.data, {}, [event]);
  assert.equal(retry.changed, false);
  assert.equal(videoCount(retry.data.days["2026-11-03"]), 1);
});

test("a remote h6 check counts as one video and does not erase a phone tick", () => {
  const data = phoneData();
  const again = mergeEvents(data, {}, [
    { id: "h6-check", ts: "2026-11-02T08:00:00.000Z", op: "check", habitId: "h6", date: "2026-11-02" },
  ]);
  assert.equal(again.changed, false);
  assert.equal(videoCount(again.data.days["2026-11-02"]), 1);

  const fresh = mergeEvents(data, {}, [
    { id: "h6-day3", ts: "2026-11-03T08:00:00.000Z", op: "check", habitId: "h6", date: "2026-11-03" },
  ]);
  assert.equal(videoCount(fresh.data.days["2026-11-03"]), 1);
  const undone = mergeEvents(fresh.data, fresh.syncState, [
    { id: "u-day3", ts: "2026-11-03T09:00:00.000Z", op: "undo", undoId: "h6-day3" },
  ]);
  assert.equal(videoCount(undone.data.days["2026-11-03"]), 0);
  assert.equal(videoCount(undone.data.days["2026-11-02"]), 1);
});

test("undo waits if its target is not in the log yet", () => {
  const data = phoneData();
  const early = mergeEvents(data, {}, [
    { id: "u-early", ts: "2026-11-06T07:00:00.000Z", op: "undo", undoId: "later" },
  ]);
  assert.equal(early.changed, false);
  assert.deepEqual(early.appliedIds, []);
  const later = mergeEvents(data, early.syncState || {}, [
    { id: "later", ts: "2026-11-06T08:00:00.000Z", op: "check", habitId: "h2", date: "2026-11-06" },
    { id: "u-early", ts: "2026-11-06T09:00:00.000Z", op: "undo", undoId: "later" },
  ]);
  assert.equal(later.data.days["2026-11-06"].checks.h2, false);
});

test("offline sync does not change data and the first real merge asks for a backup", () => {
  const data = phoneData();
  const raw = JSON.stringify(data);
  const storage = memoryStorage({ "lockin-14d-v1": raw });
  const state = { applied: {}, effects: {}, backedUp: false, readToken: "read" };

  const offline = planSync(data, state, { ok: false });
  assert.equal(offline.offline, true);
  assert.equal(offline.changed, false);
  assert.equal(offline.backupFirst, false);
  assert.equal(offline.data, data);
  assert.equal(storage.getItem("lockin-14d-v1"), raw);

  const event = { id: "vid-1", ts: "2026-11-03T15:00:00.000Z", op: "video", date: "2026-11-03", delta: 1, source: "tyler", note: "Marwan posted a video on Nov 3" };
  const online = planSync(data, state, { ok: true, events: [event] });
  assert.equal(online.offline, false);
  assert.equal(online.changed, true);
  assert.equal(online.backupFirst, true);
  assert.equal(copyBackup(storage, "lockin-14d-v1", "lockin-14d-v1-presync-backup"), true);
  assert.equal(storage.getItem("lockin-14d-v1"), raw);
  assert.equal(storage.getItem("lockin-14d-v1-presync-backup"), raw);
  assert.equal(videoCount(online.data.days["2026-11-03"]), 1);
  assert.equal(online.data.days["2026-11-02"].checks.h1, true);
  assert.equal(online.data.trophies[0].caption, "family");

  storage.setItem("lockin-14d-v1", JSON.stringify(online.data));
  const saved = storage.getItem("lockin-14d-v1");
  const again = planSync(online.data, Object.assign({}, online.syncState, { backedUp: true }), { ok: true, events: [event] });
  assert.equal(again.changed, false);
  assert.equal(again.backupFirst, false);
  assert.equal(again.data, online.data);
  assert.equal(storage.getItem("lockin-14d-v1"), saved);
  assert.equal(storage.getItem("lockin-14d-v1-presync-backup"), raw);
});

test("a failed backup does not pretend it wrote the copy", () => {
  const storage = {
    getItem() { return "{\"days\":{}}"; },
    setItem() { throw new Error("quota"); },
  };
  assert.equal(copyBackup(storage, "lockin-14d-v1", "lockin-14d-v1-presync-backup"), false);
});
