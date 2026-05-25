'use client';

import { useState, useEffect, useRef } from 'react';

interface ChartData {
  ticker: string;
  dates: string[];
  prices: number[];
  scores: number[];
  intraday: boolean;
}

interface BuySignal {
  idx: number; price: number; score: number; date: string; type: 'REVERSAL' | 'CROSS';
}

interface StockChartProps {
  ticker: string;
  avgPrice?: number;
  currentScore?: number;
}

const PERIODS = [
  { label: '1D', value: '1d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
];

function detectBuySignals(scores: number[], prices: number[], dates: string[]): BuySignal[] {
  const signals: BuySignal[] = [];
  let lastIdx = -10;
  for (let i = 5; i < scores.length - 1; i++) {
    if (i - lastIdx < 10) continue;
    const s = scores[i], s1 = scores[i-1], s2 = scores[i-2], s3 = scores[i-3];
    if (Math.min(s3,s2,s1) <= 35 && s > s1 && s1 > s2 && prices[i] >= prices[i-2] && s >= 35) {
      signals.push({ idx: i, price: prices[i], score: s, date: dates[i], type: 'REVERSAL' });
      lastIdx = i; continue;
    }
    if (s1 <= 40 && s > 40 && scores.slice(Math.max(0,i-8),i).some(sc => sc <= 35)) {
      signals.push({ idx: i, price: prices[i], score: s, date: dates[i], type: 'CROSS' });
      lastIdx = i;
    }
  }
  return signals;
}

export default function StockChart({ ticker, avgPrice, currentScore }: StockChartProps) {
  const [data,    setData]    = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period,  setPeriod]  = useState('1d'); // 기본 1D
  const [signals, setSignals] = useState<BuySignal[]>([]);
  const [hover,   setHover]   = useState<{ x: number; idx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/chart?ticker=${ticker}&period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.dates) {
          setData(d);
          if (!d.intraday) setSignals(detectBuySignals(d.scores, d.prices, d.dates));
          else setSignals([]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker, period]);

  const W = 600, H = 190, PX = 8, PY = 16, PY_BOT = 24;
  const innerW = W - PX * 2, innerH = H - PY - PY_BOT;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !data) return;
    const ratio = Math.max(0, Math.min(1, ((e.clientX - rect.left) / rect.width * W - PX) / innerW));
    setHover({ x: PX + ratio * innerW, idx: Math.round(ratio * (data.prices.length - 1)) });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold font-mono text-zinc-400">{ticker}</span>
          {!loading && data && !data.intraday && signals.length > 0 && (
            <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
              ▲ 타이밍 {signals.length}회
            </span>
          )}
          {hover && data && (
            <span className="text-[9px] text-zinc-400 font-mono">
              {data.dates[hover.idx]} ${data.prices[hover.idx]?.toFixed(2)}
              {data.scores[hover.idx] !== undefined && ` · ${data.scores[hover.idx]}점`}
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          {PERIODS.map(o => (
            <button key={o.value} onClick={() => setPeriod(o.value)}
              className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${period === o.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 차트 */}
      {loading ? (
        <div className="flex items-center justify-center h-[190px] text-zinc-700 text-xs">
          <span className="blink">▋</span>&nbsp;로딩 중...
        </div>
      ) : !data || data.prices.length < 3 ? (
        <div className="flex items-center justify-center h-[190px] text-zinc-700 text-xs">데이터 없음</div>
      ) : (() => {
        const { dates, prices, scores, intraday } = data;
        const pMin = Math.min(...prices) * 0.97, pMax = Math.max(...prices) * 1.03;
        const pRange = pMax - pMin || 1;
        const px = (i: number) => PX + (i / Math.max(prices.length - 1, 1)) * innerW;
        const py = (p: number) => PY + innerH - ((p - pMin) / pRange) * innerH;
        const sy = (s: number) => PY + innerH - (s / 100) * innerH;
        const pPath = prices.map((p, i) => `${i===0?'M':'L'}${px(i).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
        const sPath = !intraday && scores.length > 0 ? scores.map((s, i) => `${i===0?'M':'L'}${px(i).toFixed(1)},${sy(s).toFixed(1)}`).join(' ') : '';
        const aPath = `${pPath} L${px(prices.length-1).toFixed(1)},${(PY+innerH).toFixed(1)} L${PX},${(PY+innerH).toFixed(1)} Z`;
        const avgY = avgPrice ? py(avgPrice) : null;
        const avgInRange = avgY !== null && avgY >= PY && avgY <= PY + innerH;
        const last = prices[prices.length - 1];
        const lastS = scores[scores.length - 1];
        const chgPct = prices.length > 1 ? ((last - prices[0]) / prices[0] * 100).toFixed(1) : '0';

        return (
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 190 }}
            onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
            <defs>
              <linearGradient id={`g-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#10b981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* 그리드 */}
            {[0,25,50,75,100].map(pct => (
              <g key={pct}>
                <line x1={PX} y1={PY+innerH*(1-pct/100)} x2={W-PX} y2={PY+innerH*(1-pct/100)} stroke="#27272a" strokeWidth="0.5" />
                <text x={PX+2} y={PY+innerH*(1-pct/100)-2} fontSize="7" fill="#3f3f46">${(pMin+pRange*pct/100).toFixed(intraday?2:0)}</text>
              </g>
            ))}

            {/* 점수 기준선 (일별만) */}
            {!intraday && <>
              <line x1={PX} y1={sy(60)} x2={W-PX} y2={sy(60)} stroke="#10b981" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.2" />
              <line x1={PX} y1={sy(40)} x2={W-PX} y2={sy(40)} stroke="#ef4444" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.2" />
              <text x={W-PX-2} y={sy(60)-2} fontSize="6" fill="#10b981" textAnchor="end" opacity="0.4">60</text>
              <text x={W-PX-2} y={sy(40)-2} fontSize="6" fill="#ef4444" textAnchor="end" opacity="0.4">40</text>
            </>}

            {/* 가격 */}
            <path d={aPath} fill={`url(#g-${ticker})`} />
            <path d={pPath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />

            {/* 점수선 */}
            {sPath && <path d={sPath} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4,3" opacity="0.8" />}

            {/* 평단가 */}
            {avgInRange && avgY !== null && (
              <g>
                <line x1={PX} y1={avgY} x2={W-PX} y2={avgY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.7" />
                <text x={PX+4} y={avgY-3} fontSize="7" fill="#f59e0b">평단 ${avgPrice?.toFixed(2)}</text>
              </g>
            )}

            {/* 매수 타이밍 마커 */}
            {signals.map((sig, i) => {
              const mx = px(sig.idx), my = py(sig.price);
              const col = sig.type === 'REVERSAL' ? '#10b981' : '#34d399';
              return (
                <g key={i}>
                  <line x1={mx} y1={PY} x2={mx} y2={PY+innerH} stroke={col} strokeWidth="0.8" strokeDasharray="2,3" opacity="0.4" />
                  <polygon points={`${mx},${my-10} ${mx-5},${my-3} ${mx+5},${my-3}`} fill={col} opacity="0.9" />
                  <text x={mx} y={my-13} fontSize="7" fill={col} textAnchor="middle" fontWeight="bold">
                    {sig.type === 'REVERSAL' ? '▲반등' : '▲돌파'}
                  </text>
                </g>
              );
            })}

            {/* hover */}
            {hover && (
              <g>
                <line x1={hover.x} y1={PY} x2={hover.x} y2={PY+innerH} stroke="#52525b" strokeWidth="0.8" strokeDasharray="2,2" />
                <circle cx={hover.x} cy={py(prices[hover.idx])} r="3" fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
                {!intraday && scores[hover.idx] !== undefined && <circle cx={hover.x} cy={sy(scores[hover.idx])} r="2.5" fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />}
              </g>
            )}

            {/* 끝점 */}
            {!hover && <>
              <circle cx={px(prices.length-1)} cy={py(last)} r="2.5" fill="#10b981" stroke="#0a0a0a" strokeWidth="1.5" />
              {!intraday && lastS !== undefined && <circle cx={px(scores.length-1)} cy={sy(lastS)} r="2" fill="#94a3b8" stroke="#0a0a0a" strokeWidth="1" />}
            </>}

            {/* X축 */}
            {[0, Math.floor(dates.length/2), dates.length-1].map(i => (
              <text key={i} x={px(i)} y={H-4} fontSize="7" fill="#52525b" textAnchor="middle">{dates[i]}</text>
            ))}

            {/* 현재가/변동 표시 */}
            <text x={W-PX} y={PY+8} fontSize="8" fill="#e4e4e7" textAnchor="end" fontWeight="bold">${last.toFixed(2)}</text>
            <text x={W-PX} y={PY+18} fontSize="7" fill={parseFloat(chgPct)>=0?'#10b981':'#ef4444'} textAnchor="end">
              {parseFloat(chgPct)>=0?'+':''}{chgPct}%
            </text>
          </svg>
        );
      })()}

      {/* 매수 타이밍 태그 */}
      {signals.length > 0 && (
        <div className="px-3 py-2 border-t border-zinc-900 flex flex-wrap gap-1.5">
          {signals.map((sig, i) => (
            <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${sig.type==='REVERSAL'?'bg-emerald-950/40 border-emerald-800 text-emerald-400':'bg-sky-950/40 border-sky-800 text-sky-400'}`}>
              {sig.type==='REVERSAL'?'▲바닥반등':'▲40선돌파'} {sig.date} ${sig.price.toFixed(2)}
            </span>
          ))}
        </div>
      )}

      {/* 점수 — 항상 표시 */}
      {currentScore !== undefined && (
        <div className="px-3 py-2 border-t border-zinc-900 flex items-center gap-3">
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest shrink-0">모멘텀 점수</span>
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${currentScore}%`,
                background: currentScore >= 70 ? '#10b981' : currentScore >= 45 ? '#f59e0b' : '#ef4444'
              }} />
          </div>
          <span className="text-sm font-bold font-mono shrink-0"
            style={{ color: currentScore >= 70 ? '#10b981' : currentScore >= 45 ? '#f59e0b' : '#ef4444' }}>
            {currentScore}
          </span>
          <span className="text-[9px] text-zinc-600 shrink-0">/ 100</span>
          {data?.intraday && (
            <span className="text-[9px] text-zinc-600 shrink-0">
              (일별 기준 · {currentScore >= 70 ? '강세' : currentScore >= 45 ? '중립' : '약세'})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
