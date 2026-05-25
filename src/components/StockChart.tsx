'use client';

import { useState, useEffect, useRef } from 'react';

interface ChartData {
  ticker: string;
  dates: string[];
  prices: number[];
  scores: number[];
}

interface StockChartProps {
  ticker: string;
  avgPrice?: number;   // 평단가 — 수평선으로 표시
  currentScore?: number;
}

const PERIOD_OPTIONS = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
];

export default function StockChart({ ticker, avgPrice, currentScore }: StockChartProps) {
  const [data,    setData]    = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period,  setPeriod]  = useState(6);
  const [hover,   setHover]   = useState<{ x: number; idx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/chart?ticker=${ticker}&months=${period}`)
      .then(r => r.json())
      .then(d => { if (d.dates) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker, period]);

  if (loading) return (
    <div className="flex items-center justify-center h-40 text-zinc-600 text-xs">
      <span className="blink">▋</span>&nbsp;차트 로딩 중...
    </div>
  );
  if (!data || data.prices.length < 5) return (
    <div className="flex items-center justify-center h-40 text-zinc-700 text-xs">차트 데이터 없음</div>
  );

  const { dates, prices, scores } = data;
  const W = 600, H = 180, PX = 8, PY = 16, PY_BOT = 28;
  const innerW = W - PX * 2, innerH = H - PY - PY_BOT;

  // 가격 범위
  const pMin = Math.min(...prices) * 0.98;
  const pMax = Math.max(...prices) * 1.02;
  const pRange = pMax - pMin || 1;

  // 점수 범위 (0~100 고정)
  const sMin = 0, sMax = 100;

  const px = (i: number) => PX + (i / (prices.length - 1)) * innerW;
  const py = (p: number) => PY + innerH - ((p - pMin) / pRange) * innerH;
  const sy = (s: number) => PY + innerH - ((s - sMin) / (sMax - sMin)) * innerH;

  // SVG path 생성
  const pricePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
  const scorePath = scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${sy(s).toFixed(1)}`).join(' ');

  // 가격 영역 채우기
  const priceArea = `${pricePath} L${px(prices.length - 1).toFixed(1)},${(PY + innerH).toFixed(1)} L${PX},${(PY + innerH).toFixed(1)} Z`;

  // 평단가 Y 위치
  const avgY = avgPrice ? py(avgPrice) : null;
  const avgInRange = avgY !== null && avgY >= PY && avgY <= PY + innerH;

  // 현재값
  const lastPrice = prices[prices.length - 1];
  const lastScore = scores[scores.length - 1];
  const lastPriceChange = prices.length > 1
    ? ((lastPrice - prices[0]) / prices[0] * 100).toFixed(1)
    : '0';

  // hover 정보
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold font-mono text-zinc-100">{ticker}</span>
          {hoverPrice ? (
            <>
              <span className="text-xs font-mono text-zinc-300">${hoverPrice.toFixed(2)}</span>
              <span className="text-[10px] text-zinc-500">{hoverDate}</span>
              <span className="text-[10px] font-mono" style={{ color: hoverScore && hoverScore >= 60 ? '#10b981' : hoverScore && hoverScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                점수 {hoverScore}
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-mono text-zinc-200">${lastPrice.toFixed(2)}</span>
              <span className={`text-xs font-mono ${parseFloat(lastPriceChange) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(lastPriceChange) >= 0 ? '+' : ''}{lastPriceChange}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 범례 */}
          <div className="flex items-center gap-2 mr-2">
            <span className="flex items-center gap-1 text-[9px] text-zinc-500">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block" />주가
            </span>
            <span className="flex items-center gap-1 text-[9px] text-zinc-500">
              <span className="w-3 h-0.5 inline-block" style={{ background: '#e2e8f0', borderTop: '1px dashed #94a3b8' }} />점수
            </span>
          </div>
          {/* 기간 선택 */}
          {PERIOD_OPTIONS.map(o => (
            <button key={o.months} onClick={() => setPeriod(o.months)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${period === o.months ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG 차트 */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 180 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}>

        <defs>
          {/* 가격 그라디언트 */}
          <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
          {/* 점수 그라디언트 (우측 Y축 색) */}
          <linearGradient id={`score-grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#94a3b8" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y축 그리드 (가격) */}
        {[0, 25, 50, 75, 100].map(pct => {
          const yy = PY + innerH * (1 - pct / 100);
          const priceVal = pMin + (pRange * pct / 100);
          return (
            <g key={pct}>
              <line x1={PX} y1={yy} x2={W - PX} y2={yy} stroke="#27272a" strokeWidth="0.5" />
              <text x={PX + 2} y={yy - 2} fontSize="7" fill="#52525b">${priceVal.toFixed(0)}</text>
            </g>
          );
        })}

        {/* 점수 Y축 라벨 (우측) */}
        {[0, 50, 100].map(s => (
          <text key={s} x={W - PX - 2} y={sy(s) - 2} fontSize="7" fill="#475569" textAnchor="end">{s}</text>
        ))}

        {/* 점수 60/40 기준선 */}
        <line x1={PX} y1={sy(60)} x2={W - PX} y2={sy(60)} stroke="#10b981" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.3" />
        <line x1={PX} y1={sy(40)} x2={W - PX} y2={sy(40)} stroke="#ef4444" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.3" />
        <text x={W - PX - 2} y={sy(60) - 2} fontSize="6" fill="#10b981" textAnchor="end" opacity="0.6">60</text>
        <text x={W - PX - 2} y={sy(40) - 2} fontSize="6" fill="#ef4444" textAnchor="end" opacity="0.6">40</text>

        {/* 가격 영역 채우기 */}
        <path d={priceArea} fill={`url(#grad-${ticker})`} />

        {/* 가격 선 */}
        <path d={pricePath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />

        {/* 점수 선 (흰색 점선) */}
        <path d={scorePath} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4,3" strokeLinejoin="round" opacity="0.8" />

        {/* 평단가 수평선 */}
        {avgInRange && avgY !== null && (
          <g>
            <line x1={PX} y1={avgY} x2={W - PX} y2={avgY}
              stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.7" />
            <text x={PX + 4} y={avgY - 3} fontSize="7" fill="#f59e0b" opacity="0.9">
              평단 ${avgPrice?.toFixed(2)}
            </text>
          </g>
        )}

        {/* hover 수직선 + 포인트 */}
        {hover && (
          <g>
            <line x1={hover.x} y1={PY} x2={hover.x} y2={PY + innerH}
              stroke="#52525b" strokeWidth="0.8" strokeDasharray="2,2" />
            <circle cx={hover.x} cy={py(prices[hover.idx])} r="3"
              fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx={hover.x} cy={sy(scores[hover.idx])} r="2.5"
              fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />
          </g>
        )}

        {/* 현재 점수 끝점 강조 */}
        {!hover && (
          <g>
            <circle cx={px(prices.length - 1)} cy={py(lastPrice)} r="2.5"
              fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx={px(scores.length - 1)} cy={sy(lastScore)} r="2"
              fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />
          </g>
        )}

        {/* X축 날짜 라벨 */}
        {[0, Math.floor(dates.length / 2), dates.length - 1].map(i => (
          <text key={i} x={px(i)} y={H - 6} fontSize="7" fill="#52525b" textAnchor="middle">
            {dates[i]?.slice(5)}
          </text>
        ))}
      </svg>

      {/* 하단 현재 점수 바 */}
      <div className="px-3 pb-2 pt-1 border-t border-zinc-900 flex items-center gap-3">
        <span className="text-[9px] text-zinc-600">현재 점수</span>
        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
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
