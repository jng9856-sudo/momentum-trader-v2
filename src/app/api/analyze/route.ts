import { NextRequest, NextResponse } from 'next/server';

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// ── Math helpers ──────────────────────────────────────────────────────────────
function calcEMA(data: number[], p: number): number[] {
  const k = 2 / (p + 1); let prev = data[0];
  return data.map(d => { prev = d * k + prev * (1 - k); return prev; });
}
function calcMA(cs: number[], p: number): number {
  const sl = cs.slice(-p);
  return sl.length < p ? NaN : sl.reduce((a, b) => a + b, 0) / p;
}
function calcRSI(cs: number[], p = 14): number {
  const ch = cs.slice(1).map((c, i) => c - cs[i]);
  const gains = ch.map(c => c > 0 ? c : 0), losses = ch.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let al = losses.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < ch.length; i++) {
    ag = (ag * (p - 1) + gains[i]) / p;
    al = (al * (p - 1) + losses[i]) / p;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}
function calcMACD(cs: number[]): { histogram: number; prevHistogram: number } {
  const e12 = calcEMA(cs, 12), e26 = calcEMA(cs, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig = calcEMA(line.slice(-60), 9);
  return {
    histogram: Math.round((line[line.length - 1] - sig[sig.length - 1]) * 1000) / 1000,
    prevHistogram: Math.round((line[line.length - 2] - sig[sig.length - 2]) * 1000) / 1000,
  };
}
function calcBB(cs: number[], p = 20): number {
  const sl = cs.slice(-p), mid = sl.reduce((a, b) => a + b, 0) / p;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
  const upper = mid + 2 * std, lower = mid - 2 * std;
  return upper !== lower ? Math.round(((cs[cs.length - 1] - lower) / (upper - lower)) * 100) : 50;
}
function calcATR(hs: number[], ls: number[], cs: number[], p = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i] - ls[i], Math.abs(hs[i] - cs[i - 1]), Math.abs(ls[i] - cs[i - 1])));
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
}
function calcVolRatio(vs: number[], p = 20): number {
  const avg = vs.slice(-p - 1, -1).reduce((a, b) => a + b, 0) / p;
  return avg > 0 ? Math.round((vs[vs.length - 1] / avg) * 100) / 100 : 1;
}

// ── Stage 분석 ────────────────────────────────────────────────────────────────
function detectStage(price: number, ma50: number, ma150: number, ma200: number): 1 | 2 | 3 | 4 {
  const a200 = price > ma200, a150 = price > ma150, a50 = price > ma50;
  const m50_150 = ma50 > ma150, m150_200 = ma150 > ma200;
  if (a200 && a150 && a50 && m50_150 && m150_200) return 2;
  if (a200 && (!m50_150 || !m150_200)) return 1;
  if (a200 && !m50_150) return 3;
  return 4;
}

