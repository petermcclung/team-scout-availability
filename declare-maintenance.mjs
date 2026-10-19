#!/usr/bin/env node
/**
 * Declare a planned maintenance window on the status page.
 *
 *   node declare-maintenance.mjs "2026-10-21T04:20:00-05:00" "2026-10-21T04:35:00-05:00" "Morning release, database update"
 *
 * Times must carry their offset (-05:00 is Central daylight time, -06:00 is
 * Central standard time). The window is added to data/maintenance.json with the
 * moment it was declared, committed and pushed to main, where the status page
 * shows it at once and the probe leaves its minutes out of availability.
 *
 * Policy (published on the page): planned maintenance is announced in advance
 * and is not counted as downtime. A window declared after it began is shown as
 * "declared after the fact", and the commit that added it shows when.
 *
 * --no-push writes and commits locally without pushing (for testing).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILE = join(ROOT, "data", "maintenance.json");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const noPush = process.argv.includes("--no-push");

function fail(msg) {
  console.error(msg);
  console.error('Usage: node declare-maintenance.mjs "2026-10-21T04:20:00-05:00" "2026-10-21T04:35:00-05:00" "Morning release, database update"');
  process.exit(1);
}

const [start, end, note] = args;
if (!start || !end || !note) fail("Needs a start, an end and a note.");
const hasOffset = (s) => /([+-]\d{2}:\d{2}|Z)$/.test(s);
if (!hasOffset(start) || !hasOffset(end)) fail("Give each time with its offset, for example 2026-10-21T04:20:00-05:00 (Central daylight time).");
const startMs = Date.parse(start);
const endMs = Date.parse(end);
if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) fail("A time could not be read.");
if (endMs <= startMs) fail("The end must come after the start.");
if (endMs - startMs > 6 * 3600_000) fail("A window longer than six hours is not planned maintenance; split it or think again.");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

if (!noPush) git("pull", "-q", "--rebase", "origin", "main");

const doc = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { windows: [] };
doc.windows ||= [];
const declaredAt = new Date().toISOString();
const w = {
  start: new Date(startMs).toISOString(),
  end: new Date(endMs).toISOString(),
  note: String(note).trim(),
  declaredAt,
  afterTheFact: Date.parse(declaredAt) > startMs,
};
if (doc.windows.some((x) => x.start === w.start && x.end === w.end)) fail("That window is already declared.");
doc.windows.push(w);
doc.windows.sort((a, b) => (a.start < b.start ? -1 : 1));
mkdirSync(dirname(FILE), { recursive: true });
writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const label = `${fmt.format(new Date(startMs))} to ${fmt.format(new Date(endMs))} Central`;
git("add", "data/maintenance.json");
git("commit", "-q", "-m", `maintenance: ${label}: ${w.note}${w.afterTheFact ? " (declared after the fact)" : ""}`);
if (!noPush) {
  let pushed = false;
  for (let i = 0; i < 6 && !pushed; i++) {
    try {
      git("push", "-q", "origin", "HEAD:main");
      pushed = true;
    } catch {
      git("pull", "-q", "--rebase", "origin", "main");
    }
  }
  if (!pushed) fail("Could not push; the window is committed locally. Run git push from this folder.");
}
console.log(`Declared: ${label}, "${w.note}"${w.afterTheFact ? " (declared after the fact)" : ""}.${noPush ? " Not pushed." : " Live on status.teamscout.co within a minute."}`);
