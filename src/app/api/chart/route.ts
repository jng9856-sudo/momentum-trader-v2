import { NextRequest, NextResponse } from 'next/server';

function calcMA(cs: number[], p: number): number {
  if (cs.length < p) return NaN;
  return cs.slice(-p).reduce((a, b) => a + b, 0) / p;
}
function calcRSI(cs: number[], p = 14): number {
  const period = Math.min(p, Math.max(3, cs.length - 1));
  if (cs.length < period + 1) return 50;
  const ch = cs.slice(1).map((c, i) => c - cs[i]);
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

// ── 개선된 롤링 점수: 데이터가 적어도 계산 가능 ────────────────────────────
function calcRollingScore(closes: number[], volumes: number[], spyCloses: number[]): number[] {
  const scores: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 3) { scores.push(50); continue; }
    const slice  = closes.slice(0, i + 1);
    const vslice = volumes.slice(0, i + 1);
    const price  = slice[slice.length - 1];

    // ① RS vs SPY — 30점
    const spyIdx   = Math.min(Math.round((i / closes.length) * spyCloses.length), spyCloses.length - 1);
    const spySlice = spyCloses.slice(0, spyIdx + 1);
    let rsScore = 12;
    if (spySlice.length >= 3) {
      const rsArr = slice.map((c, j) => {
        const si = Math.min(Math.round((j / slice.length) * (spySlice.length - 1)), spySlice.length - 1);
        return spySlice[si] > 0 ? (c / spySlice[si]) * 100 : 100;
      });
      const win  = Math.max(2, Math.floor(rsArr.length / 3));
      const rAvg = rsArr.slice(-win).reduce((a, b) => a + b, 0) / win;
      const pArr = rsArr.slice(-win * 2, -win);
      const pAvg = pArr.length > 0 ? pArr.reduce((a, b) => a + b, 0) / pArr.length : rAvg;
      const rsTrend  = ((rAvg - pAvg) / (Math.abs(pAvg) || 1)) * 100;
      const rs3mAgo  = rsArr[Math.max(0, rsArr.length - Math.min(63, rsArr.length - 1))];
      const rs3mChg  = rs3mAgo > 0 ? ((rsArr[rsArr.length - 1] - rs3mAgo) / rs3mAgo) * 100 : 0;
      if      (rsTrend > 2 && rs3mChg > 15) rsScore = 28;
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
    const a20 = !isNaN(ma20)  && price > ma20;
    const a50 = !isNaN(ma50)  && price > ma50;
    const a200= !isNaN(ma200) && price > ma200;
    const stk = a20 && a50 && (!isNaN(ma200) ? a200 && ma20 > ma50 && ma50 > ma200 : ma20 > ma50);
    if      (a20 && a50 && a200 && stk) stageScore = 20;
    else if (a20 && a50 && a200)        stageScore = 14;
    else if (a20 && a50)                stageScore = 10;
    else if (a20)                       stageScore = 5;

    // ③ OBV 수급 — 15점
    let volScore = 5;
    if (vslice.length >= 4) {
      const obv: number[] = [0];
      for (let k = 1; k < vslice.length; k++)
        obv.push(slice[k] > slice[k-1] ? obv[k-1]+vslice[k] : slice[k] < slice[k-1] ? obv[k-1]-vslice[k] : obv[k-1]);
      const win  = Math.max(2, Math.floor(obv.length / 3));
      const rAvg = obv.slice(-win).reduce((a, b) => a + b, 0) / win;
      const pArr = obv.slice(-win * 2, -win);
      const pAvg = pArr.length > 0 ? pArr.reduce((a, b) => a + b, 0) / pArr.length : rAvg;
      const trend  = ((rAvg - pAvg) / (Math.abs(pAvg) || 1)) * 100;
      const avgVol = vslice.slice(-Math.min(11, vslice.length), -1).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(10, vslice.length - 1));
      const vRatio = avgVol > 0 ? vslice[vslice.length - 1] / avgVol : 1;
      if      (trend > 3 && vRatio >= 1.5) volScore = 15;
      else if (trend > 2)                  volScore = 10;
      else if (trend > 0)                  volScore = 7;
      else if (trend < -2)                 volScore = 0;
    }

    // ④ RSI 보조 — 5점
    const rsi      = calcRSI(slice);
    const rsiScore = rsi >= 45 && rsi <= 75 ? 5 : rsi >= 35 ? 2 : 1;

    scores.push(Math.max(0, Math.min(100, Math.round(rsScore + stageScore + volScore + rsiScore))));
  }
  return scores;
}

