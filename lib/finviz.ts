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
  transport?: "direct" | "proxy" | "mixed";
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
  const mult =
    /[Bb]$/.test(cleaned) ? 1e9 : /[Mm]$/.test(cleaned) ? 1e6 : /[Kk]$/.test(cleaned) ? 1e3 : 1;
  const n = Number.parseFloat(cleaned.replace(/[BMKbmK]/g, ""));
  return Number.isFinite(n) ? n * mult : null;
}

function parsePct(raw: string | undefined): number | null {
  if (!raw || raw === "-") return null;
  const n = Number.parseFloat(raw.replace("%", "").replace(",", ""));
  return Number.isFinite(n) ? n : null;
}

async function warmCookies(): Promise<string> {
  try {
    const home = await fetch("https://finviz.com/", {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    const setCookie =
      typeof home.headers.getSetCookie === "function"
        ? home.headers.getSetCookie()
        : [];
    return setCookie.map((c) => c.split(";")[0]).join("; ");
  } catch {
    return "";
  }
}

async function fetchDirect(url: string, cookie: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finviz.com/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Finviz ${res.status}`);
  return res.text();
}

async function fetchViaProxy(url: string): Promise<string> {
  const proxyUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(proxyUrl, {
    headers: {
      Accept: "text/html",
      "X-Return-Format": "html",
      "User-Agent": UA,
    },
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Finviz proxy ${res.status}`);
  return res.text();
}

async function fetchFinvizHtml(
  url: string,
  cookie: string,
): Promise<{ html: string; transport: "direct" | "proxy" }> {
  try {
    const html = await fetchDirect(url, cookie);
    if (html.includes("tab-link") || html.includes("nn-tab-link") || html.includes("<tr")) {
      return { html, transport: "direct" };
    }
    throw new Error("Finviz direct returned unexpected HTML");
  } catch {
    const html = await fetchViaProxy(url);
    return { html, transport: "proxy" };
  }
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

type ScreenKey =
  | "unusualVolume"
  | "gainers"
  | "losers"
  | "mostActive"
  | "earningsThisWeek"
  | "sectorsOverview"
  | "sectorsPerf"
  | "news";

const SCREENS: Record<ScreenKey, string> = {
  unusualVolume: "https://finviz.com/screener.ashx?v=111&s=ta_unusualvolume",
  gainers: "https://finviz.com/screener.ashx?v=111&s=ta_topgainers",
  losers: "https://finviz.com/screener.ashx?v=111&s=ta_toplosers",
  mostActive: "https://finviz.com/screener.ashx?v=111&s=ta_mostactive",
  earningsThisWeek:
    "https://finviz.com/screener.ashx?v=111&f=earningsdate_thisweek",
  sectorsOverview: "https://finviz.com/groups.ashx?g=sector&v=111&o=-change",
  sectorsPerf: "https://finviz.com/groups.ashx?g=sector&v=140&o=-perf1d",
  news: "https://finviz.com/news.ashx",
};

export async function getFinvizBundle(): Promise<FinvizBundle> {
  const empty: FinvizBundle = {
    asOf: new Date().toISOString(),
    ok: false,
    unusualVolume: [],
    gainers: [],
    losers: [],
    mostActive: [],
    earningsThisWeek: [],
    sectors: [],
    news: [],
  };

  try {
    const cookie = await warmCookies();
    const transports = new Set<"direct" | "proxy">();
    const errors: string[] = [];

    async function load(key: ScreenKey) {
      try {
        const { html, transport } = await fetchFinvizHtml(SCREENS[key], cookie);
        transports.add(transport);
        return html;
      } catch (e) {
        errors.push(
          `${key}: ${e instanceof Error ? e.message : "fetch failed"}`,
        );
        return "";
      }
    }

    // Keep concurrency modest to reduce blocks; still parallel enough for UX.
    const [
      unusualHtml,
      gainersHtml,
      losersHtml,
      activeHtml,
      earningsHtml,
      sectorsHtml,
      perfHtml,
      newsHtml,
    ] = await Promise.all([
      load("unusualVolume"),
      load("gainers"),
      load("losers"),
      load("mostActive"),
      load("earningsThisWeek"),
      load("sectorsOverview"),
      load("sectorsPerf"),
      load("news"),
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

    const bundle: FinvizBundle = {
      asOf: new Date().toISOString(),
      ok: false,
      transport:
        transports.size === 0
          ? undefined
          : transports.size === 2
            ? "mixed"
            : transports.has("direct")
              ? "direct"
              : "proxy",
      unusualVolume: unusualHtml ? parseScreener(unusualHtml) : [],
      gainers: gainersHtml ? parseScreener(gainersHtml) : [],
      losers: losersHtml ? parseScreener(losersHtml) : [],
      mostActive: activeHtml ? parseScreener(activeHtml) : [],
      earningsThisWeek: earningsHtml ? parseScreener(earningsHtml) : [],
      sectors,
      news: newsHtml ? parseNews(newsHtml) : [],
    };

    const hasData =
      bundle.unusualVolume.length +
        bundle.gainers.length +
        bundle.losers.length +
        bundle.mostActive.length +
        bundle.earningsThisWeek.length +
        bundle.sectors.length +
        bundle.news.length >
      0;

    bundle.ok = hasData;
    if (!hasData) {
      bundle.error = errors[0] ?? "Finviz returned no parseable rows";
    } else if (errors.length) {
      bundle.error = `Partial Finviz load (${errors.length} screen(s) failed)`;
    }

    return bundle;
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : "Finviz fetch failed",
    };
  }
}
