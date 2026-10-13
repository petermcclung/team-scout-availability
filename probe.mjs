#!/usr/bin/env node
/**
 * Team Scout availability probe.
 *
 * Runs on GitHub's computers, outside Team Scout's own hosting (Vercel for the
 * web pages, Supabase for the data service), so an outage on our side cannot
 * stop the record being written. GitHub starts a run every five minutes (its
 * schedule, often later); each run takes a sample at the start of each of the
 * next five minutes.
 *
 * A sample checks six things a club uses:
 *   sign_in            the sign-in page renders
 *   admin_workspace    an admin workspace address is served (sent to sign-in, address kept)
 *   registration_form  a public registration form renders open (Team Scout's own
 *                      always-open "availability check" form, so a customer's
 *                      form closing or being archived never reads as an outage)
 *   org_site           an organization's public site renders
 *   app_api            the web app's server functions the mobile app calls answer
 *   data_service       the data service the web and mobile apps share answers
 *                      (sign-in service health + a data read)
 *
 * A check fails when the answer is not HTTP 200, the page is missing its
 * expected text (or shows text it must not, such as "Registration Closed"),
 * or nothing comes back within 10 seconds. A failed check is
 * retried once after 15 seconds; only a failed retry is recorded as down.
 * A minute is "unavailable" when any of the six is down in that minute.
 *
 * Storage: data/YYYY/MM/YYYY-MM-DD.json per UTC day. Each target has a
 * 1,440-character string, one character per UTC minute:
 *   "." not measured, "1" up, "0" down.
 * summary.json is recomputed on every run (months are Central time).
 *
 * Env: SAMPLES (default 5), DRY_RUN=1 (print, write nothing).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SAMPLES = Number(process.env.SAMPLES || 5);
const DRY_RUN = process.env.DRY_RUN === "1";
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 15_000;
const ZONE = "America/Chicago";
export const MEASURED_SINCE = "2026-10-13";

const SUPABASE_URL = "https://eashcsdppfavsxpzyqkf.supabase.co";
// The public client key: it ships inside every copy of the app and only allows
// what row-level security allows a signed-out visitor.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhc2hjc2RwcGZhdnN4cHp5cWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0OTE4NjIsImV4cCI6MjA3OTA2Nzg2Mn0.CF-MJQagtHBkQuI96BvGEPOio5ixNfj2IS7J_vwBXJM";

export const TARGETS = [
  {
    key: "sign_in",
    checks: [{ url: "https://app.teamscout.co/login", requireText: "Sign in" }],
  },
  {
    key: "registration_form",
    checks: [
      {
        // Team Scout's own form (org team-scout-public, created Oct 13 2026):
        // open, unlisted, no closing date, nobody notified on a submission.
        // Until Oct 13 this checked Christ Prep's fall form, which closed Oct 5;
        // the closed page still answered 200, so the check proved nothing about
        // an open form, and archiving it would have read as an outage.
        url: "https://app.teamscout.co/register/team-scout-public/availability-check",
        requireText: "Team Scout availability check",
        forbidText: "Registration Closed",
      },
    ],
  },
  {
    key: "org_site",
    checks: [
      { url: "https://app.teamscout.co/o/christprepfootball", requireText: "Christ Prep Academy Football" },
    ],
  },
  {
    // The admin workspace: a signed-out visit must be sent to sign-in with the
    // workspace address kept, and the sign-in page must render.
    key: "admin_workspace",
    checks: [
      {
        url: "https://app.teamscout.co/christprepfootball/hub",
        requireText: "Sign in",
        requireFinalUrlIncludes: "redirect=%2Fchristprepfootball%2Fhub",
      },
    ],
  },
  {
    // The web app's server functions the mobile app calls: a call with no
    // sign-in must be answered (refused with 401) by the function itself.
    key: "app_api",
    checks: [
      {
        url: "https://app.teamscout.co/api/checkout/identity-token",
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
        expectStatus: 401,
        json: true,
        requireText: "Missing bearer token",
      },
    ],
  },
  {
    key: "data_service",
    checks: [
      { url: `${SUPABASE_URL}/auth/v1/health`, headers: { apikey: ANON_KEY }, json: true },
      {
        url: `${SUPABASE_URL}/rest/v1/organizations?select=id&limit=1`,
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        json: true,
      },
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(check) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(check.url, {
      signal: controller.signal,
      redirect: "follow",
      method: check.method || "GET",
      body: check.body,
      headers: { "user-agent": "TeamScoutAvailabilityProbe/1.0 (+github.com/petermcclung/team-scout-availability)", ...(check.headers || {}) },
    });
    const body = await res.text();
    const ms = Date.now() - started;
    if (res.status !== (check.expectStatus || 200)) return { ok: false, status: res.status, ms, error: `HTTP ${res.status}` };
    if (check.requireFinalUrlIncludes && !res.url.includes(check.requireFinalUrlIncludes)) {
      return { ok: false, status: res.status, ms, error: `ended at ${res.url}` };
    }
    if (check.json) {
      try {
        JSON.parse(body);
      } catch {
        return { ok: false, status: res.status, ms, error: "not JSON (gateway error page)" };
      }
    }
    if (check.requireText && !body.includes(check.requireText)) {
      return { ok: false, status: res.status, ms, error: `missing text "${check.requireText}"` };
    }
    if (check.forbidText && body.includes(check.forbidText)) {
      return { ok: false, status: res.status, ms, error: `shows "${check.forbidText}"` };
    }
    return { ok: true, status: res.status, ms };
  } catch (e) {
    const ms = Date.now() - started;
    return { ok: false, status: null, ms, error: e?.name === "AbortError" ? `no answer in ${TIMEOUT_MS / 1000}s` : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkTarget(target) {
  const run = async () => {
    for (const c of target.checks) {
      const r = await fetchOnce(c);
      if (!r.ok) return { ...r, url: c.url };
    }
    return { ok: true };
  };
  const first = await run();
  if (first.ok) return { ok: true };
  await sleep(RETRY_DELAY_MS);
  const second = await run();
  if (second.ok) return { ok: true, blip: first };
  return { ok: false, first, second };
}

/** UTC day key and minute-of-day for an instant. */
export function utcSlot(date) {
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

function dayPath(day) {
  const [y, m] = day.split("-");
  return join(ROOT, "data", y, m, `${day}.json`);
}

function emptyDay(day) {
  const blank = ".".repeat(1440);
  return { day, timezone: "UTC", targets: Object.fromEntries(TARGETS.map((t) => [t.key, blank])), failures: [] };
}

function loadDay(day) {
  const p = dayPath(day);
  if (!existsSync(p)) return emptyDay(day);
  const d = JSON.parse(readFileSync(p, "utf8"));
  for (const t of TARGETS) if (!d.targets[t.key]) d.targets[t.key] = ".".repeat(1440);
  return d;
}

/** Merge one result into a minute: down wins over up, up wins over unmeasured. */
export function mergeChar(prev, ok) {
  if (prev === "0" || !ok) return "0";
  return "1";
}

function setMinute(dayDoc, key, minute, ok) {
  const s = dayDoc.targets[key];
  dayDoc.targets[key] = s.slice(0, minute) + mergeChar(s[minute], ok) + s.slice(minute + 1);
}

/** Central-time month key ("2026-10") for a UTC instant. */
const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit" });
export function centralMonth(date) {
  const parts = monthFmt.formatToParts(date);
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}

/**
 * Tally a set of day documents into per-Central-month totals.
 * A minute counts as measured when every target was measured in it, and as
 * unavailable when any target was down in it (a minute where some targets were
 * measured and one was down still counts as unavailable).
 */
export function tally(dayDocs) {
  const months = {};
  for (const doc of dayDocs) {
    const base = Date.parse(`${doc.day}T00:00:00Z`);
    for (let m = 0; m < 1440; m++) {
      let anyDown = false;
      let allMeasured = true;
      for (const t of TARGETS) {
        const c = doc.targets[t.key]?.[m] ?? ".";
        if (c === "0") anyDown = true;
        if (c === ".") allMeasured = false;
      }
      if (!anyDown && !allMeasured) continue;
      // Hourly cache would be faster; 60 days x 1,440 minutes is small enough.
      const key = centralMonth(new Date(base + m * 60_000));
      const row = (months[key] ||= { measuredMinutes: 0, unavailableMinutes: 0 });
      row.measuredMinutes += 1;
      if (anyDown) row.unavailableMinutes += 1;
    }
  }
  return months;
}

/** Percent up, rounded DOWN to two decimals so we never round in our favour. */
export function availabilityPercent(row) {
  if (!row || row.measuredMinutes === 0) return null;
  const up = row.measuredMinutes - row.unavailableMinutes;
  return Math.floor((up / row.measuredMinutes) * 10000) / 100;
}

function minutesInCentralMonthSoFar(monthKey, now, sinceIso) {
  const [y, m] = monthKey.split("-").map(Number);
  // Central month start/end as instants: find by scanning hours around the UTC boundary.
  const startGuess = Date.UTC(y, m - 1, 1, 0, 0);
  let start = startGuess - 12 * 3600_000;
  while (centralMonth(new Date(start)) !== monthKey) start += 60_000;
  const nextGuess = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0);
  let end = nextGuess - 12 * 3600_000;
  while (centralMonth(new Date(end)) === monthKey) end += 60_000;
  const since = Math.floor(Date.parse(sinceIso) / 60_000) * 60_000;
  const from = Math.max(start, since);
  const to = Math.min(end, now.getTime());
  // Minutes touched by the window, counting the minute measuring began.
  return { windowMinutes: Math.max(0, Math.ceil((to - from) / 60_000)), fullMonth: since <= start && now.getTime() >= end };
}

