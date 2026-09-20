import { INSTRUMENTS, type Instrument } from "./instruments";

/**
 * Institutional positioning from the CFTC's Commitments of Traders report.
 *
 * This is the only genuinely free, genuinely institutional dataset a retail
 * trader can get. Every large holder of US futures is legally obliged to
 * report, so the numbers are real money rather than an indicator inferred
 * from the same candles everyone already has.
 *
 * Two honest limits, surfaced in the UI rather than buried here:
 *
 *  - It is WEEKLY and LAGGING. Positions are as of Tuesday's close and
 *    published Friday afternoon, so it is three to six days stale by the
 *    time it is read. It describes a standing stance, never an entry.
 *  - It covers US futures, not spot forex. Futures positioning tracks spot
 *    closely enough to read a bias from, but it is a proxy.
 */

const ENDPOINT = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

export interface CotReading {
  id: string;
  label: string;
  /** Net non-commercial (large speculator) position, sign-corrected. */
  net: number;
  /** Net as a percentage of total non-commercial open positions, -100..100. */
  netPct: number;
  /** Change in net since the previous report, sign-corrected. */
  change: number;
  reportDate: string;
  /** True where the sign was flipped to match how the pair is quoted. */
  inverted: boolean;
}

interface Row {
  market_and_exchange_names: string;
  report_date_as_yyyy_mm_dd: string;
  noncomm_positions_long_all: string;
  noncomm_positions_short_all: string;
}

function readingFor(inst: Instrument, rows: Row[]): CotReading | null {
  const mine = rows
    .filter((r) => r.market_and_exchange_names === inst.cot)
    .sort((a, b) =>
      b.report_date_as_yyyy_mm_dd.localeCompare(a.report_date_as_yyyy_mm_dd),
    );
  if (mine.length === 0) return null;

  const net = (r: Row) => {
    const long = Number(r.noncomm_positions_long_all);
    const short = Number(r.noncomm_positions_short_all);
    if (!Number.isFinite(long) || !Number.isFinite(short)) return null;
    const n = long - short;
    return { n: inst.cotInvert ? -n : n, total: long + short };
  };

  const latest = net(mine[0]);
  if (!latest) return null;
  const prior = mine[1] ? net(mine[1]) : null;

  return {
    id: inst.id,
    label: inst.label,
    net: latest.n,
    netPct: latest.total > 0 ? Math.round((latest.n / latest.total) * 100) : 0,
    change: prior ? latest.n - prior.n : 0,
    reportDate: mine[0].report_date_as_yyyy_mm_dd.slice(0, 10),
    inverted: inst.cotInvert,
  };
}

export async function fetchCot(): Promise<CotReading[]> {
  const tracked = INSTRUMENTS.filter((i) => i.cot);
  const names = tracked.map((i) => `'${i.cot!.replace(/'/g, "''")}'`).join(",");
  // Six weeks is plenty to find the two most recent reports per contract,
  // even across a holiday when publication slips.
  const since = new Date(Date.now() - 42 * 86_400_000).toISOString().slice(0, 10);

  const url =
    `${ENDPOINT}?$select=market_and_exchange_names,report_date_as_yyyy_mm_dd,` +
    `noncomm_positions_long_all,noncomm_positions_short_all` +
    `&$where=${encodeURIComponent(
      `report_date_as_yyyy_mm_dd > '${since}' AND market_and_exchange_names in(${names})`,
    )}&$order=${encodeURIComponent("report_date_as_yyyy_mm_dd DESC")}&$limit=400`;

  const res = await fetch(url, { next: { revalidate: 21_600 } }); // 6 hours
  if (!res.ok) throw new Error(`CFTC replied ${res.status}`);
  const rows = (await res.json()) as Row[];
  if (!Array.isArray(rows)) throw new Error("CFTC returned an unexpected shape");

  return tracked
    .map((i) => readingFor(i, rows))
    .filter((r): r is CotReading => r !== null);
}

/** Plain-language read of a positioning number. */
export function describeCot(r: CotReading): string {
  const side = r.net >= 0 ? "long" : "short";
  const strength =
    Math.abs(r.netPct) >= 50
      ? "heavily"
      : Math.abs(r.netPct) >= 20
        ? "net"
        : "marginally";
  const drift =
    r.change === 0
      ? ""
      : Math.sign(r.change) === Math.sign(r.net || 1)
        ? ", and adding"
        : ", but trimming";
  return `Funds ${strength} ${side}${drift}.`;
}
