export type FinvizScreenerRow = {
  symbol: string;
  company: string;
  sector: string;
  industry: string;
  country: string;
  marketCap: string;
  pe: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  url: string;
};

export type FinvizNewsItem = {
  title: string;
  url: string;
};

export type FinvizSectorRow = {
  name: string;
  stocks: number | null;
  marketCap: string;
  changePct: number | null;
  volume: string;
  perfWeek: number | null;
  perfMonth: number | null;
  relativeVolume: number | null;
};

export type FinvizBundle = {
  asOf: string;
  ok: boolean;
  error?: string;
  transport?: "direct" | "cache" | "mixed";
  unusualVolume: FinvizScreenerRow[];
  gainers: FinvizScreenerRow[];
  losers: FinvizScreenerRow[];
  mostActive: FinvizScreenerRow[];
  earningsThisWeek: FinvizScreenerRow[];
  sectors: FinvizSectorRow[];
  news: FinvizNewsItem[];
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw || raw === "-") return null;
  const cleaned = raw.replace(/[,%$]/g, "").trim();
  if (!cleaned) return null;
  const mult = /[Bb]$/.test(cleaned)
    ? 1e9
    : /[Mm]$/.test(cleaned)
      ? 1e6
      : /[Kk]$/.test(cleaned)
        ? 1e3
        : 1;
  const n = Number.parseFloat(cleaned.replace(/[BMKbmK]/g, ""));
  return Number.isFinite(n) ? n * mult : null;
}

function parsePct(raw: string | undefined): number | null {
  if (!raw || raw === "-") return null;
  const n = Number.parseFloat(raw.replace("%", "").replace(",", ""));
  return Number.isFinite(n) ? n : null;
}

function isCloudflareChallenge(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("cf-challenge")
  );
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finviz.com/",
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const html = await res.text();
  if (!res.ok || isCloudflareChallenge(html)) {
    throw new Error(`Finviz blocked/failed (${res.status})`);
  }
  return html;
}

export function parseScreener(html: string): FinvizScreenerRow[] {
  const rows: FinvizScreenerRow[] = [];
  const re =
    /<a[^>]*class="[^"]*tab-link[^"]*"[^>]*>([A-Z0-9.\-]+)<\/a>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && rows.length < 40) {
    const symbol = m[1];
    if (!/^[A-Z][A-Z0-9.\-]{0,6}$/.test(symbol)) continue;
    const tds = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      strip(x[1]),
    );
    if (tds.length < 8) continue;
    rows.push({
      symbol,
      company: tds[0] ?? "",
      sector: tds[1] ?? "",
      industry: tds[2] ?? "",
      country: tds[3] ?? "",
      marketCap: tds[4] ?? "-",
      pe: tds[5] ?? "-",
      price: parseNumber(tds[6]),
      changePct: parsePct(tds[7]),
      volume: parseNumber(tds[8]),
      url: `https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}`,
    });
  }
  return rows;
}

export function parseNews(html: string): FinvizNewsItem[] {
  const items: FinvizNewsItem[] = [];
  const re =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*nn-tab-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && items.length < 30) {
    const title = strip(m[2]);
    if (!title) continue;
    items.push({ url: m[1], title });
  }
  return items;
}

export function parseSectorOverview(html: string): FinvizSectorRow[] {
  const rows: FinvizSectorRow[] = [];
  const trs = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  for (const tr of trs) {
    const tds = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      strip(x[1]),
    );
    if (tds.length < 12) continue;
    const no = tds[0];
    const name = tds[1];
    if (!/^\d+$/.test(no) || !name || name.length < 3) continue;
    if (/^(Name|Group|Sector)$/i.test(name)) continue;
    rows.push({
      name,
      stocks: parseNumber(tds[2]),
      marketCap: tds[3] ?? "-",
      changePct: parsePct(tds[tds.length - 2]),
      volume: tds[tds.length - 1] ?? "-",
      perfWeek: null,
      perfMonth: null,
      relativeVolume: null,
    });
  }
  return rows;
}

export function parseSectorPerformance(html: string): FinvizSectorRow[] {
  const rows: FinvizSectorRow[] = [];
  const trs = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  for (const tr of trs) {
    const tds = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      strip(x[1]),
    );
    if (tds.length < 10 || !/^\d+$/.test(tds[0])) continue;
    const name = tds[1];
    if (!name || name.length < 3) continue;
    rows.push({
      name,
      stocks: null,
      marketCap: "-",
      perfWeek: parsePct(tds[2]),
      perfMonth: parsePct(tds[3]),
      relativeVolume: parseNumber(tds[9]),
      changePct: parsePct(tds[10] ?? tds[tds.length - 2]),
      volume: tds[tds.length - 1] ?? "-",
    });
  }
  return rows;
}

type CacheFile = {
  asOf: string;
  unusualVolume: FinvizScreenerRow[];
  gainers: FinvizScreenerRow[];
  losers: FinvizScreenerRow[];
  mostActive: FinvizScreenerRow[];
  earningsThisWeek: FinvizScreenerRow[];
};

