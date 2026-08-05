import { NextResponse } from "next/server";
import { getFinvizBundle, type FinvizBundle } from "@/lib/finviz";
import yf, { toQuoteRow, type QuoteRow } from "@/lib/yahoo";
import {
  EARNINGS_WATCHLIST,
  INDEX_PROXIES,
  SECTOR_ETFS,
} from "@/lib/universe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FlowPoint = {
  t: number;
  close: number;
  volume: number;
  signedVolume: number;
  cvd: number;
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
  branch: string;
  chamber: string | null;
  party: string | null;
  docUrl: string | null;
  highlight: "pelosi" | "trump" | "congress" | "executive";
};

type EarningsRow = {
  symbol: string;
  name: string;
  earningsDate: string;
  daysUntil: number;
  price: number | null;
  changePct: number | null;
  preMove4d: number | null;
  relativeVolume: number | null;
  inWindow: boolean;
};

export async function GET() {
  const started = Date.now();

  const indexSymbols = INDEX_PROXIES.map((x) => x.symbol);
  const sectorSymbols = SECTOR_ETFS.map((x) => x.symbol);

  const [quotesRaw, gainers, actives, political, flow, earnings, finviz] =
    await Promise.all([
      safeQuotes([...indexSymbols, ...sectorSymbols]),
      safeScreener("day_gainers", 15),
      safeScreener("most_actives", 20),
      safePolitical(),
      safeIndexFlow(),
      safeEarnings(),
      getFinvizBundle(),
    ]);

  const bySymbol = new Map(quotesRaw.map((q) => [q.symbol, q]));

  const indexes = INDEX_PROXIES.map((meta) => ({
    ...meta,
    ...(bySymbol.get(meta.symbol) ?? emptyQuote(meta.symbol, meta.label)),
  }));

  const sectors = SECTOR_ETFS.map((meta) => ({
    ...meta,
    ...(bySymbol.get(meta.symbol) ?? emptyQuote(meta.symbol, meta.label)),
  })).sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));

  const unusualVolume = actives
    .filter((q) => (q.relativeVolume ?? 0) >= 1.5)
    .sort((a, b) => (b.relativeVolume ?? 0) - (a.relativeVolume ?? 0))
    .slice(0, 12);

  const ideas = buildIdeas({
    indexes,
    sectors,
    unusualVolume,
    gainers,
    earnings,
    political,
    flow,
    finviz,
  });

  return NextResponse.json({
    asOf: new Date().toISOString(),
    latencyMs: Date.now() - started,
    source:
      "Yahoo Finance + Finviz (free HTML screens) + Kadoa Congress/OGE public dataset",
    disclaimer:
      "Free feeds are near-realtime during RTH and may be delayed. Not investment advice. Political filings are lagged disclosures. Finviz is scraped from public pages and can rate-limit.",
    indexes,
    sectors,
    gainers: gainers.slice(0, 12),
    unusualVolume,
    flow,
    earnings,
    political,
    finviz,
    ideas,
  });
}

function emptyQuote(symbol: string, name: string): QuoteRow {
  return {
    symbol,
    name,
    price: null,
    change: null,
    changePct: null,
    volume: null,
    avgVolume: null,
    relativeVolume: null,
    marketState: null,
  };
}

async function safeQuotes(symbols: string[]): Promise<QuoteRow[]> {
  try {
    const raw = await yf.quote(symbols);
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((q) => toQuoteRow(q as unknown as Record<string, unknown>));
  } catch (e) {
    console.error("quote error", e);
    return [];
  }
}

async function safeScreener(scrIds: string, count: number): Promise<QuoteRow[]> {
  try {
    const res = await yf.screener({ scrIds: scrIds as never, count });
    const quotes = (res.quotes ?? []) as unknown as Record<string, unknown>[];
    return quotes.map(toQuoteRow);
  } catch (e) {
    console.error("screener error", scrIds, e);
    return [];
  }
}

