import { DAY, partsInZone, wallToUtc } from "./tz";
import type { SessionId } from "./sessions";

export type Grade = "A+" | "A" | "B" | "C" | "avoid";

export interface EntryWindowDef {
  id: string;
  label: string;
  /** Anchored to a market's local clock, so it tracks that market's DST. */
  tz: string;
  start: [number, number];
  end: [number, number];
  grade: Grade;
  session: SessionId;
  instruments: string[];
  /** What actually tends to happen in this window. */
  behaviour: string;
  /** How an intermediate trader plays it. */
  play: string;
  /** The way this window usually takes money off people. */
  caution: string;
}

/**
 * Entry windows are anchored to the market that causes them, never to EAT.
 * Kampala never changes its clock, but London and New York do, so a window
 * pinned to "16:00 EAT" drifts by an hour twice a year while a window pinned
 * to "08:00 New York" never does.
 */
export const ENTRY_WINDOWS: EntryWindowDef[] = [
  {
    id: "asian-range",
    label: "Asian Range Build",
    tz: "Asia/Tokyo",
    start: [9, 0],
    end: [15, 0],
    grade: "C",
    session: "tokyo",
    instruments: ["USDJPY", "AUDUSD", "XAUUSD (quiet)"],
    behaviour:
      "Low volume, narrow range. Price coils between a high and a low that London will later hunt.",
    play:
      "Mark the Asian high and low on your chart, then leave it alone. This window exists to give you levels, not entries. If you must trade it, fade the extremes of an established range and never the middle.",
    caution:
      "Ranges this tight make spread and commission a large share of any target. Most accounts bleed here, not on the big moves.",
  },
  {
    id: "london-killzone",
    label: "London Open Killzone",
    tz: "Europe/London",
    start: [7, 0],
    end: [10, 0],
    grade: "A",
    session: "london",
    instruments: ["EURUSD", "GBPUSD", "EURGBP", "XAUUSD", "GER40"],
    behaviour:
      "Volume steps up hard. Price very often sweeps one side of the Asian range, traps the breakout crowd, then reverses into the true daily direction.",
    play:
      "Wait for the sweep. Let price take out the Asian high or low, fail to hold, and close back inside. Enter on that reclaim, stop beyond the wick, target the opposite side of the range or the day opening price.",
    caution:
      "The first move is a lie more often than not. Chasing the opening breakout, before price has swept the Asian range and reclaimed it, is the most common way to donate money in this window.",
  },
  {
    id: "ny-data",
    label: "US Data Release",
    tz: "America/New_York",
    start: [8, 30],
    end: [9, 0],
    grade: "B",
    session: "newyork",
    instruments: ["All USD pairs", "XAUUSD", "US30", "NAS100"],
    behaviour:
      "NFP, CPI, PPI and jobless claims land at 08:30 New York. Spreads widen, liquidity vanishes for a few seconds, then price picks a direction violently.",
    play:
      "Be flat into the number unless news trading is a strategy you have actually tested. The tradable move is the retracement 15 to 30 minutes later, once spreads normalise and a clean high or low has been left behind.",
    caution:
      "Stops do not fill where you put them during the spike. Slippage here is real and it is always against you. Reduce size or stand aside.",
  },
  {
    id: "overlap",
    label: "Peak Overlap",
    tz: "America/New_York",
    start: [8, 0],
    end: [11, 0],
    grade: "A+",
    session: "newyork",
    instruments: ["EURUSD", "GBPUSD", "XAUUSD", "US30", "NAS100"],
    behaviour:
      "London and New York are both open, and these are the strongest three hours of that overlap — the deepest liquidity and the widest range in the entire 24 hours. The overlap itself runs on for another hour after this window, but at steadily thinning volume.",
    play:
      "Your highest quality window. Trade the continuation of the direction London established, or the reversal if New York rejects it outright. Structure is cleanest here, spreads are tightest, and targets actually get hit.",
    caution:
      "Deep liquidity means fast liquidity. A move that took London two hours can happen in fifteen minutes. Size for the volatility, not for the clock.",
  },
  {
    id: "cash-open",
    label: "Wall Street Cash Open",
    tz: "America/New_York",
    start: [9, 30],
    end: [10, 30],
    grade: "A",
    session: "newyork",
    instruments: ["US30", "NAS100", "SPX500", "XAUUSD (correlated)"],
    behaviour:
      "US equities open. Indices gap, fill, and then trend. Gold often moves inversely to the prevailing risk tone.",
    play:
      "The index window. Let the first 15 minutes set an opening range, then trade the break of it in the direction of the trend. For gold, read the equity direction as a risk-on or risk-off signal rather than an entry by itself.",
    caution:
      "The opening five minutes are noise on indices. Entering before an opening range exists puts your stop somewhere arbitrary.",
  },
  {
    id: "midday-lull",
    label: "Midday Lull",
    tz: "America/New_York",
    start: [11, 30],
    end: [13, 30],
    grade: "avoid",
    session: "newyork",
    instruments: [],
    behaviour:
      "London has closed or is closing and New York desks are at lunch. Volume falls off a cliff and price chops sideways in a tight, directionless band.",
    play:
      "Close the laptop. Journal the morning trades. This window is on the list so that you know to skip it, not so that you trade it.",
    caution:
      "The chop here looks exactly like consolidation before a breakout. It usually is not. This is where morning profits go to die.",
  },
  {
    id: "ny-close-ramp",
    label: "New York Close Ramp",
    tz: "America/New_York",
    start: [15, 0],
    end: [16, 0],
    grade: "B",
    session: "newyork",
    instruments: ["US30", "NAS100", "USD majors"],
    behaviour:
      "Desks square positions before the close. Sharp, short, often counter-trend moves as the crowded side of the day gets unwound.",
    play:
      "A scalping window, not a swing window. Trade it small and take profit quickly, because whatever starts here rarely survives into the next day.",
    caution:
      "Do not open a new swing position in this hour expecting follow-through. The flow driving it disappears at the bell.",
  },
];

