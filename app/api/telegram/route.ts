import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Setup helper: send your bot a message, then open this route to read back
 * the chat ID to put in TELEGRAM_CHAT_ID. It only reports IDs that have
 * already messaged the bot, and it never sends anything.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const supplied = new URL(req.url).searchParams.get("key") ?? "";
    if (supplied !== secret) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 500 });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Telegram replied ${res.status}`, detail: (await res.text()).slice(0, 300) },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    result?: { message?: { chat?: { id: number; type: string; first_name?: string; title?: string } } }[];
  };

  const chats = new Map<number, { id: number; type: string; name: string }>();
  for (const update of data.result ?? []) {
    const chat = update.message?.chat;
    if (chat) {
      chats.set(chat.id, {
        id: chat.id,
        type: chat.type,
        name: chat.title ?? chat.first_name ?? "",
      });
    }
  }

  const found = [...chats.values()];
  return NextResponse.json({
    found,
    next:
      found.length > 0
        ? `Set TELEGRAM_CHAT_ID to ${found.map((c) => c.id).join(",")}`
        : "Send your bot a message in Telegram first, then reload this page.",
  });
}
