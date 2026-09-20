import type { CotReading } from "./cot";
import { describeCot } from "./cot";
import { SWEEP_COPY, type Levels } from "./marketdata";
import type { SessionId } from "./sessions";

/**
 * The market-context footer appended to a session alert.
 *
 * Which instruments matter depends on which desk is opening: London drives
 * the European crosses and gold, New York adds the indices, Tokyo is a yen
 * story, and Sydney has nothing here worth reporting.
 */
const FOCUS: Record<SessionId, string[]> = {
  sydney: [],
  tokyo: ["USDJPY"],
  london: ["EURUSD", "GBPUSD", "XAUUSD"],
  newyork: ["XAUUSD", "US30", "NAS100"],
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number | null, digits: number): string {
  return n == null ? "—" : n.toFixed(digits);
}

/**
 * Returns an HTML fragment to append to an alert, or an empty string when
 * there is nothing worth saying. Callers treat this as best-effort: an alert
 * must still go out when the price feed is down, so this never throws.
 */
export function buildContextBlock(
  session: SessionId,
  levels: Levels[],
  cot: CotReading[],
): string {
  const ids = FOCUS[session];
  if (ids.length === 0) return "";

  const lines: string[] = [];

  for (const id of ids) {
    const l = levels.find((x) => x.id === id);
    if (!l || l.price == null || l.stale) continue;

    const parts = [`<b>${esc(l.label)}</b> <code>${fmt(l.price, l.digits)}</code>`];

    if (l.asianHigh != null && l.asianLow != null && l.asianComplete) {
      parts.push(
        `Asian <code>${fmt(l.asianLow, l.digits)}–${fmt(l.asianHigh, l.digits)}</code>`,
      );
    }
    let line = parts.join("  ·  ");

    if (l.sweep && l.sweep !== "pending" && l.sweep !== "inside") {
      line += `\n   ↳ ${esc(SWEEP_COPY[l.sweep].label)}`;
    }

    const c = cot.find((x) => x.id === id);
    if (c) line += `\n   ↳ ${esc(describeCot(c))}`;

    lines.push(line);
  }

  if (lines.length === 0) return "";

  return [
    "",
    "━━━━━━━━━━━━━━",
    "📊 <b>Context</b>",
    ...lines,
    "",
    `<i>Positioning is the CFTC weekly report${
      cot[0] ? ` (${esc(cot[0].reportDate)})` : ""
    } — a standing stance, not an entry signal. Levels are live.</i>`,
  ].join("\n");
}