export function buildSummary(dayDocs, now, firstSampleIso) {
  const months = tally(dayDocs);
  const thisKey = centralMonth(now);
  const lastDate = new Date(now.getTime());
  // Step back into the previous Central month.
  while (centralMonth(lastDate) === thisKey) lastDate.setTime(lastDate.getTime() - 6 * 3600_000);
  const lastKey = centralMonth(lastDate);
  const describe = (key) => {
    const row = months[key];
    if (!row) return null;
    const w = minutesInCentralMonthSoFar(key, now, firstSampleIso);
    return {
      month: key,
      fullMonthMeasured: w.fullMonth,
      measuredMinutes: row.measuredMinutes,
      unavailableMinutes: row.unavailableMinutes,
      availabilityPercent: availabilityPercent(row),
      coveragePercent: w.windowMinutes ? Math.min(100, Math.floor((row.measuredMinutes / w.windowMinutes) * 1000) / 10) : null,
    };
  };
  return {
    measuredSince: MEASURED_SINCE,
    firstSampleAt: firstSampleIso,
    generatedAt: now.toISOString(),
    definition:
      "A minute is unavailable when the sign-in page, the admin workspace, a public registration form, an organization's public site, the app's server functions or the data service fails twice, 15 seconds apart, within that minute. Availability = minutes up / minutes measured. Months are Central time.",
    thisMonth: describe(thisKey),
    lastMonth: describe(lastKey),
  };
}

