/**
 * Run locally or in CI (where Finviz is reachable) to refresh
 * public/data/finviz-cache.json used as a Vercel fallback.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw) {
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

function parsePct(raw) {
  if (!raw || raw === "-") return null;
  const n = Number.parseFloat(raw.replace("%", "").replace(",", ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      Referer: "https://finviz.com/",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await res.text();
  if (!res.ok || html.includes("Just a moment")) {
    throw new Error(`Blocked/failed ${res.status} ${url}`);
  }
  return html;
}

function parseScreener(html) {
  const rows = [];
  const re =
    /<a[^>]*class="[^"]*tab-link[^"]*"[^>]*>([A-Z0-9.\-]+)<\/a>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html)) && rows.length < 40) {
    const symbol = m[1];
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

const screens = {
  unusualVolume: "https://finviz.com/screener.ashx?v=111&s=ta_unusualvolume",
  gainers: "https://finviz.com/screener.ashx?v=111&s=ta_topgainers",
  losers: "https://finviz.com/screener.ashx?v=111&s=ta_toplosers",
  mostActive: "https://finviz.com/screener.ashx?v=111&s=ta_mostactive",
  earningsThisWeek:
    "https://finviz.com/screener.ashx?v=111&f=earningsdate_thisweek",
};

const out = {
  asOf: new Date().toISOString(),
  source: "finviz-cache",
  unusualVolume: [],
  gainers: [],
  losers: [],
  mostActive: [],
  earningsThisWeek: [],
};

for (const [key, url] of Object.entries(screens)) {
  process.stdout.write(`Refreshing ${key}... `);
  const html = await fetchHtml(url);
  out[key] = parseScreener(html);
  console.log(`${out[key].length} rows`);
}

const dir = join(root, "public", "data");
mkdirSync(dir, { recursive: true });
const path = join(dir, "finviz-cache.json");
writeFileSync(path, JSON.stringify(out, null, 2));
console.log("Wrote", path);
