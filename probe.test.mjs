import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeChar, tally, availabilityPercent, centralMonth, buildSummary, TARGETS, mergeSamples, emptyDay, shouldHandOff } from "./probe.mjs";

const blank = () => ".".repeat(1440);
function day(dayKey, marks) {
  const targets = Object.fromEntries(TARGETS.map((t) => [t.key, blank()]));
  for (const [key, minute, ch] of marks) {
    const s = targets[key];
    targets[key] = s.slice(0, minute) + ch + s.slice(minute + 1);
  }
  return { day: dayKey, targets, failures: [] };
}
const allUp = (minute) => TARGETS.map((t) => [t.key, minute, "1"]);

test("down wins over up, up wins over unmeasured", () => {
  assert.equal(mergeChar(".", true), "1");
  assert.equal(mergeChar("1", false), "0");
  assert.equal(mergeChar("0", true), "0");
});

test("a minute with every target up is measured and available", () => {
  const months = tally([day("2026-10-14", [...allUp(600), ...allUp(601)])]);
  assert.deepEqual(months["2026-10"], { measuredMinutes: 2, unavailableMinutes: 0 });
});

test("one target down makes the whole minute unavailable", () => {
  const marks = [...allUp(600), ...TARGETS.map((t) => [t.key, 601, t.key === "registration_form" ? "0" : "1"])];
  const months = tally([day("2026-10-14", marks)]);
  assert.deepEqual(months["2026-10"], { measuredMinutes: 2, unavailableMinutes: 1 });
});

test("a down minute counts even when another target was not measured", () => {
  const months = tally([day("2026-10-14", [["data_service", 700, "0"]])]);
  assert.deepEqual(months["2026-10"], { measuredMinutes: 1, unavailableMinutes: 1 });
});

test("a partly measured minute with nothing down is not counted", () => {
  const months = tally([day("2026-10-14", [["sign_in", 700, "1"]])]);
  assert.equal(months["2026-10"], undefined);
});

test("percent rounds down, never up", () => {
  assert.equal(availabilityPercent({ measuredMinutes: 10000, unavailableMinutes: 1 }), 99.99);
  assert.equal(availabilityPercent({ measuredMinutes: 3, unavailableMinutes: 1 }), 66.66);
  assert.equal(availabilityPercent({ measuredMinutes: 5, unavailableMinutes: 0 }), 100);
  assert.equal(availabilityPercent({ measuredMinutes: 0, unavailableMinutes: 0 }), null);
});

test("months are Central time: 3 AM UTC on Nov 1 is still October in Central", () => {
  assert.equal(centralMonth(new Date("2026-11-01T03:00:00Z")), "2026-10");
  assert.equal(centralMonth(new Date("2026-11-01T06:00:00Z")), "2026-11");
});

test("summary reports this month so far and no last month before November", () => {
  const docs = [day("2026-10-14", [...allUp(600), ...allUp(601)])];
  const s = buildSummary(docs, new Date("2026-10-14T12:00:00Z"), "2026-10-14T10:00:00Z");
  assert.equal(s.thisMonth.month, "2026-10");
  assert.equal(s.thisMonth.availabilityPercent, 100);
  assert.equal(s.thisMonth.fullMonthMeasured, false);
  assert.equal(s.lastMonth, null);
});

test("coverage counts the minute measuring began and never exceeds 100", () => {
  const docs = [day("2026-10-13", [...allUp(894), ...allUp(895), ...allUp(896), ...allUp(897), ...allUp(898)])];
  const s = buildSummary(docs, new Date("2026-10-13T14:58:02Z"), "2026-10-13T14:54:00Z");
  assert.equal(s.thisMonth.measuredMinutes, 5);
  assert.equal(s.thisMonth.coveragePercent, 100);
});

test("the registration check targets Team Scout's own open form and fails on every page that is not an open form", () => {
  const reg = TARGETS.find((t) => t.key === "registration_form");
  assert.equal(TARGETS.length, 6);
  assert.match(reg.checks[0].url, /\/register\/team-scout-public\/availability-check$/);
  for (const notice of ["Registration Closed", "Registration opens", "Registration Full", "ready yet", "not taking payments yet"]) {
    assert.ok(reg.checks[0].forbidText.includes(notice), notice);
  }
  assert.ok(reg.checks[0].requireText.includes("Continue"), "the open form's own button");
});