// ── Setup 품질 ────────────────────────────────────────────────────────────────
function detectSetup(cs: number[], hs: number[], ls: number[], vs: number[], ma50: number, ma150: number, ma200: number) {
  const price = cs[cs.length - 1];
  const stage = detectStage(price, ma50, ma150, ma200);
  const lookback = Math.min(cs.length - 1, 252);
  const rcs = cs.slice(-lookback), rhs = hs.slice(-lookback), rls = ls.slice(-lookback), rvs = vs.slice(-lookback);

  let peakIdx = 0, peakPrice = rhs[0];
  for (let i = 1; i < rhs.length; i++) if (rhs[i] > peakPrice) { peakPrice = rhs[i]; peakIdx = i; }

  const bcs = rcs.slice(peakIdx), bhs = rhs.slice(peakIdx), bls = rls.slice(peakIdx), bvs = rvs.slice(peakIdx);
  const baseWeeks = Math.round(bcs.length / 5);
  const baseHigh = Math.max(...bhs), baseLow = Math.min(...bls);
  const priceRangePct = baseLow > 0 ? Math.round(((baseHigh - baseLow) / baseLow) * 1000) / 10 : 999;
  const baseDepthPct = peakPrice > 0 ? Math.round(((peakPrice - baseLow) / peakPrice) * 1000) / 10 : 0;
  const pivotPrice = Math.round(baseHigh * 100) / 100;
  const distFromPivot = Math.round(((price - pivotPrice) / pivotPrice) * 1000) / 10;

  const atrNow = calcATR(hs.slice(-15), ls.slice(-15), cs.slice(-15), 14);
  const atrHistAvg = atrNow; // 간소화
  const atrContraction = atrHistAvg > 0 ? Math.round((atrNow / atrHistAvg) * 100) / 100 : 1;

  const half = Math.floor(bvs.length / 2);
  const earlyVol = half > 0 ? bvs.slice(0, half).reduce((a, b) => a + b, 0) / half : 1;
  const lateVol = (bvs.length - half) > 0 ? bvs.slice(half).reduce((a, b) => a + b, 0) / (bvs.length - half) : 1;
  const volDryingRatio = earlyVol > 0 ? Math.round((lateVol / earlyVol) * 100) / 100 : 1;
  const volDrying = volDryingRatio < 0.75 && baseWeeks >= 3;

  let score = 0;
  if (baseWeeks >= 15) score += 25; else if (baseWeeks >= 10) score += 20; else if (baseWeeks >= 6) score += 15; else if (baseWeeks >= 3) score += 8;
  if (priceRangePct <= 8) score += 15; else if (priceRangePct <= 12) score += 10; else if (priceRangePct <= 18) score += 5;
  if (volDrying && volDryingRatio <= 0.5) score += 15; else if (volDrying) score += 8;
  if (distFromPivot >= -3 && distFromPivot <= 0) score += 10; else if (distFromPivot >= -7) score += 5;
  if (baseDepthPct > 40) score -= 10; else if (baseDepthPct > 30) score -= 5;
  if (stage === 4) score = Math.min(score, 20);
  if (distFromPivot > 5) score -= 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const isCoiling = score >= 55 && distFromPivot >= -15 && distFromPivot <= 2 && baseWeeks >= 3;
  const label = score >= 80 ? '🔥 최상급 셋업' : score >= 65 ? '⚡ 코일링' : score >= 50 ? '📐 셋업 형성 중' : score >= 35 ? '👁 초기 베이스' : '— 셋업 없음';

  return { setupScore: score, setupLabel: label, baseWeeks, baseDepthPct, priceRangePct, atrContraction, volDrying, volDryingRatio, pivotPrice, distFromPivot, stage, isCoiling };
}

// ── VCP ───────────────────────────────────────────────────────────────────────
function detectVCP(cs: number[], vs: number[], high52w: number) {
  const WEEK = 5;
  if (cs.length < WEEK * 15) return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null as number | null, detail: '데이터 부족' };
  const weeks: { high: number; low: number; close: number; avgVol: number }[] = [];
  for (let i = cs.length - WEEK * 20; i < cs.length; i += WEEK) {
    const sl = cs.slice(i, i + WEEK), vsl = vs.slice(i, i + WEEK).filter(v => v > 0);
    if (sl.length < 3) continue;
    weeks.push({ high: Math.max(...sl), low: Math.min(...sl), close: sl[sl.length - 1], avgVol: vsl.length > 0 ? vsl.reduce((a, b) => a + b, 0) / vsl.length : 0 });
  }
  if (weeks.length < 6) return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null as number | null, detail: '데이터 부족' };
  const rw = weeks.slice(-20), baseHigh = Math.max(...rw.map(w => w.high));
  let bsi = rw.length - 1;
  for (let i = rw.length - 2; i >= 0; i--) { if (rw[i].high >= baseHigh * 0.98) { bsi = i; break; } }
  const bw = rw.slice(bsi), bwk = rw.length - bsi;
  const pullbacks: number[] = [];
  for (let i = 1; i < bw.length; i++) { const lh = bw[i - 1].high, ll = bw[i].low; if (ll < lh) pullbacks.push(((lh - ll) / lh) * 100); }
  let cc = 0;
  for (let i = 1; i < pullbacks.length; i++) if (pullbacks[i] < pullbacks[i - 1] * 0.85) cc++;
  const lp = pullbacks[pullbacks.length - 1] ?? 0;
  const bvols = bw.map(w => w.avgVol).filter(v => v > 0);
  const ovg = rw.map(w => w.avgVol).filter(v => v > 0).reduce((a, b) => a + b, 0) / rw.length;
  const lvwib = Math.min(...bvols) < ovg * 0.7;
  let vs2 = 0;
  const price = cs[cs.length - 1], d52 = ((price - high52w) / high52w) * 100;
  if (d52 > -2) vs2 += 25; else if (d52 > -5) vs2 += 20; else if (d52 > -10) vs2 += 10; else if (d52 > -15) vs2 += 5;
  if (bwk >= 8) vs2 += 20; else if (bwk >= 5) vs2 += 15; else if (bwk >= 3) vs2 += 10;
  if (lvwib) vs2 += 20;
  vs2 += Math.min(20, cc * 7);
  if (lp <= 2) vs2 += 15; else if (lp <= 4) vs2 += 10; else if (lp <= 6) vs2 += 5;
  const isVCP = vs2 >= 50 && cc >= 2 && bwk >= 3;
  return { score: vs2, isVCP, contractionCount: cc, lastPullbackPct: Math.round(lp * 10) / 10, baseWeeks: bwk, lowestVolWeekInBase: lvwib, pivotPrice: Math.round(baseHigh * 100) / 100, detail: isVCP ? `VCP: ${cc}회 수렴·${bwk}주 베이스` : `VCP 미충족: 수렴${cc}회` };
}

