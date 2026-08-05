import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TARGET =
  "https://finviz.com/screener.ashx?v=111&s=ta_unusualvolume";

export async function GET() {
  const out: Record<string, unknown> = {};

  try {
    const direct = await fetch(TARGET, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: "https://finviz.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const html = await direct.text();
    out.direct = {
      status: direct.status,
      len: html.length,
      tabLink: /tab-link[^>]*>[A-Z]/.test(html),
      snippet: html.slice(0, 120),
    };
  } catch (e) {
    out.direct = { error: e instanceof Error ? e.message : "fail" };
  }

  try {
    const proxy = await fetch(`https://r.jina.ai/${TARGET}`, {
      headers: {
        Accept: "text/html",
        "X-Return-Format": "html",
        "User-Agent": UA,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const html = await proxy.text();
    out.proxy = {
      status: proxy.status,
      len: html.length,
      tabLink: /tab-link[^>]*>[A-Z]/.test(html),
      snippet: html.slice(0, 120),
    };
  } catch (e) {
    out.proxy = { error: e instanceof Error ? e.message : "fail" };
  }

  return NextResponse.json(out);
}
