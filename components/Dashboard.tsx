"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DAY,
  HOME_TZ,
  MINUTE,
  formatDate,
  formatTime,
  humanDuration,
  partsInZone,
  utcOffsetLabel,
  wallToUtc,
} from "@/lib/tz";
import {
  SESSIONS,
  SESSION_BY_ID,
  activeSessions,
  isWeekendBreak,
  nextPrimeOverlap,
  sessionWindows,
  upcomingEvents,
  type SessionId,
} from "@/lib/sessions";
import MarketContext from "@/components/MarketContext";
import {
  GRADE_STYLE,
  WEEKLY_RHYTHM,
  activeEntryWindows,
  entryInstances,
  nextEntryWindow,
  type EntryInstance,
} from "@/lib/entries";

/** EAT midnight of the day containing `t`. */
function startOfHomeDay(t: number): number {
  const p = partsInZone(t, HOME_TZ);
  return wallToUtc(p.year, p.month, p.day, 0, 0, HOME_TZ);
}

function pct(n: number) {
  return `${(n * 100).toFixed(3)}%`;
}

export default function Dashboard() {
  const [now, setNow] = useState<number | null>(null);
  const [alertsOn, setAlertsOn] = useState(false);
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Recompute the heavy derivations once a minute rather than once a second.
  const minuteKey = now === null ? 0 : Math.floor(now / MINUTE);

  const model = useMemo(() => {
    if (now === null) return null;
    const t = minuteKey * MINUTE;
    // On a weekend the current EAT day has nothing in it, so roll the
    // timeline forward to the next day that actually trades. EAT never
    // shifts, so plain day arithmetic is safe here.
    let dayStart = startOfHomeDay(t);
    for (let i = 0; i < 4 && sessionWindows(dayStart, dayStart + DAY).length === 0; i++) {
      dayStart += DAY;
    }
    const dayEnd = dayStart + DAY;
    return {
      dayStart,
      dayEnd,
      dayIsToday: dayStart === startOfHomeDay(t),
      live: activeSessions(t),
      events: upcomingEvents(t).slice(0, 6),
      windows: sessionWindows(dayStart, dayEnd),
      entries: entryInstances(dayStart, dayEnd),
      liveEntries: activeEntryWindows(t),
      nextEntry: nextEntryWindow(t),
      prime: nextPrimeOverlap(t),
      weekend: isWeekendBreak(t),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteKey, now === null]);

  // Optional in-tab alerting, as a desk companion to the Telegram alerts.
  useEffect(() => {
    if (!alertsOn || now === null || !model) return;
    for (const e of model.events) {
      const key = `${e.id}-${e.kind}-${e.at}`;
      if (e.at - now > 30_000 || e.at < now || firedRef.current.has(key)) continue;
      firedRef.current.add(key);
      const s = SESSION_BY_ID[e.id];
      const title = `${s.name} ${e.kind === "open" ? "is opening" : "is closing"}`;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body: `${formatTime(e.at, HOME_TZ)} EAT — ${s.drives}` });
        }
      } catch {
        /* notifications unavailable in this context */
      }
    }
  }, [now, alertsOn, model]);

  async function toggleAlerts() {
    if (alertsOn) return setAlertsOn(false);
    try {
      if (typeof Notification === "undefined") return;
      const p = await Notification.requestPermission();
      setAlertsOn(p === "granted");
    } catch {
      setAlertsOn(false);
    }
  }

  if (now === null || !model) return <Skeleton />;

  const next = model.events[0];
  const homeParts = partsInZone(now, HOME_TZ);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 sm:px-6">
      {/* ---------- header ---------- */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Session Clock
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Kampala · East Africa Time · UTC+3 all year
          </p>
        </div>
        <div className="text-right">
          <div className="tabular text-3xl font-semibold leading-none sm:text-4xl">
            {String(homeParts.hour).padStart(2, "0")}
            <span style={{ color: "var(--dim)" }}>:</span>
            {String(homeParts.minute).padStart(2, "0")}
            <span className="text-xl" style={{ color: "var(--dim)" }}>
              :{String(homeParts.second).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {formatDate(now, HOME_TZ)}
          </div>
        </div>
      </header>

      {/* ---------- status ---------- */}
      <section className="panel mb-4 p-5">
        {model.weekend ? (
          <div>
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#fca5a5" }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#fca5a5" }} />
              Market closed for the weekend
            </div>
            <p className="mt-3 text-2xl font-semibold">
              Opens in <span className="tabular">{humanDuration(next.at - now)}</span>
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {SESSION_BY_ID[next.id].name} opens {formatDate(next.at, HOME_TZ)} at{" "}
              {formatTime(next.at, HOME_TZ)} EAT. Use the break to review the week.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--dim)" }}>
                Open right now
              </div>
              {model.live.length === 0 ? (
                <p className="text-lg" style={{ color: "var(--muted)" }}>
                  Between sessions — a short daily gap.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {model.live.map((w) => {
                    const s = SESSION_BY_ID[w.id];
                    return (
                      <span
                        key={w.id}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
                        style={{ background: `${s.accent}1a`, color: s.accent, border: `1px solid ${s.accent}40` }}
                      >
                        <span
                          className="live-dot inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: s.accent }}
                        />
                        {s.name}
                        <span className="tabular text-xs" style={{ color: "var(--muted)" }}>
                          closes {humanDuration(w.close - now)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
              {model.live.length >= 2 && (
                <p className="mt-3 text-sm font-medium" style={{ color: "#34d399" }}>
                  Overlap live — deepest liquidity of the day.
                </p>
              )}
            </div>

            <div className="sm:border-l sm:pl-5" style={{ borderColor: "var(--line)" }}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--dim)" }}>
                Next event
              </div>
              <p className="text-2xl font-semibold">
                {SESSION_BY_ID[next.id].name}{" "}
                <span style={{ color: "var(--muted)" }}>{next.kind === "open" ? "opens" : "closes"}</span>
              </p>
              <p className="tabular mt-1 text-lg" style={{ color: "#34d399" }}>
                in {humanDuration(next.at - now)}
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {formatTime(next.at, HOME_TZ)} EAT
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ---------- your prime window today ---------- */}
      {model.prime && (
        <section
          className="mb-4 rounded-2xl p-5"
          style={{
            background: "linear-gradient(135deg, rgba(52,211,153,0.12), rgba(52,211,153,0.03))",
            border: "1px solid rgba(52,211,153,0.28)",
          }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "#34d399" }}>
            Your prime window
          </div>
          <p className="tabular mt-2 text-2xl font-semibold sm:text-3xl">
            {formatTime(model.prime.start, HOME_TZ)} – {formatTime(model.prime.end, HOME_TZ)}{" "}
            <span className="text-base font-normal" style={{ color: "var(--muted)" }}>
              EAT
            </span>
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            London and New York are both open. If you only trade one window a day, trade this
            one — it carries the tightest spreads and the widest range on EURUSD, GBPUSD,
            XAUUSD, US30 and NAS100.
            {model.prime.start > now && (
              <>
                {" "}
                Starts in{" "}
                <span className="tabular font-medium" style={{ color: "#34d399" }}>
                  {humanDuration(model.prime.start - now)}
                </span>
                .
              </>
            )}
          </p>
        </section>
      )}

      {/* ---------- market context ---------- */}
      <MarketContext />

      {/* ---------- 24h timeline ---------- */}
      <section className="panel mb-4 p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {model.dayIsToday ? "Today in EAT" : "Next trading day"}
          </h2>
          <span className="text-xs" style={{ color: "var(--dim)" }}>
            {formatDate(model.dayStart, HOME_TZ)} · 00:00 → 24:00
          </span>
        </div>

        <Timeline
          now={now}
          dayStart={model.dayStart}
          windows={model.windows}
          entries={model.entries}
          showNow={model.dayIsToday}
        />
      </section>

      {/* ---------- sessions ---------- */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        {SESSIONS.map((s) => (
          <SessionCard key={s.id} id={s.id} now={now} dayStart={model.dayStart} />
        ))}
      </section>

      {/* ---------- entry windows ---------- */}
      <section className="panel mb-4 p-5">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Entry windows
            {!model.dayIsToday && (
              <span className="ml-2 font-normal" style={{ color: "var(--dim)" }}>
                {formatDate(model.dayStart, HOME_TZ)}
              </span>
            )}
          </h2>
          {model.nextEntry && model.nextEntry.startAt > now && (
            <span className="tabular text-xs" style={{ color: "var(--muted)" }}>
              next strong window in {humanDuration(model.nextEntry.startAt - now)}
            </span>
          )}
        </div>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
          Times shown in EAT, but anchored to each market&rsquo;s own clock — they shift by an
          hour when London or New York changes for daylight saving, and this page follows that
          automatically.
        </p>

        <div className="space-y-2.5">
          {model.entries.map((e) => (
            <EntryCard key={`${e.id}-${e.startAt}`} entry={e} now={now} />
          ))}
        </div>
      </section>

      {/* ---------- weekly rhythm ---------- */}
      <section className="panel mb-4 p-5">
        <h2 className="mb-4 text-sm font-semibold">The week</h2>
        <div className="space-y-2">
          {WEEKLY_RHYTHM.map((d) => {
            const isToday =
              new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, weekday: "long" }).format(
                new Date(now),
              ) === d.day;
            const g = GRADE_STYLE[d.grade];
            return (
              <div
                key={d.day}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                style={{
                  background: isToday ? "rgba(52,211,153,0.07)" : "transparent",
                  border: `1px solid ${isToday ? "rgba(52,211,153,0.25)" : "transparent"}`,
                }}
              >
                <span
                  className="mt-0.5 w-9 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold"
                  style={{ background: g.bg, color: g.fg }}
                >
                  {d.grade === "avoid" ? "—" : d.grade}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium">
                    {d.day}
                    {isToday && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#34d399" }}>
                        today
                      </span>
                    )}
                  </span>
                  <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {d.note}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- alerts ---------- */}
      <section className="panel p-5">
        <h2 className="mb-3 text-sm font-semibold">Alerts</h2>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          Session alerts are delivered to Telegram by a scheduled job, so they reach your phone
          whether or not this page is open. See <code className="text-[11px]">README.md</code> for
          the one-time bot setup.
        </p>
        <button
          onClick={toggleAlerts}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: alertsOn ? "rgba(52,211,153,0.15)" : "var(--panel-2)",
            border: `1px solid ${alertsOn ? "rgba(52,211,153,0.4)" : "var(--line)"}`,
            color: alertsOn ? "#34d399" : "var(--text)",
          }}
        >
          {alertsOn ? "Desk alerts on" : "Also alert me in this tab"}
        </button>
      </section>

      <footer className="mt-8 text-center text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        Session boundaries follow the common retail-forex convention and may differ from your
        broker&rsquo;s server time by an hour. Nothing here is financial advice.
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function Timeline({
  now,
  dayStart,
  windows,
  entries,
  showNow,
}: {
  now: number;
  dayStart: number;
  windows: ReturnType<typeof sessionWindows>;
  entries: EntryInstance[];
  showNow: boolean;
}) {
  const span = DAY;
  const nowPos = Math.min(1, Math.max(0, (now - dayStart) / span));
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const graded = entries.filter((e) => e.grade === "A+" || e.grade === "A" || e.grade === "avoid");

  return (
    <div>
      <div className="relative">
        {/* session rows */}
        <div className="space-y-1.5">
          {SESSIONS.map((s) => {
            const mine = windows.filter((w) => w.id === s.id);
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
                  {s.name}
                </span>
                <div
                  className="relative h-5 flex-1 overflow-hidden rounded"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  {mine.map((w) => {
                    const a = Math.max(0, (w.open - dayStart) / span);
                    const b = Math.min(1, (w.close - dayStart) / span);
                    if (b <= a) return null;
                    const live = w.open <= now && now < w.close;
                    return (
                      <div
                        key={w.open}
                        className="absolute inset-y-0 rounded"
                        style={{
                          left: pct(a),
                          width: pct(b - a),
                          background: live ? s.accent : `${s.accent}45`,
                          boxShadow: live ? `0 0 14px ${s.accent}55` : "none",
                        }}
                        title={`${s.name} ${formatTime(w.open, HOME_TZ)}–${formatTime(w.close, HOME_TZ)} EAT`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* graded entry row */}
          <div className="flex items-center gap-2 pt-1">
            <span className="w-16 shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
              Entries
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded" style={{ background: "rgba(255,255,255,0.03)" }}>
              {graded.map((e) => {
                const a = Math.max(0, (e.startAt - dayStart) / span);
                const b = Math.min(1, (e.endAt - dayStart) / span);
                if (b <= a) return null;
                const g = GRADE_STYLE[e.grade];
                return (
                  <div
                    key={`${e.id}-${e.startAt}`}
                    className="absolute inset-y-0 rounded"
                    style={{ left: pct(a), width: pct(b - a), background: g.bg, opacity: 0.85 }}
                    title={`${e.label} · ${formatTime(e.startAt, HOME_TZ)}–${formatTime(e.endAt, HOME_TZ)} EAT`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* now marker spanning all rows */}
        {showNow && (
          <div className="pointer-events-none absolute inset-y-0 left-16 right-0">
            <div className="relative h-full" style={{ marginLeft: 8 }}>
              <div
                className="absolute -top-1 bottom-0 w-px"
                style={{ left: pct(nowPos), background: "#f8fafc", boxShadow: "0 0 8px rgba(248,250,252,0.7)" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* hour axis */}
      <div className="mt-2 flex gap-2">
        <span className="w-16 shrink-0" />
        <div className="relative h-4 flex-1">
          {hours.map((h) => (
            <span
              key={h}
              className="tabular absolute text-[10px]"
              style={{ left: pct(h / 24), color: "var(--dim)", transform: "translateX(-50%)" }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ id, now, dayStart }: { id: SessionId; now: number; dayStart: number }) {
  const s = SESSION_BY_ID[id];
  const all = sessionWindows(dayStart, dayStart + DAY).filter((w) => w.id === id);
  const live = all.find((w) => w.open <= now && now < w.close);
  // Prefer the window that actually begins on this day. In the northern
  // winter New York runs until 01:00 EAT, so the previous session spills
  // into today and would otherwise be the one shown.
  const today = [all.find((w) => w.open >= dayStart) ?? all[0]].filter(Boolean);
  const upcoming = upcomingEvents(now).find((e) => e.id === id && e.kind === "open");

  return (
    <div className="panel p-4" style={{ borderColor: live ? `${s.accent}55` : "var(--line)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: live ? s.accent : "#334155" }} />
            <h3 className="text-sm font-semibold">{s.name}</h3>
            {live && (
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.accent }}>
                live
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            {s.blurb}
          </p>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--dim)" }}>
            Drives {s.drives}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {today[0] && (
            <div className="tabular text-sm font-medium">
              {formatTime(today[0].open, HOME_TZ)}
              <span style={{ color: "var(--dim)" }}> – </span>
              {formatTime(today[0].close, HOME_TZ)}
            </div>
          )}
          <div className="text-[10px]" style={{ color: "var(--dim)" }}>
            EAT
          </div>
          <div className="tabular mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
            {s.open[0].toString().padStart(2, "0")}:00 local ·{" "}
            {utcOffsetLabel(now, s.tz)}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t pt-2.5 text-[11px]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        {live ? (
          <>
            Closes in <span className="tabular" style={{ color: s.accent }}>{humanDuration(live.close - now)}</span>
          </>
        ) : upcoming ? (
          <>
            Opens in <span className="tabular">{humanDuration(upcoming.at - now)}</span> ·{" "}
            {formatDate(upcoming.at, HOME_TZ)}
          </>
        ) : (
          "Closed"
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry, now }: { entry: EntryInstance; now: number }) {
  const [open, setOpen] = useState(false);
  const g = GRADE_STYLE[entry.grade];
  const live = entry.startAt <= now && now < entry.endAt;
  const past = entry.endAt <= now;

  return (
    <div
      className="panel-2 overflow-hidden transition-opacity"
      style={{
        opacity: past ? 0.4 : 1,
        borderColor: live ? `${g.bg}66` : "var(--line)",
        background: live ? `${g.bg}12` : "var(--panel-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span
          className="w-12 shrink-0 rounded px-1.5 py-1 text-center text-[10px] font-bold"
          style={{ background: g.bg, color: g.fg }}
        >
          {entry.grade === "avoid" ? "SKIP" : entry.grade}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{entry.label}</span>
            {live && (
              <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.bg }} />
            )}
          </span>
          <span className="tabular mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
            {formatTime(entry.startAt, HOME_TZ)} – {formatTime(entry.endAt, HOME_TZ)} EAT
            {!past && !live && <> · in {humanDuration(entry.startAt - now)}</>}
            {live && <> · {humanDuration(entry.endAt - now)} left</>}
          </span>
        </span>
        <span className="shrink-0 text-xs" style={{ color: "var(--dim)" }}>
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-3.5 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--line)" }}>
          {entry.instruments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.instruments.map((i) => (
                <span
                  key={i}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted)" }}
                >
                  {i}
                </span>
              ))}
            </div>
          )}
          <Field label="What happens" body={entry.behaviour} />
          <Field label="How to play it" body={entry.play} accent="#34d399" />
          <Field label="What catches people" body={entry.caution} accent="#fca5a5" />
        </div>
      )}
    </div>
  );
}

function Field({ label, body, accent }: { label: string; body: string; accent?: string }) {
  return (
    <div>
      <div
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: accent ?? "var(--dim)" }}
      >
        {label}
      </div>
      <p style={{ color: "var(--muted)" }}>{body}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
      <div className="mb-6 h-12 w-48 animate-pulse rounded" style={{ background: "var(--panel)" }} />
      <div className="mb-4 h-32 animate-pulse rounded-2xl" style={{ background: "var(--panel)" }} />
      <div className="mb-4 h-48 animate-pulse rounded-2xl" style={{ background: "var(--panel)" }} />
    </main>
  );
}