function recentDayDocs(now, days = 70) {
  const docs = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10);
    if (existsSync(dayPath(d))) docs.push(loadDay(d));
  }
  return docs;
}

function firstSampleIso() {
  const dataDir = join(ROOT, "data");
  if (!existsSync(dataDir)) return null;
  const years = readdirSync(dataDir).filter((n) => /^\d{4}$/.test(n)).sort();
  for (const y of years) {
    const monthsDirs = readdirSync(join(dataDir, y)).filter((n) => /^\d{2}$/.test(n)).sort();
    for (const m of monthsDirs) {
      const files = readdirSync(join(dataDir, y, m)).filter((n) => n.endsWith(".json")).sort();
      for (const f of files) {
        const doc = JSON.parse(readFileSync(join(dataDir, y, m, f), "utf8"));
        let first = 1440;
        for (const t of TARGETS) {
          const s = doc.targets[t.key] || "";
          const i = s.search(/[01]/);
          if (i >= 0 && i < first) first = i;
        }
        if (first < 1440) return new Date(Date.parse(`${doc.day}T00:00:00Z`) + first * 60_000).toISOString();
      }
    }
  }
  return null;
}

async function main() {
  const touched = new Map();
  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) {
      const now = Date.now();
      await sleep(60_000 - (now % 60_000) + 1_000); // one second into the next minute
    }
    const at = new Date();
    const results = await Promise.all(TARGETS.map(async (t) => [t.key, await checkTarget(t)]));
    const { day, minute } = utcSlot(at);
    const doc = touched.get(day) || loadDay(day);
    for (const [key, r] of results) {
      setMinute(doc, key, minute, r.ok);
      if (!r.ok) doc.failures.push({ at: at.toISOString(), target: key, first: r.first, second: r.second });
    }
    touched.set(day, doc);
    const line = results.map(([k, r]) => `${k}=${r.ok ? (r.blip ? "up(after retry)" : "up") : "DOWN"}`).join(" ");
    console.log(`${at.toISOString()} ${line}`);
  }
  if (DRY_RUN) {
    console.log("DRY_RUN: nothing written");
    return;
  }
  for (const [day, doc] of touched) {
    mkdirSync(dirname(dayPath(day)), { recursive: true });
    writeFileSync(dayPath(day), JSON.stringify(doc, null, 1) + "\n");
  }
  const now = new Date();
  const summary = buildSummary(recentDayDocs(now), now, firstSampleIso() || now.toISOString());
  writeFileSync(join(ROOT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
