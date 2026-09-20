import { wallToUtc, formatTime, partsInZone, HOME_TZ } from "../lib/tz";
import { sessionWindows, overlaps, nextPrimeOverlap, activeSessions, isWeekendBreak, upcomingEvents } from "../lib/sessions";
import { dueAlerts } from "../lib/alerts";
import { classifySweep } from "../lib/marketdata";
import { INSTRUMENTS, INSTRUMENT_BY_ID } from "../lib/instruments";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (String(got) === String(want)) { pass++; console.log(`  ok   ${label} = ${got}`); }
  else { fail++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}

console.log("\n-- wallToUtc across DST boundaries --");
const winter = wallToUtc(2026, 1, 15, 8, 0, "Europe/London");
eq("London 08:00 15-Jan in UTC", formatTime(winter, "UTC"), "08:00");
eq("  ...same instant in EAT", formatTime(winter, HOME_TZ), "11:00");

const summer = wallToUtc(2026, 7, 15, 8, 0, "Europe/London");
eq("London 08:00 15-Jul in UTC", formatTime(summer, "UTC"), "07:00");
eq("  ...same instant in EAT", formatTime(summer, HOME_TZ), "10:00");

const nyW = wallToUtc(2026, 1, 15, 8, 0, "America/New_York");
eq("NY 08:00 15-Jan in EAT", formatTime(nyW, HOME_TZ), "16:00");
const nyS = wallToUtc(2026, 7, 15, 8, 0, "America/New_York");
eq("NY 08:00 15-Jul in EAT", formatTime(nyS, HOME_TZ), "15:00");

eq("Tokyo 09:00 in EAT (no DST)", formatTime(wallToUtc(2026, 7, 15, 9, 0, "Asia/Tokyo"), HOME_TZ), "03:00");

const sydW = wallToUtc(2026, 1, 15, 8, 0, "Australia/Sydney");
eq("Sydney 08:00 15-Jan (AEDT) in EAT", formatTime(sydW, HOME_TZ), "00:00");
const sydS = wallToUtc(2026, 7, 15, 8, 0, "Australia/Sydney");
eq("Sydney 08:00 15-Jul (AEST) in EAT", formatTime(sydS, HOME_TZ), "01:00");

console.log("\n-- the transition weekend itself (BST starts 29-Mar-2026) --");
eq("London 08:00 27-Mar (GMT) in EAT", formatTime(wallToUtc(2026, 3, 27, 8, 0, "Europe/London"), HOME_TZ), "11:00");
eq("London 08:00 30-Mar (BST) in EAT", formatTime(wallToUtc(2026, 3, 30, 8, 0, "Europe/London"), HOME_TZ), "10:00");

console.log("\n-- London/NY overlap in EAT --");
function ov(d: string) {
  const day = new Date(d + "T12:00:00Z").getTime();
  const o = overlaps(day - 86400000, day + 86400000)
    .find(x => (x.a === "london" && x.b === "newyork") || (x.a === "newyork" && x.b === "london"))!;
  return `${formatTime(o.start, HOME_TZ)}-${formatTime(o.end, HOME_TZ)}`;
}
eq("overlap 15-Jan-2026 (EAT)", ov("2026-01-15"), "16:00-20:00");
eq("overlap 15-Jul-2026 (EAT)", ov("2026-07-15"), "15:00-19:00");

console.log("\n-- weekend gating --");
const sat = new Date("2026-09-19T12:00:00Z").getTime(); // Saturday
eq("sessions active on Saturday noon UTC", activeSessions(sat).length, 0);
const wed = new Date("2026-09-16T13:00:00Z").getTime();
eq("sessions active Wed 13:00 UTC", activeSessions(wed).map(s => s.id).sort().join(","), "london,newyork");

console.log("\n-- no duplicate windows over a week --");
const from = Date.now(), to = from + 7 * 86400000;
const w = sessionWindows(from, to);
const keys = new Set(w.map(x => `${x.id}@${x.open}`));
eq("unique windows", keys.size, w.length);
eq("all windows have open < close", w.every(x => x.open < x.close), "true");