async function loadCache(): Promise<CacheFile | null> {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const url = base
      ? `${base}/data/finviz-cache.json`
      : "http://127.0.0.1:3000/data/finviz-cache.json";

    // Prefer filesystem in the same deployment when available.
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const raw = await readFile(
        join(process.cwd(), "public", "data", "finviz-cache.json"),
        "utf8",
      );
      return JSON.parse(raw) as CacheFile;
    } catch {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return (await res.json()) as CacheFile;
    }
  } catch {
    return null;
  }
}

async function safeParseScreener(url: string): Promise<FinvizScreenerRow[]> {
  const html = await fetchHtml(url);
  return parseScreener(html);
}

export async function getFinvizBundle(): Promise<FinvizBundle> {
  const errors: string[] = [];
  let transport: "direct" | "cache" | "mixed" = "direct";

  const [sectorsHtml, perfHtml, newsHtml] = await Promise.all([
    fetchHtml("https://finviz.com/groups.ashx?g=sector&v=111&o=-change").catch(
      (e) => {
        errors.push(`sectors: ${e instanceof Error ? e.message : "fail"}`);
        return "";
      },
    ),
    fetchHtml("https://finviz.com/groups.ashx?g=sector&v=140&o=-perf1d").catch(
      (e) => {
        errors.push(`sectorsPerf: ${e instanceof Error ? e.message : "fail"}`);
        return "";
      },
    ),
    fetchHtml("https://finviz.com/news.ashx").catch((e) => {
      errors.push(`news: ${e instanceof Error ? e.message : "fail"}`);
      return "";
    }),
  ]);

  const overviewSectors = sectorsHtml ? parseSectorOverview(sectorsHtml) : [];
  const perfSectors = perfHtml ? parseSectorPerformance(perfHtml) : [];
  const perfByName = new Map(perfSectors.map((s) => [s.name, s]));
  const sectors = (overviewSectors.length ? overviewSectors : perfSectors)
    .map((s) => {
      const p = perfByName.get(s.name);
      return {
        ...s,
        perfWeek: p?.perfWeek ?? s.perfWeek,
        perfMonth: p?.perfMonth ?? s.perfMonth,
        relativeVolume: p?.relativeVolume ?? s.relativeVolume,
        changePct: s.changePct ?? p?.changePct ?? null,
      };
    })
    .sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));

  const news = newsHtml ? parseNews(newsHtml) : [];

  const screenUrls = {
    unusualVolume: "https://finviz.com/screener.ashx?v=111&s=ta_unusualvolume",
    gainers: "https://finviz.com/screener.ashx?v=111&s=ta_topgainers",
    losers: "https://finviz.com/screener.ashx?v=111&s=ta_toplosers",
    mostActive: "https://finviz.com/screener.ashx?v=111&s=ta_mostactive",
    earningsThisWeek:
      "https://finviz.com/screener.ashx?v=111&f=earningsdate_thisweek",
  } as const;

  let unusualVolume: FinvizScreenerRow[] = [];
  let gainers: FinvizScreenerRow[] = [];
  let losers: FinvizScreenerRow[] = [];
  let mostActive: FinvizScreenerRow[] = [];
  let earningsThisWeek: FinvizScreenerRow[] = [];
  let usedCache = false;

  try {
    const live = await Promise.all(
      Object.values(screenUrls).map((url) => safeParseScreener(url)),
    );
    [unusualVolume, gainers, losers, mostActive, earningsThisWeek] = live;
  } catch (e) {
    errors.push(
      `screeners: ${e instanceof Error ? e.message : "blocked"} — using cache`,
    );
    const cache = await loadCache();
    if (cache) {
      usedCache = true;
      unusualVolume = cache.unusualVolume ?? [];
      gainers = cache.gainers ?? [];
      losers = cache.losers ?? [];
      mostActive = cache.mostActive ?? [];
      earningsThisWeek = cache.earningsThisWeek ?? [];
      transport = sectors.length || news.length ? "mixed" : "cache";
    }
  }

  // If live screeners returned empty arrays due to soft blocks, also use cache.
  const liveEmpty =
    unusualVolume.length +
      gainers.length +
      losers.length +
      mostActive.length +
      earningsThisWeek.length ===
    0;
  if (liveEmpty && !usedCache) {
    const cache = await loadCache();
    if (cache) {
      usedCache = true;
      unusualVolume = cache.unusualVolume ?? [];
      gainers = cache.gainers ?? [];
      losers = cache.losers ?? [];
      mostActive = cache.mostActive ?? [];
      earningsThisWeek = cache.earningsThisWeek ?? [];
      transport = sectors.length || news.length ? "mixed" : "cache";
      errors.push("screeners empty live — served finviz-cache.json");
    }
  } else if (!usedCache) {
    transport = "direct";
  }

  const hasData =
    unusualVolume.length +
      gainers.length +
      losers.length +
      mostActive.length +
      earningsThisWeek.length +
      sectors.length +
      news.length >
    0;

  return {
    asOf: new Date().toISOString(),
    ok: hasData,
    transport,
    error: errors.length ? errors.join("; ") : undefined,
    unusualVolume,
    gainers,
    losers,
    mostActive,
    earningsThisWeek,
    sectors,
    news,
  };
}
