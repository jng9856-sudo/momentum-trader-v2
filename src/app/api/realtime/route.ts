import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const tickers = req.nextUrl.searchParams.get('tickers')?.split(',').filter(Boolean) ?? [];
  if (tickers.length === 0) return NextResponse.json({ error: 'no tickers' }, { status: 400 });

  try {
    const results = await Promise.all(
      tickers.map(async ticker => {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 30 } }
        );
        if (!res.ok) return { ticker, price: null, changePct: null };
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) return { ticker, price: null, changePct: null };

        const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
        const meta = result.meta ?? {};
        const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
        const changePct = price && prevClose ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : null;

        const session: 'REGULAR' | 'PRE' | 'AFTER' | 'CLOSED' =
          meta.marketState === 'PRE' ? 'PRE' :
          meta.marketState === 'POST' ? 'AFTER' :
          meta.marketState === 'REGULAR' ? 'REGULAR' : 'CLOSED';

        const extPrice = session === 'PRE' ? (meta.preMarketPrice ?? null) : session === 'AFTER' ? (meta.postMarketPrice ?? null) : null;
        const extChangePct = extPrice && prevClose ? Math.round(((extPrice - prevClose) / prevClose) * 10000) / 100 : null;

        return { ticker, price: price ? Math.round(price * 100) / 100 : null, changePct, marketSession: session, extPrice, extChangePct, isRealtime: session === 'REGULAR' };
      })
    );

    if (tickers.length === 1) return NextResponse.json(results[0]);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  }
}