export interface EntryInstance extends EntryWindowDef {
  startAt: number;
  endAt: number;
}

/** Concrete instances of every entry window that intersects [from, to]. */
export function entryInstances(from: number, to: number): EntryInstance[] {
  const out: EntryInstance[] = [];
  for (const w of ENTRY_WINDOWS) {
    for (let t = from - DAY; t <= to + DAY; t += DAY) {
      const p = partsInZone(t, w.tz);
      if (p.weekday === 0 || p.weekday === 6) continue;
      const startAt = wallToUtc(p.year, p.month, p.day, w.start[0], w.start[1], w.tz);
      const endAt = wallToUtc(p.year, p.month, p.day, w.end[0], w.end[1], w.tz);
      // Half-open, for the same reason as in sessions.ts: the New York close
      // ramp ends exactly at midnight EAT in the northern winter.
      if (endAt <= from || startAt >= to) continue;
      if (out.some((o) => o.id === w.id && o.startAt === startAt)) continue;
      out.push({ ...w, startAt, endAt });
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

export function activeEntryWindows(now: number): EntryInstance[] {
  return entryInstances(now - DAY, now + DAY).filter(
    (w) => w.startAt <= now && now < w.endAt,
  );
}

export function nextEntryWindow(
  now: number,
  grades: Grade[] = ["A+", "A"],
): EntryInstance | null {
  return (
    entryInstances(now, now + 7 * DAY).find(
      (w) => w.startAt > now && grades.includes(w.grade),
    ) ?? null
  );
}

export const GRADE_STYLE: Record<Grade, { label: string; fg: string; bg: string }> = {
  "A+": { label: "Prime", fg: "#022c22", bg: "#34d399" },
  A: { label: "Strong", fg: "#052e16", bg: "#86efac" },
  B: { label: "Situational", fg: "#422006", bg: "#fcd34d" },
  C: { label: "Observe", fg: "#0f172a", bg: "#94a3b8" },
  avoid: { label: "Stand aside", fg: "#450a0a", bg: "#fca5a5" },
};

/** Day-of-week character, in a trader's own terms. */
export const WEEKLY_RHYTHM: { day: string; note: string; grade: Grade }[] = [
  {
    day: "Monday",
    note: "Slow start. The weekly range is still forming, so trade small or simply observe.",
    grade: "C",
  },
  {
    day: "Tuesday",
    note: "Volume returns properly. One of the two strongest days of the week.",
    grade: "A",
  },
  {
    day: "Wednesday",
    note: "The weekly high or low often prints today. Strong for continuation trades.",
    grade: "A+",
  },
  {
    day: "Thursday",
    note: "Still strong, but watch for reversals as the weekly move matures.",
    grade: "A",
  },
  {
    day: "Friday",
    note: "Good until New York midday. After that, position squaring makes it untradeable.",
    grade: "B",
  },
];
