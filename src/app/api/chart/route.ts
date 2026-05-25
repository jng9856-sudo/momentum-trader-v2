import { NextRequest, NextResponse } from 'next/server';

function calcMA(cs: number[], p: number): number {
  if (cs.length < p) return NaN;
  return cs.slice(-p).reduce((a, b) => a + b, 0) / p;
}
function calcRSI(cs: number[], p = 14): number {
  if (cs.length < p + 1) return 50;
  const ch = cs.slice(1).map((c, i) => c - cs[i]);
  const gains = ch.map(c => c > 0 ? c : 0);
  const losses = ch.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let al = losses.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < ch.length; i++) {
    ag = (ag * (p - 1) + gains[i]) / p;
    al = (al * (p - 1) + losses[i]) / p;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

// ── 개선된 롤링 점수: RS > Stage > Volume > RSI ────────────────────────────
function calcRollingScore(closes: number[], volumes: number[], spyCloses: number[]): number[] {
  const scores: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 50) { scores.push(50); continue; }
    const slice  = closes.slice(0, i + 1);
    const vslice = volumes.slice(0, i + 1);
    const price  = slice[slice.length - 1];

    // ① RS vs SPY — 30점
    const spyIdx   = Math.min(Math.round((i / closes.length) * spyCloses.length), spyCloses.length - 1);
    const spySlice = spyCloses.slice(0, spyIdx + 1);
    let rsScore = 10;
    if (spySlice.length >= 20) {
      const rsArr = slice.map((c, j) => {
        const si = Math.min(Math.round((j / slice.length) * (spySlice.length - 1)), spySlice.length - 1);
        return spySlice[si] > 0 ? (c / spySlice[si]) * 100 : 100;
      });
      const rAvg = rsArr.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const pAvg = rsArr.slice(-20, -10).reduce((a, b) => a + b, 0) / 10;
      const rsTrend = ((rAvg - pAvg) / pAvg) * 100;
      const rs3mAgo = rsArr[Math.max(0, rsArr.length - 63)];
      const rs3mChg = rs3mAgo > 0 ? ((rsArr[rsArr.length - 1] - rs3mAgo) / rs3mAgo) * 100 : 0;
      if (rsTrend > 2 && rs3mChg > 15)      rsScore = 28;
      else if (rsTrend > 2 && rs3mChg > 5)  rsScore = 22;
      else if (rsTrend > 1)                  rsScore = 16;
      else if (rsTrend > -1)                 rsScore = 10;
      else                                   rsScore = 3;
    }

    // ② Stage/MA 정배열 — 20점
    const ma20  = calcMA(slice, Math.min(20,  slice.length));
    const ma50  = calcMA(slice, Math.min(50,  slice.length));
    const ma200 = calcMA(slice, Math.min(200, slice.length));
    let stageScore = 0;
    const stacked = !isNaN(ma20) && !isNaN(ma50) && !isNaN(ma200) && ma20 > ma50 && ma50 > ma200;
    if (!isNaN(ma200) && price > ma200 && !isNaN(ma50) && price > ma50 && !isNaN(ma20) && price > ma20 && stacked) stageScore = 20;
    else if (!isNaN(ma200) && price > ma200 && !isNaN(ma50) && price > ma50) stageScore = 12;
    else if (!isNaN(ma200) && price > ma200) stageScore = 6;

    // ③ OBV 수급 — 15점
    let volScore = 5;
    if (vslice.length >= 20) {
      const obv: number[] = [0];
      for (let k = 1; k < vslice.length; k++) {
        obv.push(slice[k] > slice[k - 1] ? obv[k - 1] + vslice[k] : slice[k] < slice[k - 1] ? obv[k - 1] - vslice[k] : obv[k - 1]);
      }
      const rAvg = obv.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const pAvg = obv.slice(-20, -10).reduce((a, b) => a + b, 0) / 10;
      const trend = ((rAvg - pAvg) / Math.abs(pAvg || 1)) * 100;
      const avgVol = vslice.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const vRatio = avgVol > 0 ? vslice[vslice.length - 1] / avgVol : 1;
      if (trend > 3 && vRatio >= 1.5) volScore = 15;
      else if (trend > 2)             volScore = 10;
      else if (trend > 0)             volScore = 7;
      else if (trend < -2)            volScore = 0;
    }

    // ④ RSI 보조 — 5점
    const rsi = calcRSI(slice.slice(-30));
    const rsiScore = rsi >= 45 && rsi <= 75 ? 5 : rsi >= 35 ? 2 : rsi > 80 ? 1 : 0;

    scores.push(Math.max(0, Math.min(100, Math.round(rsScore + stageScore + volScore + rsiScore))));
  }
  return scores;
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker');
  const months = parseInt(req.nextUrl.searchParams.get('months') ?? '6');
  if (!ticker) return NextResponse.json({ error: 'no ticker' }, { status: 400 });

  try {
    const range = months <= 3 ? '3mo' : months <= 6 ? '6mo' : '1y';
    const [res, spyRes] = await Promise.all([
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=${range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
    ]);
    if (!res.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: 'no data' }, { status: 500 });

    let spyCloses: number[] = [];
    if (spyRes.ok) {
      const sd = await spyRes.json();
      spyCloses = (sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
    }

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const valid = timestamps
      .map((t, i) => ({ t, c: (q.close as number[])[i], v: ((q.volume as number[])[i]) ?? 0 }))
      .filter(x => x.c != null && !isNaN(x.c));

    const dates   = valid.map(x => new Date(x.t * 1000).toISOString().slice(0, 10));
    const prices  = valid.map(x => Math.round(x.c * 100) / 100);
    const volumes = valid.map(x => x.v);
    const scores  = calcRollingScore(prices, volumes, spyCloses);

    return NextResponse.json({ ticker, dates, prices, scores, months });
  } catch {
    return NextResponse.json({ error: 'error' }, { status: 500 });
  }
}
