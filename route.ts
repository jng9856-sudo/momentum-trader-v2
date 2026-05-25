import { NextRequest, NextResponse } from 'next/server';

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = ch.map(c => c > 0 ? c : 0);
  const losses = ch.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMA(cs: number[], p: number): number {
  const sl = cs.slice(-p);
  return sl.length < p ? NaN : sl.reduce((a, b) => a + b, 0) / p;
}

// 각 날짜별 롤링 모멘텀 점수 (RSI + MA 위치 기반 간소화)
function calcRollingScore(closes: number[], volumes: number[]): number[] {
  const scores: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 30) { scores.push(50); continue; }
    const slice = closes.slice(0, i + 1);
    const vslice = volumes.slice(0, i + 1);
    const price = slice[slice.length - 1];
    const rsi = calcRSI(slice.slice(-30));
    const ma20 = calcMA(slice, Math.min(20, slice.length));
    const ma50 = calcMA(slice, Math.min(50, slice.length));
    const avgVol = vslice.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const curVol = vslice[vslice.length - 1];
    const volRatio = avgVol > 0 ? curVol / avgVol : 1;

    let score = 50;
    // RSI 기여 (0~30점)
    if (rsi >= 50 && rsi <= 70) score += 15;
    else if (rsi >= 45 && rsi < 50) score += 8;
    else if (rsi > 70 && rsi <= 80) score += 5;
    else if (rsi > 80) score -= 5;
    else if (rsi < 40) score -= 10;
    // MA 위치 기여 (0~30점)
    if (!isNaN(ma20) && price > ma20) score += 10;
    if (!isNaN(ma50) && price > ma50) score += 10;
    if (!isNaN(ma20) && !isNaN(ma50) && ma20 > ma50) score += 10;
    // 거래량 기여
    if (volRatio >= 1.5) score += 5;
    else if (volRatio < 0.7) score -= 3;

    scores.push(Math.max(0, Math.min(100, Math.round(score))));
  }
  return scores;
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker');
  const months = parseInt(req.nextUrl.searchParams.get('months') ?? '6');
  if (!ticker) return NextResponse.json({ error: 'no ticker' }, { status: 400 });

  try {
    const range = months <= 3 ? '3mo' : months <= 6 ? '6mo' : '1y';
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });

    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: 'no data' }, { status: 500 });

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const rawCloses:  number[] = q.close  ?? [];
    const rawVolumes: number[] = q.volume ?? [];

    // null 제거 + 유효값만
    const valid = timestamps
      .map((t, i) => ({ t, c: rawCloses[i], v: rawVolumes[i] ?? 0 }))
      .filter(x => x.c != null && !isNaN(x.c));

    const dates   = valid.map(x => new Date(x.t * 1000).toISOString().slice(0, 10));
    const prices  = valid.map(x => Math.round(x.c * 100) / 100);
    const volumes = valid.map(x => x.v);
    const scores  = calcRollingScore(prices, volumes);

    return NextResponse.json({ ticker, dates, prices, scores, months });
  } catch {
    return NextResponse.json({ error: 'error' }, { status: 500 });
  }
}
