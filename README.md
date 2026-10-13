# Team Scout availability

An independent record of whether Team Scout is up, written from outside Team Scout's own hosting.

## What is checked

Every five minutes (GitHub's schedule, often later), the probe checks six things a club depends on, across the web app, the admin workspace and the mobile app's services. Each run samples the start of five consecutive minutes.

| Check | What has to happen |
| --- | --- |
| Sign-in | The sign-in page at app.teamscout.co loads and shows "Sign in" |
| Admin workspace | An admin workspace address is served: a signed-out visit is sent to sign-in with the address kept |
| Registration form | Team Scout's own always-open registration form loads open (its title shows, "Registration Closed" does not), so a club's form closing never reads as an outage |
| Organization site | An organization's public site loads with its name |
| App services | The web app's server functions that the mobile app calls answer (a call without sign-in is refused by the function itself) |
| Data service | The data service the web and mobile apps share: the sign-in service reports healthy and a data read answers |

A check fails when the answer is not a normal page (HTTP 200), the expected words are missing or words it must not show appear, or nothing comes back within 10 seconds. A failed check is tried again 15 seconds later; only a second failure is recorded as down.

## How availability is counted

- A minute is **unavailable** when any of the six checks is down in that minute.
- **Availability** for a month = minutes up divided by minutes measured, rounded down to two decimals. Months are Central time.
- **Coverage** = minutes measured divided by minutes in the month since measuring began. GitHub starts the scheduled runs, and on a busy day it can start one late; minutes no run covered are counted as not measured, never as up.

## Where the record is

- `summary.json`: this month so far and last month.
- `data/YYYY/MM/YYYY-MM-DD.json`: one file per day (UTC). Each check has 1,440 characters, one per minute: `1` up, `0` down, `.` not measured. Every failure is listed with its time, the page and the answer received.

The probe runs on GitHub Actions, separate from Vercel and Supabase, where Team Scout runs. Every result is a commit in this repository, so the record cannot be edited after the fact without it showing.

Measuring began October 13, 2026.