// ── OBV ───────────────────────────────────────────────────────────────────────
function calcOBV(cs: number[], vs: number[]) {
  if (cs.length < 20) return { trend: 'FLAT' as const, detail: '데이터 부족' };
  const obv: number[] = [0];
  for (let i = 1; i < cs.length; i++) obv.push(cs[i] > cs[i - 1] ? obv[i - 1] + vs[i] : cs[i] < cs[i - 1] ? obv[i - 1] - vs[i] : obv[i - 1]);
  const r = obv.slice(-10), p = obv.slice(-20, -10);
  const ra = r.reduce((a, b) => a + b, 0) / r.length, pa = p.reduce((a, b) => a + b, 0) / p.length;
  const ch = ((ra - pa) / Math.abs(pa || 1)) * 100;
  const trend = ch > 2 ? 'UP' as const : ch < -2 ? 'DOWN' as const : 'FLAT' as const;
  return { trend, detail: trend === 'UP' ? 'OBV 상승 — 기관 매집 중' : trend === 'DOWN' ? 'OBV 하락 — 기관 분산 중' : 'OBV 횡보' };
}

// ── RS Line ───────────────────────────────────────────────────────────────────
function calcRSLine(cs: number[], spyCs: number[]) {
  const len = Math.min(cs.length, spyCs.length);
  if (len < 30) return { rsLineTrend: 'FLAT' as const, rs3mChange: 0, divergence: 'NONE' as const, rsLineNewHigh: false, spyNewLow: false, detail: '데이터 부족' };
  const ss = cs.slice(-len), sp = spyCs.slice(-len);
  const rsArr = ss.map((c, i) => (c / sp[i]) * 100);
  const r = rsArr.slice(-10), prev = rsArr.slice(-20, -10);
  const ra = r.reduce((a, b) => a + b, 0) / r.length, pa = prev.reduce((a, b) => a + b, 0) / prev.length;
  const ch = ((ra - pa) / pa) * 100;
  const rsLineTrend: 'UP' | 'DOWN' | 'FLAT' = ch > 1 ? 'UP' : ch < -1 ? 'DOWN' : 'FLAT';
  const rs3mAgo = rsArr[Math.max(0, rsArr.length - 63)];
  const rs3mChange = Math.round(((rsArr[rsArr.length - 1] - rs3mAgo) / rs3mAgo) * 1000) / 10;
  const spyMin20 = Math.min(...sp.slice(-20, -1));
  const spyNewLow = sp[sp.length - 1] <= spyMin20 * 1.01;
  const rsMax20 = Math.max(...rsArr.slice(-20, -1));
  const rsLineNewHigh = rsArr[rsArr.length - 1] >= rsMax20 * 0.98;
  const divergence: 'BULLISH' | 'BEARISH' | 'NONE' = spyNewLow && rsLineNewHigh ? 'BULLISH' : !spyNewLow && rsLineTrend === 'DOWN' && ch < -3 ? 'BEARISH' : 'NONE';
  const detail = divergence === 'BULLISH' ? '🏆 RS 강세 다이버전스' : `RS Line ${rsLineTrend === 'UP' ? '상승' : rsLineTrend === 'DOWN' ? '하락' : '횡보'} (3개월 ${rs3mChange > 0 ? '+' : ''}${rs3mChange}%)`;
  return { rsLineTrend, rs3mChange, divergence, rsLineNewHigh, spyNewLow, detail };
}

