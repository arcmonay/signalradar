"use client";

import { useEffect, useState } from "react";

type Quote = {
  symbol: string;
  label?: string;
  name: string;
  price: number | null;
  changePct: number | null;
  relativeVolume: number | null;
  volume: number | null;
};

type Idea = {
  id: string;
  title: string;
  confidence: number;
  bias: "long" | "short" | "neutral";
  reasons: string[];
  symbol?: string;
};

type PoliticalTrade = {
  id: string;
  filer: string;
  ticker: string | null;
  asset: string;
  side: string;
  amount: string;
  tradeDate: string;
  filingDate: string;
  lagDays: number | null;
  late: boolean;
  highlight: string;
  docUrl: string | null;
};

type EarningsRow = {
  symbol: string;
  name: string;
  earningsDate: string;
  daysUntil: number;
  changePct: number | null;
  preMove4d: number | null;
  relativeVolume: number | null;
  inWindow: boolean;
};

type FinvizRow = {
  symbol: string;
  company: string;
  sector: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  url: string;
};

type FinvizSector = {
  name: string;
  changePct: number | null;
  perfWeek: number | null;
  volume: string;
  marketCap: string;
};

type Snapshot = {
  asOf: string;
  latencyMs: number;
  source: string;
  disclaimer: string;
  indexes: Quote[];
  sectors: Quote[];
  gainers: Quote[];
  unusualVolume: Quote[];
  earnings: EarningsRow[];
  political: {
    recent: PoliticalTrade[];
    pelosi: PoliticalTrade[];
    trump: PoliticalTrade[];
  };
  finviz?: {
    ok: boolean;
    error?: string;
    unusualVolume: FinvizRow[];
    gainers: FinvizRow[];
    losers: FinvizRow[];
    mostActive: FinvizRow[];
    earningsThisWeek: FinvizRow[];
    sectors: FinvizSector[];
    news: Array<{ title: string; url: string }>;
  };
  ideas: Idea[];
  flow: {
    note: string;
    leadership: string;
    relativeNqMinusEs: number | null;
    series: Record<
      string,
      {
        symbol: string;
        last: number | null;
        changePct: number | null;
        cvd: number | null;
        aggression: number | null;
        regime: string;
        bars: Array<{ t: number; close: number; cvd: number }>;
      }
    >;
  };
};

const REFRESH_MS = 20_000;

