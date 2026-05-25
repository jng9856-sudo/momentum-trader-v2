'use client';

import { useState, useCallback } from 'react';
import StockChart from '@/components/StockChart';

interface StockData {
  ticker: string; price: number; signal: string; momentum_score: number;
  rsi: number; macd_histogram: number; bb_position: number; atr_pct: number; volume_ratio: number;
  ma20: number; ma50: number; ma200: number; above_ma_count: number; stacked_bull: boolean;
  setup_score: number; setup_label: string; setup_stage: number; setup_base_weeks: number;
  setup_atr_contraction: number; setup_vol_drying: boolean; setup_dist_pivot: number;
  vcp_is_vcp: boolean; vcp_score: number; vcp_pivot: number | null;
  breakout_52w: boolean; breakout_52w_detail: string;
  obv_trend: string; obv_detail: string;
  rs_line_trend: string; rs_line_3m_change: number; rs_line_divergence: string;
  pocket_pivot: boolean; pocket_pivot_detail: string;
  weekly_trend: string | null; weekly_is_entry: boolean;
  entry_zone: string | null; stop_loss: string | null; key_resistance: string;
  rr_ratio: number | null; rr_label: string;
  trail_initial: number | null; trail_stop_10: number | null;
  trail_stop_20: number | null; trail_stop_30: number | null;
  regime_note: string | null; summary: string;
}

const SIG_KO: Record<string, string> = {
  BREAKOUT:'즉시진입', SETUP:'진입대기', COILING:'코일링',
  WATCH:'관심등록', HOLD:'관망', SELL:'매도', STRONG_SELL:'즉시매도',
};
const SC: Record<string, { border: string; badge: string; text: string }> = {
  BREAKOUT:    { border:'border-l-emerald-400', badge:'bg-emerald-900/60 text-emerald-200 border-emerald-600', text:'text-emerald-400' },
  SETUP:       { border:'border-l-emerald-700', badge:'bg-emerald-950/60 text-emerald-400 border-emerald-800', text:'text-emerald-400' },
  COILING:     { border:'border-l-violet-400',  badge:'bg-violet-950/60  text-violet-200  border-violet-600',  text:'text-violet-400' },
  WATCH:       { border:'border-l-sky-600',     badge:'bg-sky-950/60    text-sky-300     border-sky-800',      text:'text-sky-400'    },
  HOLD:        { border:'border-l-amber-500',   badge:'bg-amber-950/60  text-amber-200   border-amber-700',    text:'text-amber-400'  },
  SELL:        { border:'border-l-red-600',     badge:'bg-red-950/60    text-red-300     border-red-800',      text:'text-red-400'    },
  STRONG_SELL: { border:'border-l-red-400',     badge:'bg-red-900/60    text-red-200     border-red-500',      text:'text-red-300'    },
};
const barColor = (s: number) => s >= 70 ? '#10b981' : s >= 45 ? '#f59e0b' : '#ef4444';

