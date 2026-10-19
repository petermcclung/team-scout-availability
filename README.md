# Team Scout availability

An independent record of whether Team Scout is up, written from outside Team Scout's own hosting.

The status page: https://petermcclung.github.io/team-scout-availability/ (this repository's `index.html`, served by GitHub Pages from `main`; it reads `summary.json` and this month's daily files when it loads, so it shows the record as committed, with no build step).

## What is checked

Once a minute, the probe checks six things a club depends on, across the web app, the admin workspace and the mobile app's services.

GitHub starts the runs. The schedule asks for one every five minutes; in practice GitHub starts one every 10 to 25 minutes, and up to 50 minutes apart at its busiest hour. So each run samples the start of every minute for up to 45 minutes, and stops early once a newer run has been sampling for three minutes. Runs overlap a little instead of leaving gaps, and usually only one or two run at a time. A minute two runs both sampled is down if either saw it down.

| Check | What has to happen |
| --- | --- |
| Sign-in | The sign-in page at app.teamscout.co loads and shows "Sign in" |
| Admin workspace | An admin workspace address is served: a signed-out visit is sent to sign-in with the address kept |
| Registration form | Team Scout's own always-open registration form loads open: its title and its Continue button show, and none of the notices a page shows instead of a form (closed, not open yet, full, not ready, not taking payments) appear. A club's form closing never reads as an outage |
| Organization site | An organization's public site loads with its name |
| App services | The web app's server functions that the mobile app calls answer (a call without sign-in is refused by the function itself) |
| Data service | The data service the web and mobile apps share: the sign-in service reports healthy and a data read answers |

A check fails when the answer is not a normal page (HTTP 200), the expected words are missing or words it must not show appear, or nothing comes back within 10 seconds. A failed check is tried again 15 seconds later; only a second failure is recorded as down.

## How availability is counted

- A minute is **unavailable** when any of the six checks is down in that minute.
- **Availability** for a month = minutes up divided by minutes measured, rounded down to two decimals, leaving out minutes inside declared planned maintenance. Months are Central time.
- **Coverage** = minutes measured divided by minutes in the month since measuring began. GitHub starts the scheduled runs, and on a busy day it can start one late; minutes no run covered are counted as not measured, never as up.

## How a day is shown

The page colours each day (and each check's own row) the way GitHub's and Anthropic's status pages do, from the record alone:

- **Major outage (red):** five or more minutes down in a row, or 30 or more in a day, when more than one check failed, or when the sign-in page or the data service failed on its own. On a check's own row, five in a row or 30 in a day.
- **Partial outage (amber):** any other down minute: one to four minutes, or a single check failing while the others answered.
- **Planned maintenance (blue):** a day with a declared window and no unplanned downtime.
- **No downtime (green)**, **not measured (grey)**, the monitor's first days (hatched).

Down minutes within five minutes of each other are one incident. Each incident is listed with its time, length, the checks that failed and, when one has been written, a plain-words note from `data/incidents.json` (matched by its first down minute, UTC). The raw failures stay listed underneath.

## Planned maintenance

Policy, published on the page: planned maintenance is announced there in advance and is not counted as downtime. Everything else counts, including minutes where only the monitor could not reach the site.

Declare a window before a release train (times with their offset; -05:00 is Central daylight time, -06:00 Central standard time):

```
node declare-maintenance.mjs "2026-10-21T04:20:00-05:00" "2026-10-21T04:35:00-05:00" "Morning release, database update"
```

It adds the window to `data/maintenance.json` with the moment it was declared, commits and pushes to `main`; the page shows it at once and the probe leaves the window's minutes out of availability (they still count as measured). A window declared after it began is shown "declared after the fact", and the commit shows when. Only declare a window for planned work; an unplanned failure stays an incident.

## Where the record is

- `index.html`: the status page. It shows only what the record shows: the one-sentence answer, this month's availability, incidents and planned maintenance, a bar per day for all of Team Scout and for each check, the incidents list, every recorded failure with its time in Central, and the share of minutes measured as a footnote.
- `summary.json`: this month so far and last month (`maintenanceMinutes` are measured minutes inside declared windows).
- `data/maintenance.json`: declared planned maintenance windows.
- `data/incidents.json`: plain-words notes for incidents.
- `data/YYYY/MM/YYYY-MM-DD.json`: one file per day (UTC). Each check has 1,440 characters, one per minute: `1` up, `0` down, `.` not measured. Every failure is listed with its time, the page and the answer received.

The probe runs on GitHub Actions, separate from Vercel and Supabase, where Team Scout runs. Every result is a commit in this repository, so the record cannot be edited after the fact without it showing.

## What it costs

Nothing. GitHub's billing page: "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners." This repository is public and the probe runs on `ubuntu-latest`, a standard runner. Larger runners are charged even on public repositories, so the probe never uses one.

## History

- Measuring began October 13, 2026.
- Until October 14, 2026, 9:40 AM Central, the registration check proved the registration page loaded with the form's title, not that the form itself showed: on October 13 it read a club form that had closed, then Team Scout's own form, which had no pages yet and showed "This form isn't ready yet". The form now has its pages and the check requires the open form. Those earlier minutes still show the registration page was served.
- Until October 14, 2026, runs sampled five minutes each, so about 30 percent of minutes were measured. Runs now sample up to 45 minutes each.
