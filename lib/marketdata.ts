import { INSTRUMENTS, type Instrument } from "./instruments";
import { DAY, HOUR, partsInZone, wallToUtc } from "./tz";

/**
 * Price structure computed from real candles.
 *
 * Nothing here predicts direction. It measures things that either happened or
 * did not: where the Asian range sat, whether price traded through one side of
 * it, and whether it closed back inside. That is the setup the London window
 * already describes, made checkable instead of merely described.
 */

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type SweepState =
  | "pending" // Asian range still forming
  | "inside" // range intact, nothing taken yet
  | "swept-high" // traded above, still above — breakout or trap, undecided
  | "swept-low"
  | "reclaimed-down" // took the high, closed back inside: the short setup
  | "reclaimed-up"; // took the low, closed back inside: the long setup

export interface Levels {
  id: string;
  label: string;
  digits: number;
  price: number | null;
  asianHigh: number | null;
  asianLow: number | null;
  asianComplete: boolean;
  prevHigh: number | null;
  prevLow: number | null;
  sweep: SweepState | null;
  stale: boolean;
}

async function fetchBars(symbol: string): Promise<Bar[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=15m&range=5d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 300 }, // 5 minutes
  });
  if (!res.ok) throw new Error(`Yahoo replied ${res.status} for ${symbol}`);
  const json = (await res.json()) as {
    chart?: { result?: [{ timestamp?: number[]; indicators: { quote: [Record<string, (number | null)[]>] } }] };
  };
  const r = json.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0];
  const out: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ t: r.timestamp[i] * 1000, o, h, l, c });
  }
  return out;
}

/**
 * The Asian session in UTC for the Tokyo day containing `now`.
 * Tokyo 09:00-15:00 JST, which is fixed at UTC+9 with no daylight saving.
 */
function asianWindow(now: number): { start: number; end: number } {
  const p = partsInZone(now, "Asia/Tokyo");
  const start = wallToUtc(p.year, p.month, p.day, 9, 0, "Asia/Tokyo");
  return { start, end: start + 6 * HOUR };
}

export function classifySweep(
  bars: Bar[],
  high: number,
  low: number,
  from: number,
): SweepState {
  const after = bars.filter((b) => b.t >= from);
  if (after.length === 0) return "inside";

  let tookHigh = false;
  let tookLow = false;
  for (const b of after) {
    if (b.h > high) tookHigh = true;
    if (b.l < low) tookLow = true;
  }
  if (!tookHigh && !tookLow) return "inside";

  const last = after[after.length - 1].c;
  const back = last <= high && last >= low;

  // Where both sides were taken, the most recent extreme is what matters.
  if (tookHigh && tookLow) {
    const lastHighIdx = after.map((b) => b.h > high).lastIndexOf(true);
    const lastLowIdx = after.map((b) => b.l < low).lastIndexOf(true);
    if (lastHighIdx > lastLowIdx) return back ? "reclaimed-down" : "swept-high";
    return back ? "reclaimed-up" : "swept-low";
  }
  if (tookHigh) return back ? "reclaimed-down" : "swept-high";
  return back ? "reclaimed-up" : "swept-low";
}

async function levelsFor(inst: Instrument, now: number): Promise<Levels> {
  const base: Levels = {
    id: inst.id,
    label: inst.label,
    digits: inst.digits,
    price: null,
    asianHigh: null,
    asianLow: null,
    asianComplete: false,
    prevHigh: null,
    prevLow: null,
    sweep: null,
    stale: true,
  };

  let bars: Bar[];
  try {
    bars = await fetchBars(inst.yahoo);
  } catch {
    return base;
  }
  if (bars.length === 0) return base;

  const last = bars[bars.length - 1];
  base.price = last.c;
  // Anything older than four hours means the venue is shut or the feed broke;
  // showing it as live would be worse than showing nothing.
  base.stale = now - last.t > 4 * HOUR;

  // The last UTC day that actually traded, which over a weekend means Friday
  // rather than an empty Saturday. Walking back finds it whatever the day.
  const todayUtc = Math.floor(now / DAY) * DAY;
  for (let d = todayUtc - DAY; d >= todayUtc - 5 * DAY; d -= DAY) {
    const prev = bars.filter((b) => b.t >= d && b.t < d + DAY);
    if (prev.length === 0) continue;
    base.prevHigh = Math.max(...prev.map((b) => b.h));
    base.prevLow = Math.min(...prev.map((b) => b.l));
    break;
  }

  if (!inst.hasAsianRange) return base;

  const { start, end } = asianWindow(now);
  const asia = bars.filter((b) => b.t >= start && b.t < end);
  if (asia.length === 0) return base;

  base.asianHigh = Math.max(...asia.map((b) => b.h));
  base.asianLow = Math.min(...asia.map((b) => b.l));
  base.asianComplete = now >= end;
  base.sweep = base.asianComplete
    ? classifySweep(bars, base.asianHigh, base.asianLow, end)
    : "pending";

  return base;
}

export async function fetchLevels(now = Date.now()): Promise<Levels[]> {
  return Promise.all(INSTRUMENTS.map((i) => levelsFor(i, now)));
}

export const SWEEP_COPY: Record<SweepState, { label: string; note: string; tone: "up" | "down" | "neutral" }> = {
  pending: {
    label: "Range forming",
    note: "The Asian session is still building. Wait for it to close before using these levels.",
    tone: "neutral",
  },
  inside: {
    label: "Range intact",
    note: "Neither side taken yet. The liquidity London hunts is still sitting there.",
    tone: "neutral",
  },
  "swept-high": {
    label: "Above the range",
    note: "The high was taken and price is holding above it. Either a real breakout or a trap that has not sprung yet — undecided, so do not force it.",
    tone: "neutral",
  },
  "swept-low": {
    label: "Below the range",
    note: "The low was taken and price is holding below. Either a real breakdown or a trap not yet sprung — undecided.",
    tone: "neutral",
  },
  "reclaimed-down": {
    label: "Swept high, back inside",
    note: "Price took the Asian high, failed to hold, and closed back in the range. This is the short setup the London window describes: stop above the wick, target the other side of the range.",
    tone: "down",
  },
  "reclaimed-up": {
    label: "Swept low, back inside",
    note: "Price took the Asian low, failed to hold, and closed back in the range. This is the long setup: stop below the wick, target the other side of the range.",
    tone: "up",
  },
};