// ── 인트라데이 롤링 점수 ───────────────────────────────────────────────────────
function calcIntradayScore(prices: number[], volumes: number[]): number[] {
  const dayHigh  = Math.max(...prices);
  const dayLow   = Math.min(...prices);
  const dayRange = dayHigh - dayLow || 1;
  return prices.map((price, i) => {
    if (i < 5) return 50;
    const slice  = prices.slice(0, i + 1);
    const vslice = volumes.slice(0, i + 1);
    const rsi     = calcRSI(slice, Math.min(14, slice.length - 1));
    const rsiScore = rsi >= 50 && rsi <= 75 ? 40 : rsi >= 40 ? 28 : rsi > 75 ? 20 : 10;
    const posScore = Math.round(((price - dayLow) / dayRange) * 30);
    const avgVol   = vslice.slice(-Math.min(11, vslice.length), -1).reduce((a,b)=>a+b,0) / Math.max(1, Math.min(10, vslice.length-1));
    const volScore = avgVol > 0 ? Math.min(30, Math.round((vslice[vslice.length-1] / avgVol) * 15)) : 15;
    return Math.max(0, Math.min(100, rsiScore + posScore + volScore));
  });
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker');
  const period = req.nextUrl.searchParams.get('period') ?? '1d';
  if (!ticker) return NextResponse.json({ error: 'no ticker' }, { status: 400 });

  const YF_PARAMS: Record<string, { interval: string; range: string; intraday: boolean }> = {
    '1d':  { interval: '5m',  range: '1d',  intraday: true  },
    '1mo': { interval: '1d',  range: '1mo', intraday: false },
    '3mo': { interval: '1d',  range: '3mo', intraday: false },
    '6mo': { interval: '1d',  range: '6mo', intraday: false },
    '1y':  { interval: '1d',  range: '1y',  intraday: false },
  };
  const p = YF_PARAMS[period] ?? YF_PARAMS['1d'];

  try {
    const [res, spyRes] = await Promise.all([
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${p.interval}&range=${p.range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: p.intraday ? 60 : 3600 } }),
      p.intraday ? Promise.resolve(null) :
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=${p.range}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
    ]);

    if (!res.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: 'no data' }, { status: 500 });

    let spyCloses: number[] = [];
    if (spyRes?.ok) {
      const sd = await spyRes.json();
      spyCloses = (sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
    }

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const valid = timestamps
      .map((t, i) => ({ t, c: (q.close as number[])?.[i], v: (q.volume as number[])?.[i] ?? 0 }))
      .filter(x => x.c != null && !isNaN(x.c));

    const prices  = valid.map(x => Math.round(x.c * 100) / 100);
    const volumes = valid.map(x => x.v);

    if (p.intraday) {
      const dates = valid.map(x => {
        const d = new Date(x.t * 1000);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      });
      const scores = calcIntradayScore(prices, volumes);
      return NextResponse.json({ ticker, dates, prices, scores, period, intraday: true });
    }

    const dates  = valid.map(x => new Date(x.t * 1000).toISOString().slice(0, 10));
    const scores = calcRollingScore(prices, volumes, spyCloses);
    return NextResponse.json({ ticker, dates, prices, scores, period, intraday: false });
  } catch {
    return NextResponse.json({ error: 'error' }, { status: 500 });
  }
}
