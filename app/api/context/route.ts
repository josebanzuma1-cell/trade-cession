import { NextResponse } from "next/server";
import { fetchCot } from "@/lib/cot";
import { fetchLevels } from "@/lib/marketdata";

export const runtime = "nodejs";
// Both upstream fetches carry their own revalidate windows (5 minutes for
// prices, 6 hours for the weekly COT), so repeated loads are cheap.
export const revalidate = 300;

export async function GET() {
  // Either source failing is survivable — the page renders whichever half
  // came back rather than showing nothing at all.
  const [levels, cot] = await Promise.all([
    fetchLevels().catch(() => []),
    fetchCot().catch(() => []),
  ]);

  return NextResponse.json(
    { levels, cot, asOf: Date.now() },
    {
      headers: {
        // max-age=0 is load-bearing. Without an explicit browser lifetime a
        // browser applies heuristic caching to a 200 that only carries
        // s-maxage, and will happily re-serve its own stored copy for days.
        // That showed a six-week-old COT report as if it were current, which
        // on a dashboard about institutional positioning is worse than
        // showing nothing. The CDN still absorbs the load via s-maxage.
        "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
