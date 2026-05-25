'use client';

import { useState, useEffect, useRef } from 'react';

interface ChartData {
  ticker: string;
  dates: string[];
  prices: number[];
  scores: number[];
}

interface BuySignal {
  idx: number;
  price: number;
  score: number;
  date: string;
  type: 'REVERSAL' | 'CROSS';  // 바닥 반등 or 40선 돌파
}

interface StockChartProps {
  ticker: string;
  avgPrice?: number;
  currentScore?: number;
  defaultOpen?: boolean;
}

const PERIOD_OPTIONS = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
];

// ── 매수 타이밍 감지 ──────────────────────────────────────────────────────────
// 1. REVERSAL: 점수가 35 이하에서 3일 연속 상승 시작
// 2. CROSS:    점수가 40 아래에서 40 위로 돌파
function detectBuySignals(scores: number[], prices: number[], dates: string[]): BuySignal[] {
  const signals: BuySignal[] = [];
  const MIN_GAP = 10; // 신호 간 최소 간격 (중복 방지)
  let lastSignalIdx = -MIN_GAP;

  for (let i = 5; i < scores.length - 1; i++) {
    if (i - lastSignalIdx < MIN_GAP) continue;

    const s     = scores[i];
    const sPrev = scores[i - 1];
    const sPrev2 = scores[i - 2];
    const sPrev3 = scores[i - 3];

    // REVERSAL: 바닥(≤35)에서 3일 연속 반등
    const wasLow    = Math.min(sPrev3, sPrev2, sPrev) <= 35;
    const rising3   = s > sPrev && sPrev > sPrev2;
    const priceRise = prices[i] >= prices[i - 2]; // 주가도 같이 올라야
    if (wasLow && rising3 && priceRise && s >= 35) {
      signals.push({ idx: i, price: prices[i], score: s, date: dates[i], type: 'REVERSAL' });
      lastSignalIdx = i;
      continue;
    }

    // CROSS: 40선 아래→위 돌파
    const crossUp = sPrev <= 40 && s > 40;
    const prevWasLow = scores.slice(Math.max(0, i - 8), i).some(sc => sc <= 35);
    if (crossUp && prevWasLow) {
      signals.push({ idx: i, price: prices[i], score: s, date: dates[i], type: 'CROSS' });
      lastSignalIdx = i;
    }
  }
  return signals;
}

