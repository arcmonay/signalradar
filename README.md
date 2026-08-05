# SignalRadar

Near-realtime **market intelligence terminal** built on free public data feeds.

This is a separate product from Undercutters.

## What you get

- Index / futures strip (SPY, QQQ, DIA, IWM, VIX, ES, NQ, YM, RTY)
- Sector rotation heatmap (XLK…XLC)
- Index orderflow **proxy** from 1-minute signed volume (not true DOM/tape)
- Unusual volume + session gainers
- Pre-earnings radar (T−4…T−1) on a liquid watchlist
- Pelosi / Trump / Congress political disclosures (public STOCK Act + OGE data)
- Confluence idea cards with confidence scores

## Data sources (free)

| Feed | Source | Cadence |
|------|--------|---------|
| Quotes / screeners / charts | Yahoo Finance via `yahoo-finance2` | Polled ~20s |
| Unusual vol / gainers / losers / most active / EA week / sector groups / news | Finviz public HTML screens | Polled ~20s (HTML cached ~60s) |
| Political / OGE trades | [kadoa-org/congress-trading-monitor](https://github.com/kadoa-org/congress-trading-monitor) public JSON | Cached ~30m |

**Limits:** free feeds can be delayed, rate-limited, or change without notice. Finviz has no official free API — we parse public pages. True tick-level orderflow, dark pool, and options flow require paid vendors.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Connect the `arcmonay/signalradar` GitHub repo as a **new** Vercel project (do not attach to Undercutters).
