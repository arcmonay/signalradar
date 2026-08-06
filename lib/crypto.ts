export type CryptoCoin = {
  id: string;
  symbol: string;
  name: string;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  marketCapRank: number | null;
  sparkline?: number[];
  url: string;
};

export type CryptoPair = {
  symbol: string;
  base: string;
  quote: string;
  price: number | null;
  change24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volumeBase: number | null;
  volumeQuote: number | null;
  trades: number | null;
  venue: "binance";
};

export type CryptoBundle = {
  asOf: string;
  ok: boolean;
  error?: string;
  source: string;
  global: {
    activeCryptocurrencies: number | null;
    markets: number | null;
    totalMarketCapUsd: number | null;
    totalVolumeUsd: number | null;
    btcDominance: number | null;
    ethDominance: number | null;
    marketCapChange24h: number | null;
  };
  scannedCoins: number;
  scannedPairs: number;
  topMarketCap: CryptoCoin[];
  gainers: CryptoCoin[];
  losers: CryptoCoin[];
  volumeLeaders: CryptoCoin[];
  trending: Array<{
    id: string;
    symbol: string;
    name: string;
    rank: number | null;
    score: number | null;
    url: string;
  }>;
  binance: {
    usdtGainers: CryptoPair[];
    usdtLosers: CryptoPair[];
    usdtVolume: CryptoPair[];
    newListingsProxy: CryptoPair[];
  };
};

type GeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_24h?: number | null;
};

type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
};

const GECKO = "https://api.coingecko.com/api/v3";
const BINANCE_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3",
  "https://api.binance.us/api/v3",
  "https://api.binance.com/api/v3",
];

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "SignalRadar/1.0",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

function mapGecko(c: GeckoMarket): CryptoCoin {
  return {
    id: c.id,
    symbol: c.symbol?.toUpperCase?.() ?? c.symbol,
    name: c.name,
    price: num(c.current_price),
    change1h: num(c.price_change_percentage_1h_in_currency),
    change24h: num(
      c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h,
    ),
    change7d: num(c.price_change_percentage_7d_in_currency),
    volume24h: num(c.total_volume),
    marketCap: num(c.market_cap),
    marketCapRank: num(c.market_cap_rank),
    url: `https://www.coingecko.com/en/coins/${c.id}`,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parsePair(t: BinanceTicker): CryptoPair | null {
  const symbol = t.symbol;
  // Prefer liquid quote assets for "whole market" readable screens
  const quote =
    symbol.endsWith("USDT")
      ? "USDT"
      : symbol.endsWith("USDC")
        ? "USDC"
        : symbol.endsWith("BTC")
          ? "BTC"
          : symbol.endsWith("ETH")
            ? "ETH"
            : null;
  if (!quote) return null;
  const base = symbol.slice(0, symbol.length - quote.length);
  if (!base) return null;
  return {
    symbol,
    base,
    quote,
    price: Number.parseFloat(t.lastPrice) || null,
    change24h: Number.parseFloat(t.priceChangePercent) || null,
    high24h: Number.parseFloat(t.highPrice) || null,
    low24h: Number.parseFloat(t.lowPrice) || null,
    volumeBase: Number.parseFloat(t.volume) || null,
    volumeQuote: Number.parseFloat(t.quoteVolume) || null,
    trades: typeof t.count === "number" ? t.count : null,
    venue: "binance",
  };
}

/** Scrape CoinGecko market pages — top N by market cap (free API). */
async function fetchGeckoUniverse(pages = 4): Promise<CryptoCoin[]> {
  // 250 × 4 = 1,000 coins by market cap (liquid + long-tail coverage)
  const reqs = Array.from({ length: pages }, (_, i) => {
    const page = i + 1;
    const url =
      `${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc` +
      `&per_page=250&page=${page}&sparkline=false` +
      `&price_change_percentage=1h%2C24h%2C7d`;
    return getJson<GeckoMarket[]>(url);
  });
  const pagesData = await Promise.all(reqs);
  const seen = new Set<string>();
  const out: CryptoCoin[] = [];
  for (const page of pagesData) {
    for (const c of page) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(mapGecko(c));
    }
  }
  return out;
}

async function fetchBinanceUniverse(): Promise<{
  pairs: CryptoPair[];
  endpoint: string | null;
  error?: string;
}> {
  const errors: string[] = [];
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const tickers = await getJson<BinanceTicker[]>(`${base}/ticker/24hr`);
      const pairs: CryptoPair[] = [];
      for (const t of tickers) {
        const p = parsePair(t);
        if (!p) continue;
        if ((p.volumeQuote ?? 0) < 1000 && (p.volumeBase ?? 0) < 1) continue;
        pairs.push(p);
      }
      if (pairs.length) return { pairs, endpoint: base };
      errors.push(`${base}: empty`);
    } catch (e) {
      errors.push(`${base}: ${e instanceof Error ? e.message : "fail"}`);
    }
  }
  return { pairs: [], endpoint: null, error: errors.join(" | ") };
}