// ── Pocket Pivot ──────────────────────────────────────────────────────────────
function detectPocketPivot(cs: number[], vs: number[], ma10: number) {
  if (cs.length < 15) return { isPocketPivot: false, daysAgo: -1, volRatio: 0, detail: '데이터 부족' };
  const downVols: number[] = [];
  for (let i = 1; i < cs.slice(-12, -1).length; i++) if (cs[cs.length - 12 + i] < cs[cs.length - 13 + i]) downVols.push(vs[vs.length - 12 + i]);
  if (downVols.length === 0) return { isPocketPivot: false, daysAgo: -1, volRatio: 0, detail: '하락일 없음' };
  const maxDV = Math.max(...downVols);
  for (const daysAgo of [0, 1]) {
    const idx = cs.length - 1 - daysAgo;
    if (cs[idx] > cs[idx - 1] && vs[idx] > maxDV && cs[idx] > ma10) {
      return { isPocketPivot: true, daysAgo, volRatio: Math.round((vs[idx] / maxDV) * 100) / 100, detail: `${daysAgo === 0 ? '오늘' : '어제'} 포켓 피벗` };
    }
  }
  return { isPocketPivot: false, daysAgo: -1, volRatio: 0, detail: '포켓 피벗 없음' };
}

// ── 52주 돌파 ─────────────────────────────────────────────────────────────────
function detect52w(cs: number[], vs: number[]) {
  if (cs.length < 252) return { isBreakout: false, breakoutDay: -1, volConfirmed: false, detail: '' };
  const today = cs[cs.length - 1], prev52 = Math.max(...cs.slice(-252, -1));
  const avgVol = vs.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volOk = vs[vs.length - 1] > avgVol * 1.4;
  if (today > prev52 && cs[cs.length - 2] <= prev52)
    return { isBreakout: true, breakoutDay: 0, volConfirmed: volOk, detail: `🚀 52주 신고가 돌파${volOk ? ' · 거래량 ✓' : ' · 거래량 부족'}` };
  return { isBreakout: false, breakoutDay: -1, volConfirmed: false, detail: '' };
}

// ── Market Regime ─────────────────────────────────────────────────────────────
type Regime = 'BULL' | 'NEUTRAL' | 'CAUTION' | 'BEAR';
async function fetchRegime(): Promise<{ regime: Regime; label: string; emoji: string; vix: number } | null> {
  try {
    const [sr, vr] = await Promise.all([
      fetch(`${YF}/SPY?interval=1d&range=1y`, { headers: HEADERS, next: { revalidate: 3600 } }),
      fetch(`${YF}/%5EVIX?interval=1d&range=5d`, { headers: HEADERS, next: { revalidate: 3600 } }),
    ]);
    let spyAbove200 = false;
    if (sr.ok) { const sd = await sr.json(); const sc: number[] = (sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v)); if (sc.length >= 200) spyAbove200 = sc[sc.length - 1] > calcMA(sc, 200); }
    let vix = 20;
    if (vr.ok) { const vd = await vr.json(); const vc: number[] = (vd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v)); if (vc.length > 0) vix = Math.round(vc[vc.length - 1] * 10) / 10; }
    const regime: Regime = spyAbove200 && vix < 20 ? 'BULL' : spyAbove200 && vix < 25 ? 'NEUTRAL' : !spyAbove200 && vix < 35 ? 'CAUTION' : 'BEAR';
    const label = { BULL: '강세장', NEUTRAL: '중립', CAUTION: '약세주의', BEAR: '약세장' }[regime];
    const emoji = { BULL: '🟢', NEUTRAL: '🟡', CAUTION: '🟠', BEAR: '🔴' }[regime];
    return { regime, label, emoji, vix };
  } catch { return null; }
}

