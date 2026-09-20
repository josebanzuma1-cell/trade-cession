import { NextResponse } from "next/server";
import { dueAlerts } from "@/lib/alerts";
import { MINUTE, HOME_TZ, formatTime } from "@/lib/tz";
import { claim, dedupeConfigured, sendTelegram, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // With no secret set the endpoint is open, which is fine for a private
  // deployment but worth closing before sharing the URL.
  if (!secret) return true;
  const url = new URL(req.url);
  const supplied =
    url.searchParams.get("key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return supplied === secret;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const now = Date.now();

  if (url.searchParams.get("test") === "1") {
    const result = await sendTelegram(
      "✅ <b>Session Clock is connected</b>\n\nYou will get a heads-up before each session opens, and again as it opens.",
    );
    return NextResponse.json({ test: true, ...result });
  }

  const intervalMs = Number(process.env.CRON_INTERVAL_MINUTES ?? 5) * MINUTE;
  const leadMs = Number(process.env.ALERT_LEAD_MINUTES ?? 15) * MINUTE;

  const due = dueAlerts(now, intervalMs, leadMs);

  const sent: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  if (!dry) {
    if (!telegramConfigured()) {
      return NextResponse.json(
        { error: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set" },
        { status: 500 },
      );
    }
    for (const alert of due) {
      if (!(await claim(alert.key))) {
        skipped.push(alert.key);
        continue;
      }
      const res = await sendTelegram(alert.text);
      if (res.ok) sent.push(alert.key);
      else errors.push(`${alert.key}: ${res.detail}`);
    }
  }

  return NextResponse.json(
    {
      now: formatTime(now, HOME_TZ) + " EAT",
      bucketMinutes: intervalMs / MINUTE,
      leadMinutes: leadMs / MINUTE,
      dedupe: dedupeConfigured() ? "upstash" : "bucket-only",
      due: due.map((d) => ({ key: d.key, at: formatTime(d.at, HOME_TZ) + " EAT" })),
      ...(dry ? { dryRun: true } : { sent, skipped, errors }),
    },
    { status: errors.length ? 207 : 200 },
  );
}
