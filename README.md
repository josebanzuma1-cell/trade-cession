# Session Clock

A forex session clock built for a trader sitting in Kampala, with graded entry
windows for majors, gold and indices. It runs on Vercel's free Hobby plan and
pushes alerts to Telegram before and as each session opens.

Every time in the interface is East Africa Time. Every time in the *engine* is
anchored to the market that causes it, so the app follows London and New York
through daylight saving on its own.

---

## Why it is built this way

**Kampala never changes its clock. London and New York do.** Sydney changes in
the opposite direction, because it is in the southern hemisphere. That means a
session clock which hardcodes "London opens at 10:00 EAT" is wrong for about
half the year, and wrong by a full hour for a couple of weeks in March and
October when London and New York switch on different dates.

So sessions are defined in each market's own local time and converted through
the IANA timezone database at runtime. `npm run verify` checks this against
known DST transitions in both hemispheres.

**Vercel's free plan only allows a cron job to run once per day.** That is
useless for four session opens daily, so the scheduling is done by a free
external cron service that pings an endpoint on your app. Setup is below.

---

## Deploying

### 1. Push to GitHub and import to Vercel

```bash
git remote add origin https://github.com/josebanzuma1-cell/trade-cession.git
git push -u origin main
```

Then at [vercel.com/new](https://vercel.com/new), import the repository. Next.js
is detected automatically — accept the defaults and deploy.

The dashboard works immediately. Alerts need the next two steps.

### 2. Create the Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, pick any name, then a username ending in `bot`.
3. Copy the token it gives you (looks like `8123456789:AAH...`).
4. **Open your new bot and send it any message** — a bot cannot message you
   until you have messaged it first.

Now in Vercel go to **Settings → Environment Variables** and add:

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `CRON_SECRET` | any long random string you invent |

Redeploy, then visit:

```
https://<your-app>.vercel.app/api/telegram?key=<your CRON_SECRET>
```

It reports the chat ID of anyone who has messaged the bot. Add that as a third
environment variable, `TELEGRAM_CHAT_ID`, and redeploy once more.

Test it:

```
https://<your-app>.vercel.app/api/cron?key=<your CRON_SECRET>&test=1
```

A confirmation message should land in Telegram.

### 3. Point a free cron service at it

Sign up at [cron-job.org](https://cron-job.org) (free, no card) and create a job:

- **URL** — `https://<your-app>.vercel.app/api/cron?key=<your CRON_SECRET>`
- **Schedule** — as often as the free tier allows, up to every 5 minutes
- **Method** — GET

**`CRON_INTERVAL_MINUTES` must match the interval the job actually runs at.**
The endpoint claims each alert to a bucket exactly that many minutes wide, so
consecutive polls tile without overlapping or leaving a gap. Set it too low and
the app looks less far ahead than the gap between polls, which opens a blind
spot — alerts in it are never sent, and nothing anywhere looks broken.

Free tiers often impose a longer minimum than they appear to. Verify what you
actually got rather than what you selected: watch the deployment's runtime logs
for two consecutive hits and measure the spacing. This deployment runs on a
**15-minute** interval for that reason.

Longer intervals work fine — a week-long simulation at 15 minutes sends every
alert exactly once — the heads-up simply arrives between `ALERT_LEAD_MINUTES`
and one interval earlier than that. The message states the true figure rather
than assuming the configured lead.

A GitHub Actions workflow is included at `.github/workflows/notify.yml` as a
backup. GitHub's cron is free but queues under load and can run several minutes
late, so treat it as a second pair of eyes rather than the primary trigger. To
use it, add `CRON_URL` and `CRON_SECRET` as repository secrets.

---

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | — | From @BotFather. |
| `TELEGRAM_CHAT_ID` | yes | — | Comma-separate several to alert a group. |
| `CRON_SECRET` | strongly advised | — | Without it, `/api/cron` is open to anyone. |
| `CRON_INTERVAL_MINUTES` | **yes** | `5` | Must match the interval your cron actually runs at. |
| `ALERT_LEAD_MINUTES` | no | `15` | Heads-up time before each open. |
| `UPSTASH_REDIS_REST_URL` | no | — | Only if you ever see duplicate alerts. |
| `UPSTASH_REDIS_REST_TOKEN` | no | — | Pairs with the above. |

Each session open sends two messages: a heads-up at `ALERT_LEAD_MINUTES`, and
one as it opens. That is deliberate redundancy — if a late cron run loses one,
the other still reaches you. If your scheduler is erratic enough to send
duplicates, add the two Upstash variables (free tier) and each alert gets
claimed atomically before sending.

---

## Your day, in EAT

Because Uganda sits at UTC+3, the best part of the trading day lands in your
late afternoon and evening. This is convenient — the highest-quality window
does not require you to be awake at 3am.

**Northern summer** (late March to late October):

| Session | EAT |
| --- | --- |
| Sydney | 01:00 – 10:00 |
| Tokyo | 03:00 – 12:00 |
| London | 10:00 – 19:00 |
| New York | 15:00 – 00:00 |
| **London + NY overlap** | **15:00 – 19:00** |

**Northern winter** (early November to mid March):

| Session | EAT |
| --- | --- |
| Sydney | 00:00 – 09:00 |
| Tokyo | 03:00 – 12:00 |
| London | 11:00 – 20:00 |
| New York | 16:00 – 01:00 |
| **London + NY overlap** | **16:00 – 20:00** |

For a few weeks each March and October the two hemispheres are mid-switch and
neither table is exactly right. The app is, because it computes rather than
assumes — trust the screen over these tables.

---

## When to actually enter

The app grades seven windows and explains each one. The short version:

**A+ — Peak Overlap.** The first three hours of New York while London is still
open (15:00–18:00 EAT in summer). Deepest liquidity, tightest spreads, widest
range. If you only trade one window a day, trade this one.

**A — London Open Killzone.** 09:00–12:00 EAT in summer. The Asian range gets
swept, the breakout crowd gets trapped, and then the real direction shows.
Wait for the sweep and the reclaim; do not chase the first move.

**A — Wall Street Cash Open.** 16:30–17:30 EAT in summer. The index window for
US30 and NAS100. Let the first fifteen minutes build an opening range, then
trade its break.

**B — US Data Release.** 15:30 EAT in summer. NFP, CPI and PPI land here. Be
flat into the number unless you have actually tested news trading; the
tradable move is the retracement twenty minutes later.

**C — Asian Range Build.** 03:00–09:00 EAT. Mark the high and low. These are
levels for later, not entries now.

**Stand aside — Midday Lull.** 18:30–20:30 EAT in summer. London has gone,
New York is at lunch. The chop looks like consolidation before a breakout. It
usually is not.

Across the week: Monday is slow, Tuesday and Wednesday are the best days,
Thursday is still strong, and Friday stops being tradeable after the New York
midday.

---

## Matching your broker

Session boundaries here follow the common retail convention — 09:00–18:00 in
Tokyo, 08:00–17:00 everywhere else, each in local time. Brokers differ by an
hour here and there, and most MT4/MT5 servers run on UTC+2 or UTC+3 rather
than on any market's real clock.

If your broker's candles disagree, edit the `open` and `close` fields in
[`lib/sessions.ts`](lib/sessions.ts). Everything downstream — the timeline, the
countdowns, the alerts — follows from those numbers.

Entry windows live in [`lib/entries.ts`](lib/entries.ts) and are edited the same
way. Each one carries its own timezone, so set the hours in the local time of
the market that causes the window, not in EAT.

---

## Running it locally

```bash
npm install
npm run dev
```

Then <http://localhost:3000>.

```bash
npm run verify
```

Checks the timezone maths against known DST transitions in both hemispheres,
and walks a full simulated week of five-minute cron polls to confirm every
session open fires exactly one alert — none missed, none duplicated.

To see what a real alert will look like without sending one:

```
http://localhost:3000/api/cron?dry=1
```

---

## Installing it on your phone

Open the Vercel URL in Chrome on Android, then **menu → Add to Home screen**.
It installs as a standalone app and works offline, since the whole clock is
computed on the device with no network calls. Telegram remains the thing that
actually wakes your phone.

---

Nothing here is financial advice. Session timings are a description of when
liquidity shows up, not a prediction of which way it goes.