console.log("\n-- weekend break vs the short daily gap --");
// Sunday 22:00 EAT: Sydney is only two hours away, but the market has been
// shut since Friday. This must read as the weekend, not as a daily gap.
eq(
  "Sunday 19:00 UTC is the weekend",
  isWeekendBreak(new Date("2026-09-20T19:00:00Z").getTime()),
  "true",
);
// Tuesday 21:30 UTC in July: New York closed at 21:00, Sydney opens at 22:00.
// That is a genuine one-hour daily gap, not a weekend.
eq(
  "Tue 21:30 UTC in July is a daily gap",
  isWeekendBreak(new Date("2026-07-07T21:30:00Z").getTime()),
  "false",
);
eq(
  "Wed 13:00 UTC is not a break",
  isWeekendBreak(new Date("2026-09-16T13:00:00Z").getTime()),
  "false",
);

console.log("\n-- alert scheduling: one alert per event, none missed --");
// Walk a whole week in the same 5-minute buckets the cron uses and collect
// everything the scheduler would send.
{
  const BUCKET = 5 * 60_000;
  const LEAD = 15 * 60_000;
  const start = new Date("2026-09-21T00:00:00Z").getTime();
  const end = start + 7 * 86_400_000;

  const fired: string[] = [];
  for (let t = start; t < end; t += BUCKET) {
    for (const a of dueAlerts(t, BUCKET, LEAD)) fired.push(a.key);
  }

  eq("no duplicate alerts over a week", new Set(fired).size, fired.length);

  // Every session open inside the window must have produced both alerts.
  const opens = upcomingEvents(start, 7 * 86_400_000)
    .filter((e) => e.kind === "open" && e.at >= start + LEAD && e.at < end);
  const missing = opens.filter(
    (e) => !fired.includes(`open:${e.id}:${e.at}`) || !fired.includes(`lead:${e.id}:${e.at}`),
  );
  eq("session opens covered", opens.length - missing.length, opens.length);
  eq("session opens seen in the week", opens.length >= 18, "true");

  // The overlap starts exactly when New York opens, so the New York alert
  // already carries it and the standalone version must be suppressed.
  const overlapAlerts = fired.filter((k) => k.includes("overlap"));
  eq("no redundant standalone overlap alerts", overlapAlerts.length, 0);

  // ...but the prime window must still actually reach the phone.
  const nyLead = dueAlerts(
    new Date("2026-09-21T11:45:00Z").getTime(),
    BUCKET,
    LEAD,
  );
  eq("New York alert carries the prime window",
    nyLead.some((a) => a.key.startsWith("lead:newyork") && a.text.includes("Peak Overlap")),
    "true");
  eq("New York lead is a single message", nyLead.length, 1);
  eq("lead phrasing reads cleanly", nyLead[0].text.includes("OPENS IN 15 MINUTES"), "true");
}

console.log("\n-- headline states real time remaining, not the configured lead --");
{
  // New York opens 12:00 UTC (15:00 EAT) on Mon 21 Sept 2026.
  const NY_OPEN = new Date("2026-09-21T12:00:00Z").getTime();
  const LEAD = 15 * 60_000;

  // A poll aligned to the lead moment: 15 minutes really is 15 minutes.
  const aligned = dueAlerts(NY_OPEN - LEAD, 5 * 60_000, LEAD)
    .find((a) => a.key.startsWith("lead:newyork"))!;
  eq("aligned poll says 15 minutes", aligned.text.includes("OPENS IN 15 MINUTES"), "true");

  // A 15-minute schedule polling off-boundary at 11:37 queues the 11:45 lead
  // moment but SENDS it at 11:37 — 23 minutes before the open, not 15.
  const early = dueAlerts(
    new Date("2026-09-21T11:37:00Z").getTime(),
    15 * 60_000,
    LEAD,
  ).find((a) => a.key.startsWith("lead:newyork"))!;
  eq("off-boundary poll states the true gap", early.text.includes("OPENS IN 23 MINUTES"), "true");
  eq("...and does not claim the configured lead", early.text.includes("15 MINUTES"), "false");

  // An open alert sent a bucket early must not claim the session is open.
  const premature = dueAlerts(
    new Date("2026-09-21T11:52:00Z").getTime(),
    15 * 60_000,
    LEAD,
  ).find((a) => a.key.startsWith("open:newyork"))!;
  eq("early open alert still counts down", premature.text.includes("OPENS IN 8 MINUTES"), "true");
  eq("...and is not headlined IS OPEN", premature.text.includes("IS OPEN"), "false");

  // Polled right on the open, it reads as live.
  const onTime = dueAlerts(NY_OPEN, 5 * 60_000, LEAD)
    .find((a) => a.key.startsWith("open:newyork"))!;
  eq("on-time open alert reads IS OPEN", onTime.text.includes("IS OPEN"), "true");
}