export default function StockChart({ ticker, avgPrice, currentScore, defaultOpen = false }: StockChartProps) {
  const [open,    setOpen]    = useState(defaultOpen);
  const [data,    setData]    = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [period,  setPeriod]  = useState(6);
  const [hover,   setHover]   = useState<{ x: number; idx: number } | null>(null);
  const [signals, setSignals] = useState<BuySignal[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const loaded = useRef(false);

  // 처음 열릴 때만 fetch
  useEffect(() => {
    if (!open) return;
    if (loaded.current && data && data.ticker === ticker) return; // 이미 로드됨
    setLoading(true);
    fetch(`/api/chart?ticker=${ticker}&months=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.dates) {
          setData(d);
          setSignals(detectBuySignals(d.scores, d.prices, d.dates));
          loaded.current = true;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, ticker, period]);

  // 기간 바꾸면 재fetch
  useEffect(() => {
    if (!open) return;
    loaded.current = false;
    setLoading(true);
    setData(null);
    fetch(`/api/chart?ticker=${ticker}&months=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.dates) {
          setData(d);
          setSignals(detectBuySignals(d.scores, d.prices, d.dates));
          loaded.current = true;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]); // eslint-disable-line

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* 토글 헤더 */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-900/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold font-mono text-zinc-300">{ticker}</span>
          <span className="text-[9px] text-zinc-600">주가 + 점수 차트</span>
          {signals.length > 0 && !open && (
            <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
              매수 타이밍 {signals.length}회
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentScore !== undefined && (
            <span className="text-[10px] font-mono font-bold"
              style={{ color: currentScore >= 60 ? '#10b981' : currentScore >= 40 ? '#f59e0b' : '#ef4444' }}>
              {currentScore}점
            </span>
          )}
          <span className="text-zinc-600 text-xs">{open ? '▲ 접기' : '▼ 펼치기'}</span>
        </div>
      </button>

      {/* 차트 본문 */}
      {open && (
        <>
          {loading ? (
            <div className="flex items-center justify-center h-44 text-zinc-600 text-xs border-t border-zinc-900">
              <span className="blink">▋</span>&nbsp;차트 로딩 중...
            </div>
          ) : !data || data.prices.length < 5 ? (
            <div className="flex items-center justify-center h-44 text-zinc-700 text-xs border-t border-zinc-900">
              차트 데이터 없음
            </div>
          ) : (
            <ChartBody
              data={data}
              signals={signals}
              avgPrice={avgPrice}
              currentScore={currentScore}
              period={period}
              setPeriod={setPeriod}
              hover={hover}
              setHover={setHover}
              svgRef={svgRef}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── 차트 본체 분리 ─────────────────────────────────────────────────────────────
function ChartBody({ data, signals, avgPrice, currentScore, period, setPeriod, hover, setHover, svgRef }: {
  data: ChartData;
  signals: BuySignal[];
  avgPrice?: number;
  currentScore?: number;
  period: number;
  setPeriod: (p: number) => void;
  hover: { x: number; idx: number } | null;
  setHover: (h: { x: number; idx: number } | null) => void;
  svgRef: React.RefObject<SVGSVGElement>;
}) {
  const { dates, prices, scores } = data;
  const W = 600, H = 200, PX = 8, PY = 18, PY_BOT = 28;
  const innerW = W - PX * 2, innerH = H - PY - PY_BOT;

  const pMin = Math.min(...prices) * 0.97;
  const pMax = Math.max(...prices) * 1.03;
  const pRange = pMax - pMin || 1;

  const px = (i: number) => PX + (i / Math.max(prices.length - 1, 1)) * innerW;
  const py = (p: number) => PY + innerH - ((p - pMin) / pRange) * innerH;
  const sy = (s: number) => PY + innerH - (s / 100) * innerH;

  const pricePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
  const scorePath = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${sy(s).toFixed(1)}`).join(' ');
  const priceArea = `${pricePath} L${px(prices.length - 1).toFixed(1)},${(PY + innerH).toFixed(1)} L${PX},${(PY + innerH).toFixed(1)} Z`;

  const avgY = avgPrice ? py(avgPrice) : null;
  const avgInRange = avgY !== null && avgY >= PY && avgY <= PY + innerH;
  const lastPrice = prices[prices.length - 1];
  const lastScore = scores[scores.length - 1];
  const changeP = prices.length > 1 ? ((lastPrice - prices[0]) / prices[0] * 100).toFixed(1) : '0';

  const hoverPrice = hover ? prices[hover.idx] : null;
  const hoverScore = hover ? scores[hover.idx] : null;
  const hoverDate  = hover ? dates[hover.idx]  : null;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = Math.max(0, Math.min(1, (relX - PX) / innerW));
    const idx   = Math.round(ratio * (prices.length - 1));
    setHover({ x: px(idx), idx });
  }

  return (
    <div className="border-t border-zinc-900">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          {hoverPrice ? (
            <>
              <span className="text-xs font-mono text-zinc-200">${hoverPrice.toFixed(2)}</span>
              <span className="text-[9px] text-zinc-500">{hoverDate}</span>
              <span className="text-[9px] font-mono font-bold"
                style={{ color: (hoverScore ?? 0) >= 60 ? '#10b981' : (hoverScore ?? 0) >= 40 ? '#f59e0b' : '#ef4444' }}>
                {hoverScore}점
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-mono text-zinc-200">${lastPrice.toFixed(2)}</span>
              <span className={`text-xs font-mono ${parseFloat(changeP) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(changeP) >= 0 ? '+' : ''}{changeP}%
              </span>
              {signals.length > 0 && (
                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                  ▲ 매수 타이밍 {signals.length}회
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 text-[8px] text-zinc-600 mr-1">
            <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />주가
            <span className="w-3 inline-block ml-1" style={{ borderTop: '1.5px dashed #94a3b8' }} />점수
          </span>
          {PERIOD_OPTIONS.map(o => (
            <button key={o.months} onClick={() => setPeriod(o.months)}
              className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${period === o.months ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG */}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g-${data.ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* 그리드 */}
        {[0, 25, 50, 75, 100].map(pct => {
          const yy = PY + innerH * (1 - pct / 100);
          return (
            <g key={pct}>
              <line x1={PX} y1={yy} x2={W - PX} y2={yy} stroke="#27272a" strokeWidth="0.5" />
              <text x={PX + 2} y={yy - 2} fontSize="7" fill="#3f3f46">${(pMin + pRange * pct / 100).toFixed(0)}</text>
            </g>
          );
        })}

        {/* 점수 기준선 40/60 */}
        <line x1={PX} y1={sy(60)} x2={W - PX} y2={sy(60)} stroke="#10b981" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.25" />
        <line x1={PX} y1={sy(40)} x2={W - PX} y2={sy(40)} stroke="#ef4444" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.25" />
        <line x1={PX} y1={sy(35)} x2={W - PX} y2={sy(35)} stroke="#f59e0b" strokeWidth="0.5" strokeDasharray="2,5" opacity="0.2" />
        <text x={W - PX - 2} y={sy(60) - 2} fontSize="6" fill="#10b981" textAnchor="end" opacity="0.5">60</text>
        <text x={W - PX - 2} y={sy(40) - 2} fontSize="6" fill="#ef4444" textAnchor="end" opacity="0.5">40</text>

        {/* 가격 영역 */}
        <path d={priceArea} fill={`url(#g-${data.ticker})`} />
        <path d={pricePath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />

        {/* 점수 선 */}
        <path d={scorePath} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4,3" strokeLinejoin="round" opacity="0.85" />

        {/* 평단가 */}
        {avgInRange && avgY !== null && (
          <g>
            <line x1={PX} y1={avgY} x2={W - PX} y2={avgY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.7" />
            <text x={PX + 4} y={avgY - 3} fontSize="7" fill="#f59e0b" opacity="0.9">평단 ${avgPrice?.toFixed(2)}</text>
          </g>
        )}

        {/* ── 매수 타이밍 마커 ── */}
        {signals.map((sig, idx) => {
          const mx = px(sig.idx);
          const my = py(sig.price);
          const isReversal = sig.type === 'REVERSAL';
          return (
            <g key={idx}>
              {/* 수직 점선 */}
              <line x1={mx} y1={PY} x2={mx} y2={PY + innerH}
                stroke={isReversal ? '#10b981' : '#34d399'}
                strokeWidth="0.8" strokeDasharray="2,3" opacity="0.5" />
              {/* 주가 위 삼각형 마커 */}
              <polygon
                points={`${mx},${my - 10} ${mx - 5},${my - 3} ${mx + 5},${my - 3}`}
                fill={isReversal ? '#10b981' : '#34d399'}
                opacity="0.9" />
              {/* 라벨 */}
              <text x={mx} y={my - 13} fontSize="7" fill={isReversal ? '#10b981' : '#34d399'}
                textAnchor="middle" fontWeight="bold">
                {isReversal ? '▲반등' : '▲돌파'}
              </text>
            </g>
          );
        })}

        {/* hover */}
        {hover && (
          <g>
            <line x1={hover.x} y1={PY} x2={hover.x} y2={PY + innerH} stroke="#52525b" strokeWidth="0.8" strokeDasharray="2,2" />
            <circle cx={hover.x} cy={py(prices[hover.idx])} r="3" fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx={hover.x} cy={sy(scores[hover.idx])} r="2.5" fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />
          </g>
        )}

        {/* 현재 끝점 */}
        {!hover && (
          <g>
            <circle cx={px(prices.length - 1)} cy={py(lastPrice)} r="2.5" fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx={px(scores.length - 1)} cy={sy(lastScore)} r="2" fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />
          </g>
        )}

        {/* X축 날짜 */}
        {[0, Math.floor(dates.length / 2), dates.length - 1].map(i => (
          <text key={i} x={px(i)} y={H - 6} fontSize="7" fill="#52525b" textAnchor="middle">{dates[i]?.slice(5)}</text>
        ))}
      </svg>

      {/* 매수 타이밍 설명 */}
      {signals.length > 0 && (
        <div className="px-3 pb-2 border-t border-zinc-900 pt-2 flex flex-wrap gap-2">
          {signals.map((sig, i) => (
            <span key={i} className={`text-[9px] px-2 py-1 rounded border ${sig.type === 'REVERSAL' ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400' : 'bg-sky-950/40 border-sky-800 text-sky-400'}`}>
              {sig.type === 'REVERSAL' ? '▲ 바닥반등' : '▲ 40선돌파'} {sig.date.slice(5)} · ${sig.price.toFixed(2)} · 점수 {sig.score}
            </span>
          ))}
        </div>
      )}

      {/* 점수 바 */}
      <div className="px-3 pb-2 pt-1 border-t border-zinc-900 flex items-center gap-3">
        <span className="text-[9px] text-zinc-600">현재 점수</span>
        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full"
            style={{ width: `${currentScore ?? lastScore}%`, background: (currentScore ?? lastScore) >= 60 ? '#10b981' : (currentScore ?? lastScore) >= 40 ? '#f59e0b' : '#ef4444' }} />
        </div>
        <span className="text-[10px] font-mono font-bold"
          style={{ color: (currentScore ?? lastScore) >= 60 ? '#10b981' : (currentScore ?? lastScore) >= 40 ? '#f59e0b' : '#ef4444' }}>
          {currentScore ?? lastScore}
        </span>
      </div>
    </div>
  );
}
