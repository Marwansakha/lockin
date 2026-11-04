/* Lock In sync merge + video counter.
   Pure functions. No localStorage, no network.
   Loaded as a classic script in the app (window.LockinSync) and required by tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LockinSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var VIDEO_HABIT = "h6";
  var VIDEO_GOAL = 10;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function isDate(s) {
    return typeof s === "string" && DATE_RE.test(s);
  }

  function sumSync(sync) {
    var n = 0;
    if (!sync) return 0;
    for (var k in sync) {
      if (Object.prototype.hasOwnProperty.call(sync, k)) n += sync[k] || 0;
    }
    return n;
  }

  // Read the day's video total. A legacy h6 tick (no videos object) counts as 1.
  // Does not write anything.
  function videoParts(day) {
    if (day && day.videos && typeof day.videos === "object" && !Array.isArray(day.videos)) {
      var base = Number.isFinite(+day.videos.base) ? Math.trunc(+day.videos.base) : 0;
      var sync = {};
      var src = day.videos.sync && typeof day.videos.sync === "object" ? day.videos.sync : {};
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = Math.trunc(+src[k]);
        if (v) sync[k] = v;
      }
      return { base: base, sync: sync, total: Math.max(0, base + sumSync(sync)) };
    }
    if (day && day.checks && day.checks[VIDEO_HABIT]) {
      return { base: 1, sync: {}, total: 1 };
    }
    return { base: 0, sync: {}, total: 0 };
  }

  function videoCount(day) {
    return videoParts(day).total;
  }

  function sprintVideoTotal(data, dates) {
    var n = 0;
    var list = dates || [];
    for (var i = 0; i < list.length; i++) {
      var day = data && data.days ? data.days[list[i]] : undefined;
      n += videoCount(day);
    }
    return n;
  }

  function ensureDay(data, date) {
    if (!data.days || typeof data.days !== "object") data.days = {};
    if (!data.days[date]) data.days[date] = { checks: {}, chilled: false };
    if (!data.days[date].checks || typeof data.days[date].checks !== "object") data.days[date].checks = {};
    return data.days[date];
  }

  function writeVideos(day, parts) {
    var sync = {};
    for (var k in parts.sync) {
      if (Object.prototype.hasOwnProperty.call(parts.sync, k) && parts.sync[k]) sync[k] = parts.sync[k];
    }
    day.videos = { base: parts.base, sync: sync };
    if (!day.checks || typeof day.checks !== "object") day.checks = {};
    day.checks[VIDEO_HABIT] = Math.max(0, parts.base + sumSync(sync)) > 0;
  }

  function habitExists(data, habitId) {
    var list = data && data.habits;
    if (!Array.isArray(list)) return true;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === habitId) return true;
    return habitId === VIDEO_HABIT;
  }

  function addVideoDelta(data, eventId, date, delta) {
    if (!delta) return { op: "video", date: date, delta: 0, mutated: false };
    var day = ensureDay(data, date);
    var parts = videoParts(day);
    // The day remembers the event id, so a retry cannot add the same videos twice
    // even if the applied-id list was lost.
    if (parts.sync[eventId]) {
      return { op: "video", date: date, delta: parts.sync[eventId], mutated: false };
    }
    parts.sync[eventId] = delta;
    writeVideos(day, parts);
    return { op: "video", date: date, delta: delta, mutated: true };
  }

  function applyCheck(data, ev) {
    var habitId = typeof ev.habitId === "string" ? ev.habitId : "";
    if (!habitId || !isDate(ev.date)) return { op: "check", mutated: false };
    if (!habitExists(data, habitId)) return { op: "check", habitId: habitId, date: ev.date, mutated: false };
    if (habitId === VIDEO_HABIT) {
      var have = videoCount(data.days ? data.days[ev.date] : undefined);
      if (have >= 1) return { op: "video", date: ev.date, delta: 0, mutated: false, via: "check" };
      return addVideoDelta(data, ev.id, ev.date, 1);
    }
    var day = ensureDay(data, ev.date);
    if (day.checks[habitId]) {
      return { op: "check", habitId: habitId, date: ev.date, addedCheck: false, mutated: false };
    }
    day.checks[habitId] = true;
    return { op: "check", habitId: habitId, date: ev.date, addedCheck: true, mutated: true };
  }

  function applyVideo(data, ev) {
    if (!isDate(ev.date)) return { op: "video", mutated: false };
    var have = videoCount(data.days ? data.days[ev.date] : undefined);
    var delta = 0;
    if (ev.count != null && ev.count !== "") {
      var want = Math.trunc(+ev.count);
      if (!Number.isFinite(want) || want < 0) want = 0;
      delta = Math.max(0, want - have);
    } else if (ev.delta != null && ev.delta !== "") {
      delta = Math.trunc(+ev.delta);
      if (!Number.isFinite(delta) || delta < 0) delta = 0;
    }
    if (!delta) return { op: "video", date: ev.date, delta: 0, mutated: false };
    return addVideoDelta(data, ev.id, ev.date, delta);
  }

  function otherAddedCheck(state, effect, skipId) {
    var effects = state.effects || {};
    for (var id in effects) {
      if (!Object.prototype.hasOwnProperty.call(effects, id)) continue;
      if (id === skipId) continue;
      var ef = effects[id];
      if (ef && ef.op === "check" && ef.addedCheck && ef.habitId === effect.habitId && ef.date === effect.date) return true;
    }
    return false;
  }

  function applyUndo(data, ev, state) {
    var target = ev.undoId;
    if (!target || typeof target !== "string") return { op: "undo", mutated: false };
    var known = !!(state.applied && state.applied[target]);
    var effect = state.effects ? state.effects[target] : undefined;
    if (!known && !effect) return { op: "undo", defer: true, undoId: target };
    if (!effect) return { op: "undo", undoId: target, mutated: false };
    if (effect.op === "check" && effect.addedCheck && effect.habitId !== VIDEO_HABIT) {
      var day = data.days && data.days[effect.date];
      if (day && day.checks && day.checks[effect.habitId] && !otherAddedCheck(state, effect, target)) {
        day.checks[effect.habitId] = false;
        delete state.effects[target];
        return { op: "undo", undoId: target, mutated: true };
      }
      delete state.effects[target];
      return { op: "undo", undoId: target, mutated: false };
    }
    if ((effect.op === "video" || effect.habitId === VIDEO_HABIT) && effect.delta > 0 && isDate(effect.date)) {
      var vday = data.days && data.days[effect.date];
      if (vday && vday.videos && vday.videos.sync && vday.videos.sync[target]) {
        var parts = videoParts(vday);
        delete parts.sync[target];
        writeVideos(vday, parts);
        delete state.effects[target];
        return { op: "undo", undoId: target, mutated: true };
      }
      delete state.effects[target];
      return { op: "undo", undoId: target, mutated: false };
    }
    delete state.effects[target];
    return { op: "undo", undoId: target, mutated: false };
  }

  function applyOne(data, ev, state) {
    if (!ev || typeof ev !== "object") return { mutated: false };
    if (ev.op === "undo") return applyUndo(data, ev, state);
    if (ev.op === "check") return applyCheck(data, ev);
    if (ev.op === "video") return applyVideo(data, ev);
    return { mutated: false };
  }

  function freshState(syncState) {
    var src = syncState && typeof syncState === "object" ? syncState : {};
    return {
      applied: Object.assign({}, src.applied || {}),
      effects: clone(src.effects || {}),
      backedUp: !!src.backedUp,
      readToken: src.readToken,
      lastSync: src.lastSync || null,
      lastError: src.lastError || null
    };
  }

  // Additive, idempotent merge. Never deletes user data except by reversing
  // a contribution this same sync log added (undo). Does not mutate inputs.
  function mergeEvents(data, syncState, events) {
    var state = freshState(syncState);
    var list = Array.isArray(events) ? events : [];
    var indexed = list.map(function (ev, i) { return { ev: ev, i: i }; });
    indexed.sort(function (a, b) {
      var ta = a.ev && a.ev.ts ? String(a.ev.ts) : "";
      var tb = b.ev && b.ev.ts ? String(b.ev.ts) : "";
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return a.i - b.i;
    });
    var out = data;
    var changed = false;
    var appliedIds = [];
    for (var n = 0; n < indexed.length; n++) {
      var ev = indexed[n].ev;
      if (!ev || typeof ev.id !== "string" || !ev.id) continue;
      if (state.applied[ev.id]) continue;
      if (out === data) out = clone(data == null ? {} : data);
      var effect = applyOne(out, ev, state);
      if (effect && effect.defer) continue;
      state.applied[ev.id] = true;
      if (effect && effect.op) state.effects[ev.id] = effect;
      if (effect && effect.mutated) changed = true;
      appliedIds.push(ev.id);
    }
    var stateChanged = appliedIds.length > 0;
    return {
      data: changed ? out : data,
      syncState: stateChanged ? state : syncState,
      changed: changed,
      appliedIds: appliedIds
    };
  }

  // Phone +/- . Sync contributions stay in the ledger so a later undo
  // only removes what sync added. The visible total still moves by `delta`.
  function adjustManual(data, date, delta) {
    if (!isDate(date) || !delta) return data;
    var current = videoCount(data && data.days ? data.days[date] : undefined);
    var next = Math.max(0, current + Math.trunc(delta));
    if (next === current) return data;
    var out = clone(data == null ? {} : data);
    var day = ensureDay(out, date);
    var parts = videoParts(day);
    parts.base = next - sumSync(parts.sync);
    writeVideos(day, parts);
    return out;
  }

  function planSync(data, syncState, outcome) {
    if (!outcome || outcome.ok !== true) {
      return {
        data: data,
        syncState: syncState,
        changed: false,
        offline: true,
        appliedIds: [],
        backupFirst: false
      };
    }
    var merged = mergeEvents(data, syncState, outcome.events || []);
    return {
      data: merged.data,
      syncState: merged.syncState,
      changed: merged.changed,
      offline: false,
      appliedIds: merged.appliedIds,
      backupFirst: !!(merged.changed && !(syncState && syncState.backedUp))
    };
  }

  // Copy the raw storage string. Does not read-modify-write the source key.
  function copyBackup(storage, sourceKey, backupKey) {
    try {
      var raw = storage.getItem(sourceKey);
      var payload = raw == null ? "" : raw;
      storage.setItem(backupKey, payload);
      return storage.getItem(backupKey) === payload;
    } catch (e) {
      return false;
    }
  }

  return {
    VIDEO_HABIT: VIDEO_HABIT,
    VIDEO_GOAL: VIDEO_GOAL,
    videoCount: videoCount,
    videoParts: videoParts,
    sprintVideoTotal: sprintVideoTotal,
    mergeEvents: mergeEvents,
    adjustManual: adjustManual,
    planSync: planSync,
    copyBackup: copyBackup
  };
});