function applyRegime(signal: string, score: number, regime: Regime) {
  if (regime === 'BULL') return { signal, score, note: null as string | null };
  if (regime === 'NEUTRAL' && signal === 'BREAKOUT') return { signal: 'SETUP', score: Math.max(0, score - 5), note: '🟡 중립 시장 — 신호 하향' };
  if (regime === 'CAUTION') {
    if (signal === 'BREAKOUT') return { signal: 'SETUP', score: Math.max(0, score - 10), note: '🟠 약세주의 — 신호 하향' };
    if (signal === 'SETUP') return { signal: 'WATCH', score: Math.max(0, score - 10), note: '🟠 약세주의 — 신호 하향' };
  }
  if (regime === 'BEAR' && ['BREAKOUT', 'SETUP', 'WATCH', 'COILING'].includes(signal))
    return { signal: 'HOLD', score: Math.max(0, score - 20), note: '🔴 약세장 — 진입 신호 무효화' };
  return { signal, score, note: null as string | null };
}

// ── R/R 계산 ──────────────────────────────────────────────────────────────────
function calcRR(entry: string | null, stop: string | null, resistance: string | null, price: number) {
  const parse = (s: string | null) => { const m = s?.match(/\$(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null; };
  const ep = parse(entry) ?? price, sp = parse(stop), rp = parse(resistance);
  if (!sp || !rp) return { rrRatio: null as number | null, rrGrade: null as string | null, rrLabel: '계산 불가' };
  const risk = Math.abs(ep - sp), reward = Math.abs(rp - ep);
  if (risk === 0) return { rrRatio: null as number | null, rrGrade: null as string | null, rrLabel: '계산 불가' };
  const rr = Math.round((reward / risk) * 10) / 10;
  const grade = rr >= 4 ? 'EXCELLENT' : rr >= 2.5 ? 'GOOD' : rr >= 1.5 ? 'FAIR' : 'POOR';
  return { rrRatio: rr, rrGrade: grade, rrLabel: `1 : ${rr}` };
}

// ── 진입 구간 계산 ────────────────────────────────────────────────────────────
function calcEntry(price: number, mas: Record<string, number>, atr: number, signal: string, vcp: { isVCP: boolean; pivotPrice: number | null }, pivot: { isBroken: boolean; withinChaseLimit: boolean }) {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (signal === 'HOLD' || signal === 'SELL' || signal === 'STRONG_SELL') return { entry: null, stop: `$${r(price - 2 * atr)}` };
  if (vcp.isVCP && vcp.pivotPrice && pivot.isBroken && pivot.withinChaseLimit) return { entry: `$${r(vcp.pivotPrice)}–$${r(vcp.pivotPrice * 1.03)}`, stop: `$${r(vcp.pivotPrice * 0.97)}` };
  if (vcp.isVCP && vcp.pivotPrice && !pivot.isBroken) return { entry: `$${r(vcp.pivotPrice)} (피봇 돌파 대기)`, stop: `$${r(vcp.pivotPrice * 0.97)}` };
  for (const p of [10, 20, 50]) { const ma = mas[`ma${p}`]; if (!isNaN(ma) && price > ma && price - ma < atr * 1.5) return { entry: `$${r(ma * 1.001)}–$${r(ma + atr * 0.5)} (MA${p} 지지)`, stop: `$${r(ma - atr * 0.5)}` }; }
  return { entry: `$${r(price * 0.99)}–$${r(price * 1.005)}`, stop: `$${r(price - 2 * atr)}` };
}

// ── 트레일링 스탑 ─────────────────────────────────────────────────────────────
function calcTrail(price: number, atr: number, entry: string | null) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const ep = entry?.match(/\$(\d+\.?\d*)/)?.[1] ? parseFloat(entry.match(/\$(\d+\.?\d*)/)![1]) : price;
  const mult = (atr / price) * 100 <= 2 ? 2.5 : (atr / price) * 100 <= 4 ? 2.0 : 1.5;
  return { initial: r(ep - atr * mult), stop10: r(ep * 1.10 - atr * mult), stop20: r(ep * 1.20 - atr * mult), stop30: r(ep * 1.30 - atr * mult), mult, breakEven: r(ep * 1.005) };
}

// ── 주간 데이터 ───────────────────────────────────────────────────────────────
async function fetchWeekly(ticker: string) {
  try {
    const res = await fetch(`${YF}/${ticker}?interval=1wk&range=2y`, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return null;
    const cs: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: number) => c != null && !isNaN(c));
    if (cs.length < 20) return null;
    const price = cs[cs.length - 1], ma10 = calcMA(cs, 10), ma20 = calcMA(cs, 20), ma40 = calcMA(cs, Math.min(40, cs.length));
    const aboveAll = price > ma10 && price > ma20 && price > ma40;
    const t8 = cs[Math.max(0, cs.length - 8)], trendPct = ((price - t8) / t8) * 100;
    const trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = trendPct > 5 ? 'UPTREND' : trendPct < -5 ? 'DOWNTREND' : 'SIDEWAYS';
    const h13 = Math.max(...cs.slice(-13)), pullback = Math.round(((price - h13) / h13) * 1000) / 10;
    const isEntry = trend === 'UPTREND' && aboveAll && pullback >= -8 && pullback <= -2;
    return { trend, aboveAll, pullback, isEntry, rsi: Math.round(calcRSI(cs.slice(-20)) * 10) / 10 };
  } catch { return null; }
}

