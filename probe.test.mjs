import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeChar, tally, availabilityPercent, centralMonth, buildSummary, TARGETS } from "./probe.mjs";

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
