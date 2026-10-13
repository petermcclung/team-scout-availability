# Team Scout availability

An independent record of whether Team Scout is up, written from outside Team Scout's own hosting.

## What is checked

Every minute the probe runs, it checks four things a club depends on:

| Check | What has to happen |
| --- | --- |
| Sign-in | The sign-in page at app.teamscout.co loads and shows "Sign in" |
| Registration form | A live public registration form loads with its organization's name |
| Organization site | An organization's public site loads with its name |
| Data service | The sign-in service reports healthy and a data read answers |

A check fails when the answer is not a normal page (HTTP 200), the expected words are missing, or nothing comes back within 10 seconds. A failed check is tried again 15 seconds later; only a second failure is recorded as down.

## How availability is counted

- A minute is **unavailable** when any of the four checks is down in that minute.
- **Availability** for a month = minutes up divided by minutes measured, rounded down to two decimals. Months are Central time.
- **Coverage** = minutes measured divided by minutes in the month since measuring began. GitHub starts the scheduled runs, and on a busy day it can start one late; minutes no run covered are counted as not measured, never as up.

## Where the record is

- `summary.json`: this month so far and last month.
- `data/YYYY/MM/YYYY-MM-DD.json`: one file per day (UTC). Each check has 1,440 characters, one per minute: `1` up, `0` down, `.` not measured. Every failure is listed with its time, the page and the answer received.

The probe runs on GitHub Actions, separate from Vercel and Supabase, where Team Scout runs. Every result is a commit in this repository, so the record cannot be edited after the fact without it showing.

Measuring began October 13, 2026.