// ── 메인 Quote Fetch ──────────────────────────────────────────────────────────
async function fetchQuote(ticker: string, spyCs: number[]) {
  try {
    const res = await fetch(`${YF}/${ticker}?interval=1d&range=2y`, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return null;
    const q = result.indicators?.quote?.[0] ?? {}, ts: number[] = result.timestamp ?? [];
    const valid = (q.close as number[] ?? []).map((c: number, i: number) => ({ c, h: (q.high as number[])[i] ?? c, l: (q.low as number[])[i] ?? c, v: (q.volume as number[])[i] ?? 0, t: ts[i] ?? 0 })).filter(x => x.c != null && !isNaN(x.c));
    if (valid.length < 60) return null;
    const cs = valid.map(x => x.c), hs = valid.map(x => x.h), ls = valid.map(x => x.l), vs = valid.map(x => x.v);
    const price = cs[cs.length - 1];
    const ma10 = calcMA(cs, 10), ma20 = calcMA(cs, 20), ma50 = calcMA(cs, 50), ma150 = calcMA(cs, Math.min(150, cs.length)), ma200 = calcMA(cs, Math.min(200, cs.length));
    const high52 = Math.max(...cs.slice(-252)), low52 = Math.min(...cs.slice(-252));
    const distFromHigh = ((price - high52) / high52) * 100;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx = valid.findIndex(x => x.t >= yearStart);
    const ytd = ((price - cs[ytdIdx >= 0 ? ytdIdx : 0]) / cs[ytdIdx >= 0 ? ytdIdx : 0]) * 100;
    const mom3m = ((price - cs[Math.max(0, cs.length - 63)]) / cs[Math.max(0, cs.length - 63)]) * 100;
    const rsi = calcRSI(cs.slice(-30));
    const { histogram, prevHistogram } = calcMACD(cs);
    const bb = calcBB(cs);
    const atrAbs = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
    const volRatio = calcVolRatio(vs);
    const obv = calcOBV(cs.slice(-60), vs.slice(-60));
    const rsLine = calcRSLine(cs, spyCs);
    const vcp = detectVCP(cs, vs, high52);
    const pivotDist = vcp.pivotPrice ? ((price - vcp.pivotPrice) / vcp.pivotPrice) * 100 : 0;
    const pivot = { isBroken: vcp.pivotPrice ? price > vcp.pivotPrice : false, distFromPivot: Math.round(pivotDist * 10) / 10, withinChaseLimit: pivotDist > 0 && pivotDist <= 3 };
    const setup = detectSetup(cs.slice(-100), hs.slice(-100), ls.slice(-100), vs.slice(-30), ma50, ma150, ma200);
    const pp = detectPocketPivot(cs, vs, ma10);
    const brk52 = detect52w(cs, vs);
    const weekly = await fetchWeekly(ticker);

    // MA 정렬
    const aboveMAs = [ma10, ma20, ma50, ma150, ma200].filter(m => !isNaN(m) && price > m).length;
    const stackedBull = [ma10, ma20, ma50, ma150, ma200].every((m, i, arr) => i === 0 || (isNaN(arr[i - 1]) || isNaN(m) || arr[i - 1] > m));

    // 진입/손절
    const maMap = { ma10, ma20, ma50 };
    const { entry, stop } = calcEntry(price, maMap, atrAbs, 'CHECK', vcp, pivot);
    const resistance = `$${Math.round(high52 * 100) / 100}`;
    const { rrRatio, rrGrade, rrLabel } = calcRR(entry, stop, resistance, price);
    const trail = calcTrail(price, atrAbs, entry);

    // 모멘텀 점수
    const macdBull = histogram > 0, macdExpanding = histogram > prevHistogram;
    const isMomentumMode = stackedBull && macdBull && macdExpanding && aboveMAs >= 4;
    let score = 0;
    score += (vcp.score / 100) * 15;
    if (pivot.isBroken && pivot.withinChaseLimit) score += 10; else if (vcp.isVCP && pivot.distFromPivot >= -5) score += 5;
    if (brk52.isBreakout && brk52.breakoutDay === 0 && brk52.volConfirmed) score += 5; else if (brk52.isBreakout) score += 2;
    if (rsLine.divergence === 'BULLISH') score += 15; else if (rsLine.rsLineTrend === 'UP') score += 8; else if (rsLine.rsLineTrend === 'DOWN') score -= 3;
    score += aboveMAs * 2;
    if (stackedBull) score += 5;
    if (weekly?.trend === 'UPTREND' && weekly.isEntry) score += 5; else if (weekly?.trend === 'UPTREND') score += 2; else if (weekly?.trend === 'DOWNTREND') score -= 5;
    if (rsi >= 50 && rsi <= 70) score += 5; else if (rsi > 78 && !isMomentumMode) score -= 2; else if (rsi > 85) score -= 4;
    if (volRatio >= 1.5) score += 3; else if (volRatio < 0.7) score -= 2;
    if (macdBull && macdExpanding) score += 4; else if (macdBull) score += 1; else if (!macdBull) score -= 2;
    if (obv.trend === 'UP') score += 3; else if (obv.trend === 'DOWN') score -= 2;
    if (pp.isPocketPivot && pp.daysAgo === 0) score += 5; else if (pp.isPocketPivot) score += 3;
    score = Math.max(0, Math.min(100, Math.round(score)));

    // 신호
    let signal = 'HOLD';
    const rsiOk = rsi >= 45 && rsi <= 75;
    if (brk52.isBreakout && brk52.breakoutDay === 0 && brk52.volConfirmed && aboveMAs >= 3) signal = 'BREAKOUT';
    else if (vcp.isVCP && pivot.isBroken && pivot.withinChaseLimit && volRatio > 1.5 && aboveMAs >= 3) signal = 'BREAKOUT';
    else if (score >= 85 && aboveMAs >= 4 && stackedBull && macdBull && rsiOk) signal = 'BREAKOUT';
    else if (vcp.isVCP && !pivot.isBroken && pivot.distFromPivot >= -5 && aboveMAs >= 3) signal = 'SETUP';
    else if (pp.isPocketPivot && aboveMAs >= 3 && macdBull) signal = 'SETUP';
    else if (score >= 70 && aboveMAs >= 3) signal = 'SETUP';
    else if (setup.isCoiling && setup.setupScore >= 55 && score < 70) signal = 'COILING';
    else if (score >= 50 && aboveMAs >= 2) signal = 'WATCH';
    else if (score <= 15 || (aboveMAs === 0 && !macdBull)) signal = 'STRONG_SELL';
    else if (score <= 35 || aboveMAs <= 1) signal = 'SELL';

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      ticker, price: r2(price), ytd: r2(ytd), mom3m: r2(mom3m),
      rsi, macd_histogram: histogram, prev_macd_histogram: prevHistogram, bb_position: bb,
      atr_pct: r2((atrAbs / price) * 100), atr_abs: r2(atrAbs), volume_ratio: volRatio,
      ma10: r2(ma10), ma20: r2(ma20), ma50: r2(ma50), ma200: r2(ma200),
      high52, low52, dist_from_high: r2(distFromHigh),
      above_ma_count: aboveMAs, stacked_bull: stackedBull,
      ma50_status: price > ma50 * 1.01 ? 'ABOVE' : price < ma50 * 0.99 ? 'BELOW' : 'AT',
      momentum_score: score, signal,
      setup_score: setup.setupScore, setup_label: setup.setupLabel, setup_stage: setup.stage,
      setup_base_weeks: setup.baseWeeks, setup_atr_contraction: setup.atrContraction,
      setup_price_range: setup.priceRangePct, setup_vol_drying: setup.volDrying,
      setup_dist_pivot: setup.distFromPivot, setup_is_coiling: setup.isCoiling,
      vcp_score: vcp.score, vcp_is_vcp: vcp.isVCP, vcp_pivot: vcp.pivotPrice,
      vcp_contraction_count: vcp.contractionCount, vcp_base_weeks: vcp.baseWeeks,
      vcp_last_pullback: vcp.lastPullbackPct, vcp_lowest_vol: vcp.lowestVolWeekInBase, vcp_detail: vcp.detail,
      pivot_broken: pivot.isBroken, pivot_dist: pivot.distFromPivot, pivot_within_chase: pivot.withinChaseLimit,
      breakout_52w: brk52.isBreakout, breakout_52w_day: brk52.breakoutDay,
      breakout_52w_vol: brk52.volConfirmed, breakout_52w_detail: brk52.detail,
      obv_trend: obv.trend, obv_detail: obv.detail,
      rs_line_trend: rsLine.rsLineTrend, rs_line_divergence: rsLine.divergence,
      rs_line_3m_change: rsLine.rs3mChange, rs_line_new_high: rsLine.rsLineNewHigh,
      rs_line_spy_new_low: rsLine.spyNewLow, rs_line_detail: rsLine.detail,
      weekly_trend: weekly?.trend ?? null, weekly_is_entry: weekly?.isEntry ?? false,
      weekly_above_mas: weekly?.aboveAll ?? false, weekly_pullback: weekly?.pullback ?? null, weekly_rsi: weekly?.rsi ?? null,
      pocket_pivot: pp.isPocketPivot, pocket_pivot_days_ago: pp.daysAgo,
      pocket_pivot_vol_ratio: pp.volRatio, pocket_pivot_detail: pp.detail,
      entry_zone: entry, stop_loss: stop, key_resistance: resistance,
      rr_ratio: rrRatio, rr_grade: rrGrade, rr_label: rrLabel,
      trail_initial: trail.initial, trail_stop_10: trail.stop10, trail_stop_20: trail.stop20,
      trail_stop_30: trail.stop30, trail_mult: trail.mult, trail_break_even: trail.breakEven,
    };
  } catch { return null; }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let tickers: string[];
  try { const b = await req.json(); tickers = b.tickers; if (!Array.isArray(tickers) || tickers.length === 0) throw new Error(); }
  catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }

  const [regime, spyRes] = await Promise.all([fetchRegime(), fetch(`${YF}/SPY?interval=1d&range=2y`, { headers: HEADERS, next: { revalidate: 0 } })]);
  let spyCs: number[] = [];
  if (spyRes.ok) { const sd = await spyRes.json(); spyCs = (sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v)); }

  const quotes = await Promise.all(tickers.map(t => fetchQuote(t, spyCs)));
  const valid = quotes.filter(q => q !== null);
  if (valid.length === 0) return NextResponse.json({ error: '데이터 없음' }, { status: 500 });

  const r = regime?.regime ?? 'BULL';
  const stocks = valid.map(q => {
    const adj = applyRegime(q!.signal, q!.momentum_score, r);
    return { ...q, signal: adj.signal, momentum_score: adj.score, regime_note: adj.note };
  });

  return NextResponse.json({
    stocks,
    market_regime: regime,
    analyzed_at: new Date().toISOString(),
  });
}