export default function Terminal() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pelosi" | "trump" | "recent">("pelosi");
  const [fvTab, setFvTab] = useState<
    "unusual" | "gainers" | "losers" | "active" | "earnings"
  >("unusual");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch("/api/snapshot", { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = (await res.json()) as Snapshot;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, REFRESH_MS);
        }
      }
    }

    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const politicalRows =
    tab === "pelosi"
      ? data?.political.pelosi ?? []
      : tab === "trump"
        ? data?.political.trump ?? []
        : data?.political.recent ?? [];

  const finvizRows =
    fvTab === "unusual"
      ? data?.finviz?.unusualVolume ?? []
      : fvTab === "gainers"
        ? data?.finviz?.gainers ?? []
        : fvTab === "losers"
          ? data?.finviz?.losers ?? []
          : fvTab === "active"
            ? data?.finviz?.mostActive ?? []
            : data?.finviz?.earningsThisWeek ?? [];

  return (
    <div className="terminal">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SR</span>
          <div>
            <h1>SignalRadar</h1>
            <p>Free near-realtime market intelligence</p>
          </div>
        </div>
        <div className="status">
          <span className={`dot ${error ? "bad" : "ok"}`} />
          <div className="status-copy">
            <strong>{error ? "Feed error" : loading ? "Connecting…" : "Live polling"}</strong>
            <span>
              {data
                ? `${fmtTime(data.asOf)} · ${data.latencyMs}ms · refresh ${REFRESH_MS / 1000}s`
                : "Yahoo + Finviz + political disclosures"}
            </span>
          </div>
        </div>
      </header>

      {error && !data ? (
        <div className="banner bad">{error}</div>
      ) : null}

      <section className="index-strip">
        {(data?.indexes ?? placeholders(9)).map((q) => (
          <article key={q.symbol} className="index-card">
            <div className="muted">{q.label ?? q.symbol}</div>
            <div className="sym">{q.symbol}</div>
            <div className="price">{fmtPrice(q.price)}</div>
            <div className={pctClass(q.changePct)}>{fmtPct(q.changePct)}</div>
          </article>
        ))}
      </section>

      <div className="grid-main">
        <section className="panel span-2">
          <PanelHead
            title="AI confluence ideas"
            sub="Scored from index flow proxy + unusual volume + pre-earnings + political disclosures"
          />
          <div className="ideas">
            {(data?.ideas ?? []).length === 0 && loading ? (
              <p className="muted pad">Building first snapshot…</p>
            ) : (
              (data?.ideas ?? []).map((idea) => (
                <article key={idea.id} className="idea">
                  <div className="idea-top">
                    <div>
                      <div className="idea-title">{idea.title}</div>
                      <div className="muted">
                        {idea.symbol ?? "MULTI"} · {idea.bias.toUpperCase()}
                      </div>
                    </div>
                    <div className={`confidence c-${bucket(idea.confidence)}`}>
                      {idea.confidence}%
                    </div>
                  </div>
                  <ul>
                    {idea.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHead title="Index orderflow proxy" sub={data?.flow.note} />
          <div className="flow-lead">
            <div>
              <div className="muted">Leadership</div>
              <strong>{data?.flow.leadership ?? "—"}</strong>
            </div>
            <div>
              <div className="muted">NQ − ES (session)</div>
              <strong className={pctClass(data?.flow.relativeNqMinusEs ?? null)}>
                {fmtPct(data?.flow.relativeNqMinusEs ?? null, true)}
              </strong>
            </div>
          </div>
          <div className="flow-grid">
            {["ES=F", "NQ=F", "SPY", "QQQ"].map((sym) => {
              const s = data?.flow.series[sym];
              return (
                <article key={sym} className="flow-card">
                  <div className="flow-head">
                    <strong>{sym}</strong>
                    <span className={pctClass(s?.changePct ?? null)}>
                      {fmtPct(s?.changePct ?? null)}
                    </span>
                  </div>
                  <Spark
                    values={(s?.bars ?? []).map((b) => b.close)}
                    positive={(s?.changePct ?? 0) >= 0}
                  />
                  <div className="muted small">
                    CVD {fmtNum(s?.cvd)} · aggr{" "}
                    {s?.aggression != null ? s.aggression.toFixed(2) : "—"}
                  </div>
                  <div className="regime">{s?.regime ?? "—"}</div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <PanelHead title="Sector rotation" sub="Sector ETF session performance" />
          <div className="sector-list">
            {(data?.sectors ?? []).map((s) => (
              <div key={s.symbol} className="sector-row">
                <div>
                  <strong>{s.symbol}</strong>
                  <span className="muted"> {s.label}</span>
                </div>
                <div className="sector-right">
                  <span>{fmtPrice(s.price)}</span>
                  <span className={pctClass(s.changePct)}>{fmtPct(s.changePct)}</span>
                </div>
                <div
                  className={`heat ${ (s.changePct ?? 0) >= 0 ? "up" : "down"}`}
                  style={{
                    width: `${Math.min(100, Math.abs(s.changePct ?? 0) * 28)}%`,
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelHead
            title="Unusual volume"
            sub="Most-actives with RVOL ≥ 1.5x (free Yahoo screener)"
          />
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Last</th>
                <th>Chg</th>
                <th>RVOL</th>
              </tr>
            </thead>
            <tbody>
              {(data?.unusualVolume ?? []).map((q) => (
                <tr key={q.symbol}>
                  <td>{q.symbol}</td>
                  <td>{fmtPrice(q.price)}</td>
                  <td className={pctClass(q.changePct)}>{fmtPct(q.changePct)}</td>
                  <td>{q.relativeVolume?.toFixed(2) ?? "—"}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel span-2">
          <PanelHead
            title="Pre-earnings radar (T−4…T−1)"
            sub="Watchlist names with earnings in the next 7 days · 4-day pre-move highlighted"
          />
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Days</th>
                <th>Report</th>
                <th>Today</th>
                <th>4d pre-move</th>
                <th>RVOL</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {(data?.earnings ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No watchlist names reporting in the next 7 days (or still loading).
                  </td>
                </tr>
              ) : (
                data!.earnings.map((e) => (
                  <tr key={e.symbol} className={e.inWindow ? "highlight-row" : undefined}>
                    <td>
                      <strong>{e.symbol}</strong>
                    </td>
                    <td>T−{e.daysUntil}</td>
                    <td>{fmtDate(e.earningsDate)}</td>
                    <td className={pctClass(e.changePct)}>{fmtPct(e.changePct)}</td>
                    <td className={pctClass(e.preMove4d)}>{fmtPct(e.preMove4d)}</td>
                    <td>{e.relativeVolume?.toFixed(2) ?? "—"}x</td>
                    <td>{e.inWindow ? "ACTIVE" : "soon"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="panel span-2">
          <div className="panel-head row">
            <div>
              <h2>Political / OGE flow</h2>
              <p>Pelosi PTRs + Trump 278-T + recent Congress trades (public disclosures, lagged)</p>
            </div>
            <div className="tabs">
              {([
                ["pelosi", "Pelosi"],
                ["trump", "Trump"],
                ["recent", "Congress"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={tab === id ? "active" : undefined}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Filer</th>
                <th>Ticker</th>
                <th>Side</th>
                <th>Amount</th>
                <th>Trade</th>
                <th>Filed</th>
                <th>Lag</th>
              </tr>
            </thead>
            <tbody>
              {politicalRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No rows for this tab yet.
                  </td>
                </tr>
              ) : (
                politicalRows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.docUrl ? (
                        <a href={t.docUrl} target="_blank" rel="noreferrer">
                          {t.filer}
                        </a>
                      ) : (
                        t.filer
                      )}
                    </td>
                    <td>{t.ticker ?? "—"}</td>
                    <td>{t.side}</td>
                    <td>{t.amount}</td>
                    <td>{t.tradeDate}</td>
                    <td>{t.filingDate}</td>
                    <td className={t.late ? "bad-text" : undefined}>
                      {t.lagDays != null ? `${t.lagDays}d` : "—"}
                      {t.late ? " late" : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <PanelHead title="Yahoo session gainers" sub="Yahoo day_gainers screener" />
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Chg</th>
                <th>RVOL</th>
              </tr>
            </thead>
            <tbody>
              {(data?.gainers ?? []).map((q) => (
                <tr key={q.symbol}>
                  <td>{q.symbol}</td>
                  <td className={pctClass(q.changePct)}>{fmtPct(q.changePct)}</td>
                  <td>{q.relativeVolume?.toFixed(2) ?? "—"}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel span-2">
          <div className="panel-head row">
            <div>
              <h2>Finviz screens</h2>
              <p>
                Free Finviz HTML screens ·{" "}
                {data?.finviz?.ok
                  ? "connected"
                  : data?.finviz?.error ?? "loading"}
              </p>
            </div>
            <div className="tabs">
              {(
                [
                  ["unusual", "Unusual Vol"],
                  ["gainers", "Gainers"],
                  ["losers", "Losers"],
                  ["active", "Most Active"],
                  ["earnings", "EA Week"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={fvTab === id ? "active" : undefined}
                  onClick={() => setFvTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Sector</th>
                <th>Price</th>
                <th>Chg</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {finvizRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No Finviz rows yet (page may be rate-limiting).
                  </td>
                </tr>
              ) : (
                finvizRows.slice(0, 15).map((r) => (
                  <tr key={`${fvTab}-${r.symbol}`}>
                    <td>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.symbol}
                      </a>
                    </td>
                    <td>{r.company}</td>
                    <td>{r.sector}</td>
                    <td>{fmtPrice(r.price)}</td>
                    <td className={pctClass(r.changePct)}>{fmtPct(r.changePct)}</td>
                    <td>{fmtNum(r.volume)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <PanelHead
            title="Finviz sector groups"
            sub="Sector overview ranked by session change"
          />
          <div className="sector-list">
            {(data?.finviz?.sectors ?? []).map((s) => (
              <div key={s.name} className="sector-row">
                <div>
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {" "}
                    {s.perfWeek != null ? `W ${fmtPct(s.perfWeek)}` : ""}
                  </span>
                </div>
                <div className="sector-right">
                  <span className="muted">{s.volume}</span>
                  <span className={pctClass(s.changePct)}>{fmtPct(s.changePct)}</span>
                </div>
                <div
                  className={`heat ${(s.changePct ?? 0) >= 0 ? "up" : "down"}`}
                  style={{
                    width: `${Math.min(100, Math.abs(s.changePct ?? 0) * 28)}%`,
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="panel span-2">
          <PanelHead title="Finviz news wire" sub="Headlines aggregated on Finviz News" />
          <ul className="news-list">
            {(data?.finviz?.news ?? []).slice(0, 12).map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="foot">
        <p>{data?.disclaimer}</p>
        <p>
          Source: {data?.source}. Separate product from Undercutters. Free data ≠
          institutional tick/DOM.
        </p>
      </footer>
    </div>
  );
}

function PanelHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      {sub ? <p>{sub}</p> : null}
    </div>
  );
}

function Spark({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return <div className="spark empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 36;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className={`spark ${positive ? "up" : "down"}`} viewBox={`0 0 ${w} ${h}`} width="100%" height="36">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function placeholders(n: number): Quote[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: "—",
    label: "Loading",
    name: "",
    price: null,
    changePct: null,
    relativeVolume: null,
    volume: null,
  }));
}

function fmtPrice(v: number | null | undefined) {
  if (v == null) return "—";
  return v >= 1000 ? v.toFixed(1) : v.toFixed(2);
}

function fmtPct(v: number | null | undefined, signed = true) {
  if (v == null) return "—";
  const s = `${v >= 0 && signed ? "+" : ""}${v.toFixed(2)}%`;
  return s;
}

function fmtNum(v: number | null | undefined) {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function pctClass(v: number | null | undefined) {
  if (v == null) return "muted";
  if (v > 0.01) return "up";
  if (v < -0.01) return "down";
  return "muted";
}

function bucket(n: number) {
  if (n >= 80) return "hi";
  if (n >= 65) return "mid";
  return "lo";
}