async function safeIndexFlow() {
  const symbols = ["ES=F", "NQ=F", "SPY", "QQQ"] as const;
  const out: Record<
    string,
    {
      symbol: string;
      last: number | null;
      changePct: number | null;
      cvd: number | null;
      aggression: number | null;
      bars: FlowPoint[];
      regime: string;
    }
  > = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const chart = await yf.chart(symbol, {
          period1: new Date(Date.now() - 8 * 3600 * 1000),
          interval: "1m",
        });
        const quotes = chart.quotes ?? [];
        let cvd = 0;
        let up = 0;
        let down = 0;
        const bars: FlowPoint[] = [];
        for (const q of quotes) {
          if (q.close == null || q.volume == null) continue;
          const prev = bars.at(-1)?.close;
          const dir =
            prev == null ? 0 : q.close > prev ? 1 : q.close < prev ? -1 : 0;
          const signed = dir * q.volume;
          cvd += signed;
          if (dir > 0) up += q.volume;
          if (dir < 0) down += q.volume;
          bars.push({
            t: new Date(q.date).getTime(),
            close: q.close,
            volume: q.volume,
            signedVolume: signed,
            cvd,
          });
        }
        const first = bars[0]?.close ?? null;
        const last = bars.at(-1)?.close ?? null;
        const changePct =
          first != null && last != null && first !== 0
            ? ((last - first) / first) * 100
            : null;
        const total = up + down;
        const aggression = total > 0 ? (up - down) / total : null;
        const regime =
          aggression == null
            ? "n/a"
            : aggression > 0.12
              ? "aggressive bid"
              : aggression < -0.12
                ? "aggressive offer"
                : "balanced / absorb";

        out[symbol] = {
          symbol,
          last,
          changePct,
          cvd: bars.at(-1)?.cvd ?? null,
          aggression,
          bars: bars.slice(-90),
          regime,
        };
      } catch (e) {
        console.error("flow error", symbol, e);
        out[symbol] = {
          symbol,
          last: null,
          changePct: null,
          cvd: null,
          aggression: null,
          bars: [],
          regime: "n/a",
        };
      }
    }),
  );

  const es = out["ES=F"];
  const nq = out["NQ=F"];
  const relative =
    es?.changePct != null && nq?.changePct != null
      ? nq.changePct - es.changePct
      : null;

  return {
    note: "Free proxy: signed volume from 1-minute OHLC direction (not true bid/ask tape). Closest free stand-in for index orderflow.",
    relativeNqMinusEs: relative,
    leadership:
      relative == null
        ? "n/a"
        : relative > 0.05
          ? "NQ leading (risk-on / tech)"
          : relative < -0.05
            ? "ES leading / NQ lagging"
            : "in sync",
    series: out,
  };
}

