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
        "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
