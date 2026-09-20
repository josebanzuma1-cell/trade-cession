/**
 * Timezone maths built on Intl, so DST is handled by the IANA database
 * rather than by hardcoded UTC offsets.
 *
 * This matters more than it looks. London and New York shift for DST on
 * different dates, Sydney shifts in the opposite direction (southern
 * hemisphere), Tokyo never shifts, and Kampala (EAT, UTC+3) never shifts.
 * A session clock that hardcodes "London opens at 10:00 EAT" is wrong for
 * roughly half the year.
 */

export const HOME_TZ = "Africa/Kampala"; // EAT, UTC+3, no DST, ever

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

/** Wall-clock parts of a UTC instant, as seen in `timeZone`. */
export function partsInZone(utcMs: number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
  };
}

/** Offset of `timeZone` from UTC, in ms, at the instant `utcMs`. */
export function tzOffsetMs(utcMs: number, timeZone: string): number {
  const p = partsInZone(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - (utcMs - (utcMs % 1000));
}

/**
 * Inverse of the above: the UTC instant at which `timeZone` reads the given
 * wall clock. Resolved iteratively because the offset depends on the answer.
 *
 * Around a DST transition a wall time can be ambiguous (clocks repeat) or
 * non-existent (clocks skip). Both resolve to a sane nearby instant here,
 * which is fine — no market opens during the 1am shuffle.
 */
export function wallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = naive - tzOffsetMs(naive, timeZone);
  // One correction pass catches the case where the first guess landed on the
  // far side of a DST boundary.
  const corrected = naive - tzOffsetMs(utc, timeZone);
  if (corrected !== utc) utc = corrected;
  return utc;
}

/**
 * A consistent "UTC+1" / "UTC-4" label.
 *
 * Intl's short zone names are uneven — en-US gives "EDT" for New York but
 * "GMT+1" for London — and a plain offset is the more useful number anyway,
 * since it is what you compare against your broker's server time.
 */
export function utcOffsetLabel(utcMs: number, timeZone: string): string {
  const minutes = Math.round(tzOffsetMs(utcMs, timeZone) / 60000);
  const sign = minutes < 0 ? "-" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Format an instant as HH:MM in a given zone. */
export function formatTime(utcMs: number, timeZone: string): string {
  const p = partsInZone(utcMs, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Format an instant as e.g. "Mon 20 Sep" in a given zone. */
export function formatDate(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(utcMs));
}

/** Human duration: "2h 14m", "47m", "in a moment". */
export function humanDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