function AnalysisCard({ stock, onRemove }: { stock: StockData; onRemove: () => void }) {
  const [open, setOpen] = useState(true);
  const [tab,  setTab]  = useState<'core'|'pattern'|'strategy'>('core');
  const sc    = SC[stock.signal] ?? SC['HOLD'];
  const score = Math.min(100, Math.max(0, Math.round(stock.momentum_score)));

  return (
    <div className={`border border-zinc-800 border-l-4 ${sc.border} rounded-xl bg-[#111]`}>

      {/* ── 카드 헤더 (항상 표시) ── */}
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold text-zinc-100 font-mono">{stock.ticker}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${sc.badge}`}>{SIG_KO[stock.signal]??stock.signal}</span>
          <span className="text-sm font-bold font-mono text-zinc-200">${stock.price}</span>
          {stock.breakout_52w    && <span className="text-[9px] bg-emerald-900 text-emerald-200 border border-emerald-700 px-1.5 py-0.5 rounded">🚀 신고가</span>}
          {stock.vcp_is_vcp      && <span className="text-[9px] bg-sky-950 text-sky-300 border border-sky-800 px-1.5 py-0.5 rounded">VCP</span>}
          {stock.pocket_pivot    && <span className="text-[9px] bg-violet-950 text-violet-300 border border-violet-700 px-1.5 py-0.5 rounded">⚡피벗</span>}
          {stock.weekly_is_entry && <span className="text-[9px] bg-amber-950 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">🎯타점</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold font-mono" style={{ color: barColor(score) }}>{score}점</span>
          <button onClick={e => { e.stopPropagation(); onRemove(); }}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-red-900 text-zinc-500 hover:text-red-400 transition-colors text-xs">✕</button>
          <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── 점수 바 (항상 표시) ── */}
      <div className="px-4 pb-2">
        <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width:`${score}%`, background:barColor(score) }} />
        </div>
      </div>

      {/* ── 펼쳐지는 영역 ── */}
      {open && (
        <div className="border-t border-zinc-800">

          {/* 차트 — 탭 상단, 항상 표시 */}
          <div className="p-3 pb-0">
            <StockChart ticker={stock.ticker} currentScore={score} />
          </div>

          {/* 탭 */}
          <div className="flex border-t border-zinc-800 mt-3">
            {(['core','pattern','strategy'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors
                  ${tab===t?'text-zinc-100 border-b-2 border-emerald-500 bg-zinc-900/40':'text-zinc-500 hover:text-zinc-300'}`}>
                {t==='core'?'핵심지표':t==='pattern'?'패턴/RS':'매매전략'}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4 pt-3">

            {tab==='core' && (
              <div className="space-y-3">
                {stock.regime_note && (
                  <div className="p-2.5 rounded-lg border border-orange-800 bg-orange-950/20 text-xs text-orange-300" style={{fontFamily:'system-ui'}}>{stock.regime_note}</div>
                )}
                <div className="grid grid-cols-5 gap-2 p-3 bg-zinc-900/50 rounded-lg text-center">
                  <IndBox label="RSI"  val={String(stock.rsi)} color={stock.rsi>78?'text-red-400':stock.rsi<35?'text-sky-400':'text-emerald-400'} sub={stock.rsi>78?'과열':stock.rsi<35?'침체':'정상'} />
                  <IndBox label="MACD" val={stock.macd_histogram>0?'▲':'▼'} color={stock.macd_histogram>0?'text-emerald-400':'text-red-400'} sub={stock.macd_histogram>0?'상승':'하락'} />
                  <IndBox label="거래량" val={`${stock.volume_ratio}x`} color={stock.volume_ratio>1.5?'text-emerald-400':stock.volume_ratio<0.7?'text-red-400':'text-zinc-400'} sub={stock.volume_ratio>1.5?'강함':'보통'} />
                  <IndBox label="BB위치" val={`${stock.bb_position}%`} color={stock.bb_position>80?'text-amber-400':'text-zinc-400'} sub={stock.bb_position>80?'상단':'중간'} />
                  <IndBox label="ATR%"  val={`${stock.atr_pct}%`} color="text-zinc-400" sub="변동성" />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  {([['MA20',stock.ma20],['MA50',stock.ma50],['MA200',stock.ma200]] as [string,number][]).map(([lbl,val])=>(
                    <div key={lbl} className="p-2 bg-zinc-900 rounded-lg border border-zinc-800">
                      <div className="text-zinc-600 mb-0.5">{lbl}</div>
                      <div className={`font-mono font-bold ${stock.price>val?'text-emerald-400':'text-red-400'}`}>${val.toFixed(2)}</div>
                      <div className={`text-[9px] ${stock.price>val?'text-emerald-700':'text-red-700'}`}>{stock.price>val?'위':'아래'}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/40 rounded-lg border border-zinc-800">
                  <span className="text-[10px] text-zinc-500">MA 정배열</span>
                  <span className={`text-xs font-bold ${stock.stacked_bull?'text-emerald-400':'text-zinc-500'}`}>
                    {stock.above_ma_count}/3개 위{stock.stacked_bull?' ✓ 완성':''}
                  </span>
                </div>
                {stock.setup_score>0 && (
                  <div className="p-3 rounded-lg border border-violet-900/50 bg-violet-950/10">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-zinc-500">셋업 품질</span>
                      <span className="text-violet-300 font-bold">{stock.setup_score}점 — {stock.setup_label}</span>
                    </div>
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
                      <div className="h-full rounded-full" style={{width:`${stock.setup_score}%`,background:'#a78bfa'}} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-zinc-600">
                      {stock.setup_base_weeks>0&&<span>베이스 <span className="text-zinc-400">{stock.setup_base_weeks}주</span></span>}
                      <span>ATR압축 <span className="text-zinc-400">{Math.round(stock.setup_atr_contraction*100)}%</span></span>
                      {stock.setup_vol_drying&&<span className="text-violet-400">거래량 고갈 ✓</span>}
                      <span>피봇까지 <span className={Math.abs(stock.setup_dist_pivot)<=5?'text-violet-300':'text-zinc-400'}>{stock.setup_dist_pivot>0?'+':''}{stock.setup_dist_pivot}%</span></span>
                      <span>Stage <span className={stock.setup_stage===2?'text-emerald-400':'text-zinc-400'}>{stock.setup_stage}</span></span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab==='pattern' && (
              <div className="space-y-3">
                {stock.breakout_52w&&<div className="p-3 rounded-lg border border-emerald-700 bg-emerald-950/20"><p className="text-xs font-bold text-emerald-300 mb-1">🚀 52주 신고가 돌파</p><p className="text-[10px] text-zinc-400" style={{fontFamily:'system-ui'}}>{stock.breakout_52w_detail}</p></div>}
                {stock.vcp_is_vcp&&<div className="p-3 rounded-lg border border-sky-800 bg-sky-950/20"><div className="flex justify-between mb-1"><p className="text-xs font-bold text-sky-300">VCP 패턴</p><span className="text-xs font-mono text-sky-400">{stock.vcp_score}점</span></div>{stock.vcp_pivot&&<p className="text-[10px] text-zinc-400">피봇 ${stock.vcp_pivot}</p>}</div>}
                {stock.pocket_pivot&&<div className="p-3 rounded-lg border border-violet-800 bg-violet-950/20"><p className="text-xs font-bold text-violet-300 mb-1">⚡ 포켓 피벗</p><p className="text-[10px] text-zinc-400" style={{fontFamily:'system-ui'}}>{stock.pocket_pivot_detail}</p></div>}
                <div className={`p-3 rounded-lg border ${stock.rs_line_divergence==='BULLISH'?'border-emerald-700 bg-emerald-950/20':stock.rs_line_trend==='UP'?'border-emerald-900 bg-emerald-950/10':'border-zinc-800 bg-zinc-900/20'}`}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest">RS Line</span>
                    <span className={`text-xs font-mono font-bold ${stock.rs_line_trend==='UP'?'text-emerald-400':stock.rs_line_trend==='DOWN'?'text-red-400':'text-zinc-400'}`}>
                      3개월 {stock.rs_line_3m_change>0?'+':''}{stock.rs_line_3m_change}%
                    </span>
                  </div>
                  {stock.rs_line_divergence==='BULLISH'&&<p className="text-[10px] text-emerald-400">🏆 RS 강세 다이버전스</p>}
                </div>
                <div className={`p-3 rounded-lg border ${stock.obv_trend==='UP'?'border-emerald-900 bg-emerald-950/10':stock.obv_trend==='DOWN'?'border-red-900 bg-red-950/10':'border-zinc-800 bg-zinc-900/20'}`}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest">OBV 기관 매집</span>
                    <span className={`text-xs font-bold ${stock.obv_trend==='UP'?'text-emerald-400':stock.obv_trend==='DOWN'?'text-red-400':'text-zinc-400'}`}>{stock.obv_trend==='UP'?'▲ 매집':stock.obv_trend==='DOWN'?'▼ 분산':'— 중립'}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500" style={{fontFamily:'system-ui'}}>{stock.obv_detail}</p>
                </div>
                {stock.weekly_trend&&<div className={`p-3 rounded-lg border ${stock.weekly_is_entry?'border-emerald-600 bg-emerald-950/20':'border-zinc-800 bg-zinc-900/20'}`}>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest">주봉</span>
                    <span className={`text-xs font-bold ${stock.weekly_trend==='UPTREND'?'text-emerald-400':stock.weekly_trend==='DOWNTREND'?'text-red-400':'text-zinc-400'}`}>
                      {stock.weekly_trend==='UPTREND'?'▲ 상승':stock.weekly_trend==='DOWNTREND'?'▼ 하락':'— 횡보'}{stock.weekly_is_entry?' 🎯 최고타점':''}
                    </span>
                  </div>
                </div>}
              </div>
            )}

            {tab==='strategy' && (
              <div className="space-y-3">
                {stock.summary&&<p className="text-xs text-zinc-400 leading-relaxed" style={{fontFamily:'system-ui'}}>{stock.summary}</p>}
                <div className="flex flex-wrap gap-2">
                  {stock.entry_zone    &&<LvPill label="진입" val={stock.entry_zone}     c="text-emerald-300 border-emerald-800 bg-emerald-950/30"/>}
                  {stock.key_resistance&&<LvPill label="저항" val={stock.key_resistance}  c="text-purple-300 border-purple-800 bg-purple-950/30"/>}
                  {stock.stop_loss     &&<LvPill label="손절" val={stock.stop_loss}       c="text-red-300 border-red-800 bg-red-950/30"/>}
                </div>
                {stock.rr_ratio!==null&&<div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 flex items-center justify-between"><span className="text-[10px] text-zinc-500">R/R 비율</span><span className="text-sm font-bold font-mono text-zinc-200">{stock.rr_label}</span></div>}
                {stock.trail_initial&&(
                  <div className="p-3 rounded-lg border border-amber-800/50 bg-amber-950/10">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">트레일링 스탑</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {([['초기 손절',stock.trail_initial],['+10%',stock.trail_stop_10],['+20%',stock.trail_stop_20],['+30%',stock.trail_stop_30]] as [string,number|null][])
                        .filter(([,v])=>v!=null)
                        .map(([lbl,val])=>(
                          <div key={lbl} className="flex justify-between p-1.5 bg-zinc-900 rounded border border-zinc-800">
                            <span className="text-zinc-600">{lbl}</span>
                            <span className="font-mono text-amber-300">${val}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IndBox({ label, val, color, sub }: { label:string; val:string; color:string; sub:string }) {
  return (
    <div>
      <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-sm font-semibold font-mono ${color}`}>{val}</div>
      <div className="text-[9px] text-zinc-600">{sub}</div>
    </div>
  );
}
function LvPill({ label, val, c }: { label:string; val:string; c:string }) {
  return <span className={`text-xs px-2 py-1 border rounded-lg ${c}`}>{label} {val}</span>;
}

export default function ScannerTab() {
  const [input,   setInput]   = useState('');
  const [queued,  setQueued]  = useState<string[]>([]);
  const [stocks,  setStocks]  = useState<StockData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  function addToQueue(raw: string) {
    const tickers = raw.toUpperCase().split(/[\s,]+/).map(t=>t.trim()).filter(t=>/^[A-Z]{1,6}$/.test(t));
    if (tickers.length===0) { setError('올바른 티커를 입력하세요'); return; }
    setQueued(prev => {
      const next = [...new Set([...prev,...tickers])];
      if (next.length>20) { setError('최대 20개'); return prev; }
      return next;
    });
    setInput(''); setError('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key==='Enter') addToQueue(input);
  }

  const analyze = useCallback(async () => {
    if (queued.length===0) { setError('티커를 먼저 추가하세요'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tickers:queued}) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setStocks(data.stocks??[]);
    } catch { setError('오류가 발생했습니다'); }
    setLoading(false);
  }, [queued]);

  const remove = (t: string) => { setStocks(p=>p.filter(s=>s.ticker!==t)); setQueued(p=>p.filter(x=>x!==t)); };
  const ORDER: Record<string,number> = { BREAKOUT:0, SETUP:1, COILING:2, WATCH:3, HOLD:4, SELL:5, STRONG_SELL:6 };

  return (
    <div className="mb-8">
      {/* 입력 */}
      <div className="mb-4 space-y-2">
        <div className="flex gap-2">
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="티커 입력 후 Enter (예: NVDA)"
            className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-4 py-2.5 rounded-lg font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
          <button onClick={()=>addToQueue(input)}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap">
            + 추가
          </button>
          <button onClick={analyze} disabled={loading||queued.length===0}
            className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap
              ${loading||queued.length===0?'bg-zinc-800 border border-zinc-700 text-zinc-500 cursor-not-allowed':'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
            {loading?<span className="flex items-center gap-1"><span className="blink">▋</span>분석 중</span>:'분석하기'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-700 ml-1">Enter 또는 + 추가 → 분석하기 클릭</p>
        {error&&<p className="text-xs text-red-400 ml-1">{error}</p>}

        {/* 적립된 티커 */}
        {queued.length>0&&(
          <div className="flex flex-wrap gap-1.5 p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
            <span className="text-[10px] text-zinc-600 self-center mr-1">대기 {queued.length}개</span>
            {queued.map(t=>{
              const done = stocks.find(s=>s.ticker===t);
              return (
                <span key={t} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${done?'bg-emerald-950/40 border-emerald-800 text-emerald-400':'bg-zinc-800 border-zinc-700 text-zinc-300'}`}>
                  {done&&<span className="text-[8px]">✓</span>}{t}
                  <button onClick={()=>{ setQueued(p=>p.filter(x=>x!==t)); setStocks(p=>p.filter(s=>s.ticker!==t)); }} className="text-zinc-600 hover:text-red-400 text-[10px]">✕</button>
                </span>
              );
            })}
            <button onClick={()=>{setQueued([]);setStocks([]);}} className="text-[10px] text-zinc-600 hover:text-red-400 ml-auto self-center">전체 삭제</button>
          </div>
        )}
      </div>

      {/* 결과 */}
      {stocks.length>0 ? (
        <div className="flex flex-col gap-4">
          {[...stocks].sort((a,b)=>(ORDER[a.signal]??9)-(ORDER[b.signal]??9))
            .map(s=><AnalysisCard key={s.ticker} stock={s} onRemove={()=>remove(s.ticker)}/>)}
        </div>
      ) : !loading&&queued.length===0&&(
        <div className="text-center py-16">
          <div className="text-5xl mb-4 text-zinc-800">◈</div>
          <p className="text-zinc-500 text-sm mb-1">종목 티커를 입력하세요</p>
          <p className="text-zinc-700 text-xs">Enter로 추가 → 분석하기</p>
        </div>
      )}
    </div>
  );
}