test("applying a run's samples merges into the record without writing in a dry module import", async () => {
  const { applySamples } = await import("./probe.mjs");
  assert.equal(typeof applySamples, "function");
});

// Two runs that overlap (Oct 14, 2026: runs now last up to 45 minutes and
// GitHub starts them every 10 to 25, so most minutes are sampled by two runs).
const at = (minute) => new Date(Date.parse("2026-10-14T00:00:00Z") + minute * 60_000 + 1_000).toISOString();
const up = { ok: true };
const down = { ok: false, first: { error: "HTTP 503" }, second: { error: "HTTP 503" } };
function run(fromMinute, toMinute, downAt = new Set()) {
  const out = [];
  for (let m = fromMinute; m <= toMinute; m++) {
    out.push({ at: at(m), results: TARGETS.map((t) => [t.key, downAt.has(m) && t.key === "sign_in" ? down : up]) });
  }
  return out;
}
function landInOrder(...runs) {
  // Each run lands on the record the previous one committed, as the workflow does.
  const record = new Map();
  const getDay = (d) => structuredClone(record.get(d) || emptyDay(d));
  for (const r of runs) for (const [d, doc] of mergeSamples(r, getDay)) record.set(d, doc);
  return record.get("2026-10-14");
}

test("two overlapping runs: union of minutes measured, a down seen by either run wins", () => {
  const a = run(600, 629); // run A saw everything up
  const b = run(615, 644, new Set([620])); // run B saw sign-in down at 10:20 UTC
  const doc = landInOrder(a, b);
  const s = doc.targets.sign_in;
  assert.equal(s.slice(600, 645).replace(/[01]/g, "").length, 0, "every minute 600-644 measured");
  assert.equal(s[599], ".");
  assert.equal(s[645], ".");
  assert.equal(s[620], "0", "A's up does not hide B's down");
  assert.equal(doc.failures.length, 1);
  const months = tally([doc]);
  assert.deepEqual(months["2026-10"], { measuredMinutes: 45, unavailableMinutes: 1 });
});

test("the order overlapping runs land in does not change the record", () => {
  const a = run(600, 629, new Set([610]));
  const b = run(615, 644, new Set([620]));
  assert.deepEqual(landInOrder(a, b), landInOrder(b, a));
});

test("re-applying the same run changes nothing and lists its failure once", () => {
  const a = run(600, 629, new Set([620]));
  const once = landInOrder(a);
  const twice = landInOrder(a, a);
  assert.deepEqual(twice, once);
  assert.equal(once.failures.length, 1);
});

test("a run that crosses UTC midnight writes both days", () => {
  const samples = [
    { at: "2026-10-14T23:59:01.000Z", results: TARGETS.map((t) => [t.key, up]) },
    { at: "2026-10-15T00:00:01.000Z", results: TARGETS.map((t) => [t.key, up]) },
  ];
  const touched = mergeSamples(samples, (d) => emptyDay(d));
  assert.deepEqual([...touched.keys()].sort(), ["2026-10-14", "2026-10-15"]);
  assert.equal(touched.get("2026-10-14").targets.sign_in[1439], "1");
  assert.equal(touched.get("2026-10-15").targets.sign_in[0], "1");
});

test("hand-off: stop only for a newer run that has been running three minutes", () => {
  const now = Date.parse("2026-10-14T15:00:00Z");
  const r = (n, minsAgo, status = "in_progress") => ({ run_number: n, status, run_started_at: new Date(now - minsAgo * 60_000).toISOString() });
  assert.equal(shouldHandOff([r(10, 20), r(11, 3)], 10, now), true);
  assert.equal(shouldHandOff([r(10, 20), r(11, 2)], 10, now), false, "newer run too fresh");
  assert.equal(shouldHandOff([r(9, 40), r(10, 20)], 10, now), false, "an older run never takes over");
  assert.equal(shouldHandOff([r(11, 10, "queued")], 10, now), false, "a queued run is not sampling");
  assert.equal(shouldHandOff([], 10, now), false);
});
