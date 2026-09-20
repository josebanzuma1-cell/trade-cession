const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Chat IDs to notify. Several can be comma-separated. */
export function chatIds(): string[] {
  return (process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendTelegram(text: string): Promise<{ ok: boolean; detail?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, detail: "TELEGRAM_BOT_TOKEN is not set" };

  const targets = chatIds();
  if (targets.length === 0) return { ok: false, detail: "TELEGRAM_CHAT_ID is not set" };

  const results = await Promise.all(
    targets.map(async (chat_id) => {
      try {
        const res = await fetch(`${API}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        });
        if (res.ok) return { ok: true };
        const body = await res.text();
        return { ok: false, detail: `chat ${chat_id}: ${res.status} ${body.slice(0, 200)}` };
      } catch (err) {
        return { ok: false, detail: `chat ${chat_id}: ${(err as Error).message}` };
      }
    }),
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { ok: true };
  return { ok: false, detail: failed.map((f) => f.detail).join("; ") };
}

/* ------------------------------------------------------------------ *
 * Optional de-duplication.
 *
 * The cron buckets already guarantee one alert per event when the
 * scheduler is punctual. Setting an Upstash Redis REST URL and token
 * makes that guarantee hold even when it is not, by claiming each alert
 * key atomically before sending.
 * ------------------------------------------------------------------ */

export function dedupeConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/** True when this key had not been claimed yet — i.e. it is safe to send. */
export async function claim(key: string, ttlSeconds = 7200): Promise<boolean> {
  if (!dedupeConfigured()) return true;
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  try {
    const res = await fetch(
      `${url}/set/${encodeURIComponent(key)}/1?NX=true&EX=${ttlSeconds}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) return true; // never let the de-duplicator suppress an alert
    const body = (await res.json()) as { result: unknown };
    return body.result !== null;
  } catch {
    return true;
  }
}