console.log("\n-- sweep classification --");
{
  const bar = (t: number, h: number, l: number, c: number) => ({ t, o: c, h, l, c });
  const HI = 1.1000, LO = 1.0900, FROM = 1000;

  eq("nothing taken -> inside",
    classifySweep([bar(1000, 1.0990, 1.0910, 1.0950)], HI, LO, FROM), "inside");

  // Took the high and stayed above: a breakout, or a trap not yet sprung.
  eq("through the high, holding -> swept-high",
    classifySweep([bar(1000, 1.1030, 1.0990, 1.1025)], HI, LO, FROM), "swept-high");

  // Took the high then closed back inside: the short setup.
  eq("through the high, back inside -> reclaimed-down",
    classifySweep([bar(1000, 1.1030, 1.0990, 1.1020), bar(2000, 1.1022, 1.0950, 1.0960)], HI, LO, FROM),
    "reclaimed-down");

  // Mirror image: the long setup.
  eq("through the low, back inside -> reclaimed-up",
    classifySweep([bar(1000, 1.0910, 1.0870, 1.0880), bar(2000, 1.0960, 1.0875, 1.0950)], HI, LO, FROM),
    "reclaimed-up");

  // Both sides taken: the MOST RECENT extreme decides the direction.
  eq("low then high, back inside -> reclaimed-down",
    classifySweep([bar(1000, 1.0950, 1.0870, 1.0930), bar(2000, 1.1040, 1.0990, 1.0950)], HI, LO, FROM),
    "reclaimed-down");
  eq("high then low, back inside -> reclaimed-up",
    classifySweep([bar(1000, 1.1040, 1.0990, 1.1010), bar(2000, 1.1000, 1.0860, 1.0950)], HI, LO, FROM),
    "reclaimed-up");

  // Bars before the Asian close must not count as a sweep.
  eq("pre-window bars ignored",
    classifySweep([bar(500, 1.1500, 1.0500, 1.1400), bar(1000, 1.0990, 1.0910, 1.0950)], HI, LO, FROM),
    "inside");
}

console.log("\n-- COT sign handling --");
{
  const jpy = INSTRUMENT_BY_ID["USDJPY"];
  const eur = INSTRUMENT_BY_ID["EURUSD"];
  // Yen futures are quoted inverse to USDJPY. Long yen futures means short
  // USDJPY; reporting it unflipped would invert the read on every yen alert.
  eq("USDJPY is marked for inversion", jpy.cotInvert, "true");
  eq("EURUSD is not inverted", eur.cotInvert, "false");
  eq("gold maps to the COMEX contract", INSTRUMENT_BY_ID["XAUUSD"].cot, "GOLD - COMMODITY EXCHANGE INC.");
  eq("every instrument has a COT contract", INSTRUMENTS.every(i => i.cot !== null), "true");
  eq("indices have no Asian range", INSTRUMENTS.filter(i => !i.hasAsianRange).map(i => i.id).join(","), "US30,NAS100");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
