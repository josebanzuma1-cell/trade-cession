import { DAY, MINUTE, partsInZone, wallToUtc } from "./tz";

export type SessionId = "sydney" | "tokyo" | "london" | "newyork";

export interface SessionDef {
  id: SessionId;
  name: string;
  city: string;
  tz: string;
  /** Session hours in the market's own local time. */
  open: [number, number];
  close: [number, number];
  accent: string; // tailwind-ish hex, used for bars and dots
  blurb: string;
  drives: string;
}

/**
 * Session hours follow the common retail-forex convention: an 09:00-18:00
 * Tokyo day and 08:00-17:00 elsewhere, each in the market's own local time.
 * Brokers differ by an hour here and there; these are the boundaries most
 * charting platforms draw.
 */
export const SESSIONS: SessionDef[] = [
  {
    id: "sydney",
    name: "Sydney",
    city: "Australia/Sydney",
    tz: "Australia/Sydney",
    open: [8, 0],
    close: [17, 0],
    accent: "#38bdf8",
    blurb: "Opens the trading week. Thin liquidity, tight ranges.",
    drives: "AUD, NZD",
  },
  {
    id: "tokyo",
    name: "Tokyo",
    city: "Asia/Tokyo",
    tz: "Asia/Tokyo",
    open: [9, 0],
    close: [18, 0],
    accent: "#a78bfa",
    blurb: "The Asian range. Its high and low become London's liquidity.",
    drives: "JPY, AUD, gold accumulation",
  },
  {
    id: "london",
    name: "London",
    city: "Europe/London",
    tz: "Europe/London",
    open: [8, 0],
    close: [17, 0],
    accent: "#34d399",
    blurb: "Largest FX centre on earth. Where the real daily move usually starts.",
    drives: "EUR, GBP, CHF, XAUUSD",
  },
  {
    id: "newyork",
    name: "New York",
    city: "America/New_York",
    tz: "America/New_York",
    open: [8, 0],
    close: [17, 0],
    accent: "#fb923c",
    blurb: "US data and the equity cash open. Continuation or hard reversal.",
    drives: "USD, US30, NAS100, XAUUSD",
  },
];

export const SESSION_BY_ID = Object.fromEntries(
  SESSIONS.map((s) => [s.id, s]),
) as Record<SessionId, SessionDef>;

export interface SessionWindow {
  id: SessionId;
  open: number; // UTC ms
  close: number; // UTC ms
}

/**
 * Every session window that intersects [from, to].
 *
 * Sessions run on their own local weekdays, which is what makes the forex
 * week open at Sydney's Monday morning and close at New York's Friday
 * evening without any special-casing.
 */
export function sessionWindows(from: number, to: number): SessionWindow[] {
  const out: SessionWindow[] = [];
  for (const s of SESSIONS) {
    // Walk a day either side of the range so windows straddling the edge
    // are still produced.
    for (let t = from - DAY; t <= to + DAY; t += DAY) {
      const p = partsInZone(t, s.tz);
      if (p.weekday === 0 || p.weekday === 6) continue; // no Sat/Sun sessions
      const open = wallToUtc(p.year, p.month, p.day, s.open[0], s.open[1], s.tz);
      const close = wallToUtc(p.year, p.month, p.day, s.close[0], s.close[1], s.tz);
      // Half-open, so a window that ends exactly at `from` or starts exactly
      // at `to` is not counted as intersecting. Without this, asking for a
      // single day returns yesterday's New York session alongside today's,
      // because it closes at precisely midnight EAT.
      if (close <= from || open >= to) continue;
      if (out.some((w) => w.id === s.id && w.open === open)) continue;
      out.push({ id: s.id, open, close });
    }
  }
  return out.sort((a, b) => a.open - b.open);
}

export function activeSessions(now: number): SessionWindow[] {
  return sessionWindows(now - DAY, now + DAY).filter(
    (w) => w.open <= now && now < w.close,
  );
}

export type EventKind = "open" | "close";

export interface SessionEvent {
  id: SessionId;
  kind: EventKind;
  at: number;
}

/** Upcoming opens and closes, soonest first. */
export function upcomingEvents(now: number, horizon = 5 * DAY): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const w of sessionWindows(now - DAY, now + horizon)) {
    if (w.open > now) events.push({ id: w.id, kind: "open", at: w.open });
    if (w.close > now) events.push({ id: w.id, kind: "close", at: w.close });
  }
  return events.sort((a, b) => a.at - b.at);
}

export function nextOpen(now: number): SessionEvent | null {
  return upcomingEvents(now).find((e) => e.kind === "open") ?? null;
}

/**
 * The market is closed when nothing is running. In practice that is the
 * weekend, plus a short daily gap between the New York close and the Sydney
 * open during the northern summer.
 */
export function isMarketOpen(now: number): boolean {
  return activeSessions(now).length > 0;
}

/**
 * True during the weekend break, as opposed to the brief daily gap that
 * appears between the New York close and the Sydney open in the northern
 * summer.
 *
 * This looks backwards at how long everything has been shut rather than
 * forwards at the next open. On a Sunday evening in Kampala, Sydney is only
 * a couple of hours away but the market has been closed since Friday, and
 * calling that "a short gap" would be wrong.
 */
export function isWeekendBreak(now: number): boolean {
  if (isMarketOpen(now)) return false;
  const closed = sessionWindows(now - 4 * DAY, now)
    .filter((w) => w.close <= now)
    .map((w) => w.close);
  if (closed.length === 0) return true;
  return now - Math.max(...closed) > 240 * MINUTE;
}

export interface OverlapWindow {
  a: SessionId;
  b: SessionId;
  start: number;
  end: number;
}

/** Pairs of sessions running at the same time within [from, to]. */
export function overlaps(from: number, to: number): OverlapWindow[] {
  const windows = sessionWindows(from, to);
  const out: OverlapWindow[] = [];
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const start = Math.max(windows[i].open, windows[j].open);
      const end = Math.min(windows[i].close, windows[j].close);
      if (start < end) {
        out.push({ a: windows[i].id, b: windows[j].id, start, end });
      }
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** The London/New York overlap specifically — the deepest liquidity of the day. */
export function nextPrimeOverlap(now: number): OverlapWindow | null {
  return (
    overlaps(now - DAY, now + 7 * DAY).find(
      (o) =>
        ((o.a === "london" && o.b === "newyork") ||
          (o.a === "newyork" && o.b === "london")) &&
        o.end > now,
    ) ?? null
  );
}
