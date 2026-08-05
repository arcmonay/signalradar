import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export default yf;

export type QuoteRow = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  avgVolume: number | null;
  relativeVolume: number | null;
  marketState: string | null;
  spark?: number[];
};

export function toQuoteRow(q: Record<string, unknown>): QuoteRow {
  const price = num(q.regularMarketPrice);
  const change = num(q.regularMarketChange);
  const changePct = num(q.regularMarketChangePercent);
  const volume = num(q.regularMarketVolume);
  const avgVolume = num(q.averageDailyVolume3Month) ?? num(q.averageDailyVolume10Day);
  return {
    symbol: String(q.symbol ?? ""),
    name: String(q.shortName ?? q.longName ?? q.symbol ?? ""),
    price,
    change,
    changePct,
    volume,
    avgVolume,
    relativeVolume:
      volume != null && avgVolume != null && avgVolume > 0
        ? volume / avgVolume
        : null,
    marketState: q.marketState != null ? String(q.marketState) : null,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
