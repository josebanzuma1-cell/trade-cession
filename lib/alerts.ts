import { HOME_TZ, MINUTE, formatTime } from "./tz";
import { SESSION_BY_ID, nextPrimeOverlap, upcomingEvents } from "./sessions";
import { entryInstances, type EntryInstance } from "./entries";

export interface DueAlert {
  /** Stable across invocations — used to de-duplicate. */
  key: string;
  /** The instant the alert is about. */
  at: number;
  text: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The entry window that starts alongside a session open, if there is one. */
function windowFor(sessionOpen: number, entries: EntryInstance[]): EntryInstance | undefined {
  return entries
    .filter((e) => e.grade === "A+" || e.grade === "A")
    .find((e) => Math.abs(e.startAt - sessionOpen) <= 90 * MINUTE && e.endAt > sessionOpen);
}

function leadLabel(ms: number): string {
  const m = Math.round(ms / MINUTE);
  return m === 1 ? "1 MINUTE" : `${m} MINUTES`;
}

function sessionMessage(
  id: keyof typeof SESSION_BY_ID,
  at: number,
  leadMs: number | null,
  entries: EntryInstance[],
): string {
  const s = SESSION_BY_ID[id];
  const lines: string[] = [];

  lines.push(
    leadMs !== null
      ? `🔔 <b>${esc(s.name.toUpperCase())} OPENS IN ${leadLabel(leadMs)}</b>`
      : `🟢 <b>${esc(s.name.toUpperCase())} IS OPEN</b>`,
  );
  lines.push(`<code>${formatTime(at, HOME_TZ)} EAT</code> · ${esc(s.drives)}`);
  lines.push("");
  lines.push(esc(s.blurb));

  const w = windowFor(at, entries);
  if (w) {
    lines.push("");
    lines.push(
      `<b>${esc(w.label)}</b>  ·  grade ${esc(w.grade)}\n<code>${formatTime(
        w.startAt,
        HOME_TZ,
      )}–${formatTime(w.endAt, HOME_TZ)} EAT</code>`,
    );
    lines.push("");
    lines.push(`<b>Play</b>\n${esc(w.play)}`);
    lines.push("");
    lines.push(`<b>Watch out</b>\n${esc(w.caution)}`);
  }

  return lines.join("\n");
}

function overlapMessage(at: number, end: number, leadMs: number | null): string {
  return [
    leadMs !== null
      ? `⚡️ <b>PRIME WINDOW IN ${leadLabel(leadMs)}</b>`
      : `⚡️ <b>PRIME WINDOW IS LIVE</b>`,
    `<code>${formatTime(at, HOME_TZ)}–${formatTime(end, HOME_TZ)} EAT</code>`,
    "",
    "London and New York are open together — the deepest liquidity and the widest range of the day.",
    "",
    "<b>Play</b>",
    "Trade the continuation of the direction London set, or the reversal if New York rejects it outright. Structure is cleanest here and targets actually get hit.",
    "",
    "<b>Watch out</b>",
    "Deep liquidity means fast liquidity. Size for the volatility, not for the clock.",
  ].join("\n");
}

/**
 * Alerts whose moment falls inside [now, now + windowMs).
 *
 * Buckets are half-open and exactly `windowMs` wide, so consecutive polls
 * neither overlap nor leave a gap, and every alert fires once. Each session
 * open also produces a heads-up alert `leadMs` earlier, which gives the
 * schedule some redundancy: if one of the two is lost to a late cron run,
 * the other still lands.
 */
export function dueAlerts(
  now: number,
  windowMs: number,
  leadMs: number,
): DueAlert[] {
  const horizon = now + windowMs + leadMs;
  const entries = entryInstances(now - 12 * 60 * MINUTE, horizon + 12 * 60 * MINUTE);
  const out: DueAlert[] = [];
  const inBucket = (m: number) => m >= now && m < now + windowMs;

  for (const e of upcomingEvents(now - windowMs, 3 * 86_400_000)) {
    if (e.kind !== "open") continue;
    if (e.at > horizon) break;

    if (leadMs > 0 && inBucket(e.at - leadMs)) {
      out.push({
        key: `lead:${e.id}:${e.at}`,
        at: e.at - leadMs,
        text: sessionMessage(e.id, e.at, leadMs, entries),
      });
    }
    if (inBucket(e.at)) {
      out.push({
        key: `open:${e.id}:${e.at}`,
        at: e.at,
        text: sessionMessage(e.id, e.at, null, entries),
      });
    }
  }

  const prime = nextPrimeOverlap(now);
  if (prime) {
    // The overlap begins exactly when New York opens, so the New York alert
    // already carries this window. Sending the standalone version too would
    // put two near-identical messages on the phone in the same second.
    const covered = (prefix: string) =>
      out.some((o) => o.key === `${prefix}:newyork:${prime.start}`);

    if (leadMs > 0 && inBucket(prime.start - leadMs) && !covered("lead")) {
      out.push({
        key: `lead:overlap:${prime.start}`,
        at: prime.start - leadMs,
        text: overlapMessage(prime.start, prime.end, leadMs),
      });
    }
    if (inBucket(prime.start) && !covered("open")) {
      out.push({
        key: `open:overlap:${prime.start}`,
        at: prime.start,
        text: overlapMessage(prime.start, prime.end, null),
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
