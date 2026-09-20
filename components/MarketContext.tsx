"use client";

import { useEffect, useState } from "react";
import type { CotReading } from "@/lib/cot";
import { SWEEP_COPY, type Levels } from "@/lib/marketdata";

interface Payload {
  levels: Levels[];
  cot: CotReading[];
  asOf: number;
}

const TONE = {
  up: "#34d399",
  down: "#fca5a5",
  neutral: "#8b9ab3",
} as const;

export default function MarketContext() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/context")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Payload) => alive && setData(d))
        .catch(() => alive && setFailed(true));
    load();
    const id = setInterval(load, 300_000); // refresh every 5 minutes
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (failed) {
    return (
      <section className="panel mb-4 p-5">
        <h2 className="mb-2 text-sm font-semibold">Market context</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Price and positioning data are unavailable right now. The session clock and
          alerts above are unaffected — they do not depend on this.
        </p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel mb-4 p-5">
        <div className="h-4 w-36 animate-pulse rounded" style={{ background: "var(--panel-2)" }} />
        <div className="mt-4 h-24 animate-pulse rounded" style={{ background: "var(--panel-2)" }} />
      </section>
    );
  }

  const fmt = (n: number | null, d: number) => (n == null ? "—" : n.toFixed(d));

  return (
    <section className="panel mb-4 p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Market context</h2>
        {data.cot[0] && (
          <span className="text-[11px]" style={{ color: "var(--dim)" }}>
            positioning as of {data.cot[0].reportDate}
          </span>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        What is actually knowable, rather than inferred. Levels are live prices; positioning
        is the CFTC&rsquo;s weekly report of what large speculators really hold. Neither is a
        buy or sell signal.
      </p>

      <div className="space-y-2.5">
        {data.levels.map((l) => {
          const c = data.cot.find((x) => x.id === l.id);
          const sweep = l.sweep && l.sweep !== "pending" ? SWEEP_COPY[l.sweep] : null;
          return (
            <div key={l.id} className="panel-2 px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{l.label}</span>
                <span className="tabular text-sm">
                  {fmt(l.price, l.digits)}
                  {l.stale && (
                    <span className="ml-2 text-[10px]" style={{ color: "var(--dim)" }}>
                      market closed
                    </span>
                  )}
                </span>
              </div>

              <div className="tabular mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
                {l.asianHigh != null && (
                  <span>
                    Asian {fmt(l.asianLow, l.digits)} – {fmt(l.asianHigh, l.digits)}
                  </span>
                )}
                {l.prevHigh != null && (
                  <span>
                    Prev day {fmt(l.prevLow, l.digits)} – {fmt(l.prevHigh, l.digits)}
                  </span>
                )}
              </div>

              {sweep && (
                <div className="mt-2 text-[11px] leading-relaxed">
                  <span className="font-medium" style={{ color: TONE[sweep.tone] }}>
                    {sweep.label}
                  </span>
                  <span style={{ color: "var(--muted)" }}> — {sweep.note}</span>
                </div>
              )}

              {c && (
                <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
                  <PositionBar pct={c.netPct} />
                  <span className="tabular text-[11px]" style={{ color: "var(--muted)" }}>
                    {c.netPct > 0 ? "+" : ""}
                    {c.netPct}% net {c.net >= 0 ? "long" : "short"}
                    <span style={{ color: "var(--dim)" }}>
                      {" "}
                      · {c.change > 0 ? "+" : ""}
                      {c.change.toLocaleString()} on the week
                    </span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--dim)" }}>
        Positioning is reported weekly and is several days old by the time you read it. It
        tells you where large money already sits, never when to enter. There is no free feed
        of live institutional order flow — anything claiming otherwise is inferring it from
        the same candles you already have.
      </p>
    </section>
  );
}

/** Net positioning as a bar running left (short) to right (long) from centre. */
function PositionBar({ pct }: { pct: number }) {
  const w = Math.min(50, Math.abs(pct) / 2);
  const long = pct >= 0;
  return (
    <div
      className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-full"
      style={{ background: "rgba(255,255,255,0.06)" }}
      title={`${pct}% net ${long ? "long" : "short"}`}
    >
      <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--line)" }} />
      <div
        className="absolute inset-y-0"
        style={{
          left: long ? "50%" : `${50 - w}%`,
          width: `${w}%`,
          background: long ? "#34d399" : "#fca5a5",
        }}
      />
    </div>
  );
}