export async function getCryptoBundle(): Promise<CryptoBundle> {
  const empty: CryptoBundle = {
    asOf: new Date().toISOString(),
    ok: false,
    source: "CoinGecko + Binance public APIs",
    global: {
      activeCryptocurrencies: null,
      markets: null,
      totalMarketCapUsd: null,
      totalVolumeUsd: null,
      btcDominance: null,
      ethDominance: null,
      marketCapChange24h: null,
    },
    scannedCoins: 0,
    scannedPairs: 0,
    topMarketCap: [],
    gainers: [],
    losers: [],
    volumeLeaders: [],
    trending: [],
    binance: {
      usdtGainers: [],
      usdtLosers: [],
      usdtVolume: [],
      newListingsProxy: [],
    },
  };

  const errors: string[] = [];

  const globalRes = await Promise.allSettled([
    getJson<{
      data: {
        active_cryptocurrencies: number;
        markets: number;
        total_market_cap: { usd: number };
        total_volume: { usd: number };
        market_cap_percentage: { btc: number; eth: number };
        market_cap_change_percentage_24h_usd: number;
      };
    }>(`${GECKO}/global`),
  ]);
  const coinsRes = await Promise.allSettled([fetchGeckoUniverse(4)]);
  const trendingRes = await Promise.allSettled([
    getJson<{
      coins: Array<{
        item: {
          id: string;
          symbol: string;
          name: string;
          market_cap_rank: number | null;
          score: number | null;
        };
      }>;
    }>(`${GECKO}/search/trending`),
  ]);
  const binanceRes = await fetchBinanceUniverse();

  const globalRaw =
    globalRes[0].status === "fulfilled" ? globalRes[0].value : null;
  if (globalRes[0].status === "rejected") {
    errors.push(`global: ${errMsg(globalRes[0].reason)}`);
  }

  let coins =
    coinsRes[0].status === "fulfilled" ? coinsRes[0].value : [];
  if (coinsRes[0].status === "rejected") {
    errors.push(`markets: ${errMsg(coinsRes[0].reason)}`);
  }

  const trendingRaw =
    trendingRes[0].status === "fulfilled" ? trendingRes[0].value : { coins: [] };
  if (trendingRes[0].status === "rejected") {
    errors.push(`trending: ${errMsg(trendingRes[0].reason)}`);
  }

  // If Binance is geo-blocked, deepen the CoinGecko scan for broader coverage.
  if (!binanceRes.pairs.length && coins.length > 0) {
    try {
      const extra = await fetchGeckoUniverse(8); // up to 2000 by mcap
      coins = extra;
    } catch (e) {
      errors.push(`deep-scan: ${errMsg(e)}`);
    }
  }

  if (binanceRes.error) errors.push(`binance: ${binanceRes.error}`);
  const pairs = binanceRes.pairs;

  const g = globalRaw?.data;
  const withChange = coins.filter((c) => c.change24h != null);
  const gainers = [...withChange]
    .sort((a, b) => (b.change24h ?? -999) - (a.change24h ?? -999))
    .slice(0, 25);
  const losers = [...withChange]
    .sort((a, b) => (a.change24h ?? 999) - (b.change24h ?? 999))
    .slice(0, 25);
  const volumeLeaders = [...coins]
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 25);

  const usdt = pairs.filter((p) => p.quote === "USDT");
  const usdtGainers = [...usdt]
    .filter((p) => (p.volumeQuote ?? 0) > 100_000)
    .sort((a, b) => (b.change24h ?? -999) - (a.change24h ?? -999))
    .slice(0, 25);
  const usdtLosers = [...usdt]
    .filter((p) => (p.volumeQuote ?? 0) > 100_000)
    .sort((a, b) => (a.change24h ?? 999) - (b.change24h ?? 999))
    .slice(0, 25);
  const usdtVolume = [...usdt]
    .sort((a, b) => (b.volumeQuote ?? 0) - (a.volumeQuote ?? 0))
    .slice(0, 25);
  const newListingsProxy = [...usdt]
    .filter(
      (p) =>
        Math.abs(p.change24h ?? 0) >= 15 &&
        (p.volumeQuote ?? 0) > 50_000 &&
        (p.volumeQuote ?? 0) < 5_000_000,
    )
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
    .slice(0, 20);

  const ok = coins.length > 0 || pairs.length > 0 || Boolean(g);

  return {
    ...empty,
    asOf: new Date().toISOString(),
    ok,
    error: errors.length ? errors.join("; ") : undefined,
    source: [
      "CoinGecko (global + top 1000 by mcap + trending)",
      binanceRes.endpoint
        ? `Binance spot 24h via ${binanceRes.endpoint}`
        : "Binance unavailable from this region",
    ].join(" + "),
    global: {
      activeCryptocurrencies: g?.active_cryptocurrencies ?? null,
      markets: g?.markets ?? null,
      totalMarketCapUsd: g?.total_market_cap?.usd ?? null,
      totalVolumeUsd: g?.total_volume?.usd ?? null,
      btcDominance: g?.market_cap_percentage?.btc ?? null,
      ethDominance: g?.market_cap_percentage?.eth ?? null,
      marketCapChange24h: g?.market_cap_change_percentage_24h_usd ?? null,
    },
    scannedCoins: coins.length,
    scannedPairs: pairs.length,
    topMarketCap: coins.slice(0, 40),
    gainers,
    losers,
    volumeLeaders,
    trending: (trendingRaw.coins ?? []).map((c) => ({
      id: c.item.id,
      symbol: c.item.symbol?.toUpperCase?.() ?? c.item.symbol,
      name: c.item.name,
      rank: c.item.market_cap_rank,
      score: c.item.score,
      url: `https://www.coingecko.com/en/coins/${c.item.id}`,
    })),
    binance: {
      usdtGainers,
      usdtLosers,
      usdtVolume,
      newListingsProxy,
    },
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
