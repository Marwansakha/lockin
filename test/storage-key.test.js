import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the habit storage key stays lockin-14d-v1 and sync uses other keys", () => {
  assert.match(html, /const SK="lockin-14d-v1"/);
  assert.match(html, /const SK_BACKUP="lockin-14d-v1-presync-backup"/);
  assert.match(html, /const SYNC_STATE_KEY="lockin-sync-v1"/);
  assert.equal(html.includes("localStorage.clear"), false);
  assert.equal(html.includes("localStorage.removeItem"), false);
  assert.match(html, /localStorage\.setItem\(SK,/);
  assert.match(html, /src="sync-merge\.js"/);
});