async function safePolitical(): Promise<{
  recent: PoliticalTrade[];
  pelosi: PoliticalTrade[];
  trump: PoliticalTrade[];
}> {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data/trades.json",
      {
        next: { revalidate: 1800 },
        headers: { Accept: "application/json", "User-Agent": "SignalRadar/1.0" },
      },
    );
    if (!res.ok) throw new Error(`political feed ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;

    const mapped = rows
      .map(mapPolitical)
      .filter((x): x is PoliticalTrade => x != null)
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));

    const pelosi = mapped
      .filter((t) => t.filer.toLowerCase().includes("pelosi"))
      .slice(0, 20);
    const trump = mapped
      .filter((t) => t.filer.toLowerCase().includes("trump"))
      .filter((t) => t.ticker != null || /stock|equity|inc\.|corp/i.test(t.asset))
      .slice(0, 20);

    const recent = mapped
      .filter((t) => t.ticker != null)
      .slice(0, 40);

    return { recent, pelosi, trump };
  } catch (e) {
    console.error("political error", e);
    return { recent: [], pelosi: [], trump: [] };
  }
}

function mapPolitical(row: Record<string, unknown>): PoliticalTrade | null {
  const filer = String(row.filer_name ?? "");
  if (!filer) return null;
  const lower = filer.toLowerCase();
  let highlight: PoliticalTrade["highlight"] = "congress";
  if (lower.includes("pelosi")) highlight = "pelosi";
  else if (lower.includes("trump")) highlight = "trump";
  else if (String(row.branch) === "executive") highlight = "executive";

  return {
    id: String(row.id ?? `${filer}-${row.transaction_date}-${row.ticker}`),
    filer,
    ticker: row.ticker != null ? String(row.ticker) : null,
    asset: String(row.asset_name ?? ""),
    side: String(row.transaction_type ?? ""),
    amount: String(row.amount_range_label ?? ""),
    tradeDate: String(row.transaction_date ?? ""),
    filingDate: String(row.filing_date ?? ""),
    lagDays: typeof row.days_to_file === "number" ? row.days_to_file : null,
    late: Boolean(row.is_late),
    branch: String(row.branch ?? ""),
    chamber: row.chamber != null ? String(row.chamber) : null,
    party: row.party != null ? String(row.party) : null,
    docUrl: row.doc_url != null ? String(row.doc_url) : null,
    highlight,
  };
}

async function safeEarnings(): Promise<EarningsRow[]> {
  const now = Date.now();
  const horizonMs = 7 * 24 * 3600 * 1000;

  const settled = await Promise.all(
    EARNINGS_WATCHLIST.map(async (symbol) => {
      try {
        const [summary, quote] = await Promise.all([
          yf.quoteSummary(symbol, { modules: ["calendarEvents", "price"] }),
          yf.quote(symbol),
        ]);
        const dates = summary.calendarEvents?.earnings?.earningsDate ?? [];
        const next = dates
          .map((d) => new Date(d).getTime())
          .filter((t) => Number.isFinite(t) && t >= now - 12 * 3600 * 1000)
          .sort((a, b) => a - b)[0];
        if (next == null || next - now > horizonMs) return null;

        const daysUntil = Math.max(
          0,
          Math.round((next - now) / (24 * 3600 * 1000)),
        );
        const q = toQuoteRow(quote as unknown as Record<string, unknown>);
        const preMove4d = await fourDayMove(symbol);

        return {
          symbol,
          name: q.name,
          earningsDate: new Date(next).toISOString(),
          daysUntil,
          price: q.price,
          changePct: q.changePct,
          preMove4d,
          relativeVolume: q.relativeVolume,
          inWindow: daysUntil <= 4,
        } satisfies EarningsRow;
      } catch {
        return null;
      }
    }),
  );

  return settled
    .filter((x): x is EarningsRow => x != null)
    .sort((a, b) => a.daysUntil - b.daysUntil || Math.abs(b.preMove4d ?? 0) - Math.abs(a.preMove4d ?? 0));
}

async function fourDayMove(symbol: string): Promise<number | null> {
  try {
    const chart = await yf.chart(symbol, {
      period1: new Date(Date.now() - 12 * 24 * 3600 * 1000),
      interval: "1d",
    });
    const closes = (chart.quotes ?? [])
      .map((q) => q.close)
      .filter((c): c is number => c != null);
    if (closes.length < 5) return null;
    const last = closes.at(-1)!;
    const prev = closes.at(-5)!;
    return ((last - prev) / prev) * 100;
  } catch {
    return null;
  }
}

function buildIdeas(input: {
  indexes: Array<QuoteRow & { label: string }>;
  sectors: Array<QuoteRow & { label: string }>;
  unusualVolume: QuoteRow[];
  gainers: QuoteRow[];
  earnings: EarningsRow[];
  political: { recent: PoliticalTrade[]; pelosi: PoliticalTrade[]; trump: PoliticalTrade[] };
  flow: {
    leadership: string;
    relativeNqMinusEs: number | null;
    series: Record<string, { regime: string; changePct: number | null; aggression: number | null }>;
  };
  finviz: FinvizBundle;
}) {
  const ideas: Array<{
    id: string;
    title: string;
    confidence: number;
    bias: "long" | "short" | "neutral";
    reasons: string[];
    symbol?: string;
  }> = [];

  const es = input.flow.series["ES=F"];
  const spy = input.indexes.find((i) => i.symbol === "SPY");
  if (es && spy) {
    const reasons: string[] = [];
    let score = 45;
    if (es.regime === "aggressive bid") {
      score += 18;
      reasons.push("ES 1m signed-volume regime: aggressive bid");
    } else if (es.regime === "aggressive offer") {
      score += 18;
      reasons.push("ES 1m signed-volume regime: aggressive offer");
    }
    if (input.flow.leadership.includes("NQ leading")) {
      score += 12;
      reasons.push("NQ leading ES — tech/risk-on leadership");
    }
    if ((spy.changePct ?? 0) > 0.35) {
      score += 8;
      reasons.push(`SPY session strength ${spy.changePct?.toFixed(2)}%`);
    }
    if ((spy.changePct ?? 0) < -0.35) {
      score += 8;
      reasons.push(`SPY session weakness ${spy.changePct?.toFixed(2)}%`);
    }
    if (reasons.length) {
      ideas.push({
        id: "index-regime",
        title: `Index regime: ${es.regime}`,
        confidence: Math.min(92, score),
        bias:
          es.regime === "aggressive bid"
            ? "long"
            : es.regime === "aggressive offer"
              ? "short"
              : "neutral",
        reasons,
        symbol: "ES=F",
      });
    }
  }

  for (const e of input.earnings.filter((x) => x.inWindow).slice(0, 5)) {
    const reasons = [
      `Earnings in ${e.daysUntil}d (T−4…T−1 surveillance)`,
      e.preMove4d != null
        ? `4-day pre-move ${e.preMove4d >= 0 ? "+" : ""}${e.preMove4d.toFixed(2)}%`
        : "4-day pre-move n/a",
    ];
    let confidence = 55;
    if (e.preMove4d != null && Math.abs(e.preMove4d) >= 3) confidence += 12;
    if ((e.relativeVolume ?? 0) >= 1.4) {
      confidence += 10;
      reasons.push(`Relative volume ${(e.relativeVolume ?? 0).toFixed(2)}x`);
    }
    const pol = [...input.political.pelosi, ...input.political.trump, ...input.political.recent].find(
      (t) => t.ticker === e.symbol,
    );
    if (pol) {
      confidence += 14;
      reasons.push(`${pol.filer} disclosed ${pol.side} (${pol.amount})`);
    }
    ideas.push({
      id: `ea-${e.symbol}`,
      title: `${e.symbol} pre-earnings drift watch`,
      confidence: Math.min(93, confidence),
      bias:
        (e.preMove4d ?? 0) > 1 ? "long" : (e.preMove4d ?? 0) < -1 ? "short" : "neutral",
      reasons,
      symbol: e.symbol,
    });
  }

  for (const u of input.unusualVolume.slice(0, 4)) {
    const onFinviz = input.finviz.unusualVolume.find((f) => f.symbol === u.symbol);
    const reasons = [
      `Yahoo RVOL ${(u.relativeVolume ?? 0).toFixed(2)}x vs 3M avg`,
      `Session ${u.changePct != null ? `${u.changePct.toFixed(2)}%` : "n/a"}`,
    ];
    let confidence = 50 + Math.round((u.relativeVolume ?? 1) * 10);
    if (onFinviz) {
      confidence += 12;
      reasons.push(
        `Also on Finviz unusual volume (${onFinviz.changePct != null ? `${onFinviz.changePct.toFixed(2)}%` : "n/a"})`,
      );
    }
    ideas.push({
      id: `rvol-${u.symbol}`,
      title: `${u.symbol} unusual volume`,
      confidence: Math.min(92, confidence),
      bias: (u.changePct ?? 0) >= 0 ? "long" : "short",
      reasons,
      symbol: u.symbol,
    });
  }

  for (const f of input.finviz.unusualVolume.slice(0, 4)) {
    if (ideas.some((i) => i.symbol === f.symbol && i.id.startsWith("rvol-"))) continue;
    ideas.push({
      id: `fv-rvol-${f.symbol}`,
      title: `${f.symbol} Finviz unusual volume`,
      confidence: Math.min(86, 54 + Math.abs(f.changePct ?? 0) / 2),
      bias: (f.changePct ?? 0) >= 0 ? "long" : "short",
      reasons: [
        `${f.company || f.symbol} · ${f.sector || "n/a"}`,
        `Finviz change ${f.changePct != null ? `${f.changePct.toFixed(2)}%` : "n/a"} · vol ${f.volume ?? "n/a"}`,
      ],
      symbol: f.symbol,
    });
  }

  const topSector = input.finviz.sectors[0];
  if (topSector?.changePct != null) {
    ideas.push({
      id: "fv-sector-lead",
      title: `Finviz sector lead: ${topSector.name}`,
      confidence: Math.min(84, 58 + Math.abs(topSector.changePct) * 4),
      bias: topSector.changePct >= 0 ? "long" : "short",
      reasons: [
        `Session ${topSector.changePct >= 0 ? "+" : ""}${topSector.changePct.toFixed(2)}%`,
        topSector.perfWeek != null
          ? `Week ${topSector.perfWeek >= 0 ? "+" : ""}${topSector.perfWeek.toFixed(2)}%`
          : "Week n/a",
        `Volume ${topSector.volume}`,
      ],
    });
  }

  for (const t of [...input.political.pelosi.slice(0, 2), ...input.political.trump.filter((x) => x.ticker).slice(0, 2)]) {
    if (!t.ticker) continue;
    ideas.push({
      id: `pol-${t.id}`,
      title: `${t.filer.split(" ").slice(-1)[0]} → ${t.ticker}`,
      confidence: Math.min(90, 58 + (t.lagDays != null && t.lagDays <= 14 ? 16 : 4)),
      bias: /purchase|buy/i.test(t.side) ? "long" : /sale|sell/i.test(t.side) ? "short" : "neutral",
      reasons: [
        `${t.side} ${t.amount}`,
        `Trade ${t.tradeDate} · filed ${t.filingDate}${t.lagDays != null ? ` · lag ${t.lagDays}d` : ""}`,
        "Disclosure lag means this is not a same-day tape print",
      ],
      symbol: t.ticker,
    });
  }

  return ideas.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
}
