'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Position, PositionResult } from '@/types/stock';

// ── 레버리지 ETF 매핑 ─────────────────────────────────────────────────────────
const LEVERAGE_MAP: Record<string, { base: string; multiplier: number; label: string }> = {
  NVDL:  { base: 'NVDA', multiplier: 2, label: 'GraniteShares 2x NVDA' },
  TSLL:  { base: 'TSLA', multiplier: 2, label: 'Direxion 2x TSLA' },
  SOXL:  { base: 'SOXX', multiplier: 3, label: 'Direxion 3x 반도체' },
  TQQQ:  { base: 'QQQ',  multiplier: 3, label: 'ProShares 3x QQQ' },
  UPRO:  { base: 'SPY',  multiplier: 3, label: 'ProShares 3x SPY' },
  LABU:  { base: 'XBI',  multiplier: 3, label: 'Direxion 3x 바이오' },
  AAPU:  { base: 'AAPL', multiplier: 2, label: 'Direxion 2x AAPL' },
  MSFU:  { base: 'MSFT', multiplier: 2, label: 'Direxion 2x MSFT' },
  AMZU:  { base: 'AMZN', multiplier: 2, label: 'Direxion 2x AMZN' },
  METU:  { base: 'META', multiplier: 2, label: 'Direxion 2x META' },
  CONL:  { base: 'COIN', multiplier: 2, label: 'GraniteShares 2x COIN' },
  PLTU:  { base: 'PLTR', multiplier: 2, label: 'Direxion 2x PLTR' },
  FNGU:  { base: 'NYFANG', multiplier: 3, label: 'MicroSectors 3x FANG+' },
};

// 레버리지 → 본주 추정가 (단기 근사)
function estimateBasePrice(curEtf: number, avgEtf: number, baseAtPurchase: number, mult: number) {
  const ratio = curEtf / avgEtf;
  return Math.round(baseAtPurchase * (1 + (ratio - 1) / mult) * 100) / 100;
}

function calcSignal(score: number, pnlPct: number): { signal: PositionResult['signal']; reason: string } {
  if (score >= 72)                  return { signal: 'ADD',    reason: `모멘텀 ${score}점 강세 — 추가매수 구간` };
  if (score >= 50 && pnlPct > -20) return { signal: 'HOLD',   reason: `모멘텀 ${score}점 양호 — 현 포지션 유지` };
  if (score < 40  && pnlPct > 15)  return { signal: 'REDUCE', reason: `수익 ${pnlPct.toFixed(1)}% 확보, 지표 약화 — 분할 익절` };
  if (score < 35  || pnlPct < -25) return { signal: 'SELL',   reason: `모멘텀 ${score}점 약세 — 손실 관리 필요` };
  return { signal: 'HOLD', reason: `모멘텀 ${score}점 — 추세 확인 중` };
}

const STORAGE_KEY = 'mt_v2_positions';
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const SC = {
  ADD:    { border: 'border-l-emerald-400', badge: 'bg-emerald-900/60 text-emerald-200 border-emerald-600', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  HOLD:   { border: 'border-l-amber-500',   badge: 'bg-amber-900/60  text-amber-200   border-amber-700',   dot: 'bg-amber-400',   text: 'text-amber-400' },
  REDUCE: { border: 'border-l-orange-500',  badge: 'bg-orange-900/60 text-orange-200  border-orange-700',  dot: 'bg-orange-400',  text: 'text-orange-400' },
  SELL:   { border: 'border-l-red-500',     badge: 'bg-red-900/60    text-red-200     border-red-600',     dot: 'bg-red-400',     text: 'text-red-400' },
} as const;
const SK = { ADD: '추가매수', HOLD: '홀드', REDUCE: '부분매도', SELL: '매도' } as const;

// ── 폼 ────────────────────────────────────────────────────────────────────────
function PositionForm({ initial, onSave, onCancel }: {
  initial?: Partial<Position>;
  onSave: (p: Omit<Position, 'id'>) => void;
  onCancel: () => void;
}) {
  const [ticker,  setTicker]  = useState(initial?.ticker ?? '');
  const [avg,     setAvg]     = useState(String(initial?.avgPrice ?? ''));
  const [shares,  setShares]  = useState(String(initial?.shares ?? ''));
  const [baseAtp, setBaseAtp] = useState(String(initial?.baseAtPurchase ?? ''));
  const [note,    setNote]    = useState(initial?.note ?? '');

  const t = ticker.trim().toUpperCase();
  const lev = LEVERAGE_MAP[t];

  function save() {
    if (!t || !avg || !shares) return;
    onSave({
      ticker: t, avgPrice: parseFloat(avg), shares: parseFloat(shares), note,
      isLeverage: !!lev, leverageBase: lev?.base, leverageMultiplier: lev?.multiplier,
      baseAtPurchase: baseAtp ? parseFloat(baseAtp) : undefined,
    });
  }

  return (
    <div className="border border-zinc-700 rounded-xl bg-zinc-900 p-4 mb-4">
      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">
        {initial?.ticker ? `${initial.ticker} 수정` : '포지션 추가'}
      </p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Field label="티커">
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="NVDL"
            className="input font-mono" />
        </Field>
        <Field label="평단가 ($)">
          <input type="number" value={avg} onChange={e => setAvg(e.target.value)} placeholder="106.00"
            className="input font-mono" />
        </Field>
        <Field label="수량 (주)">
          <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="10"
            className="input font-mono" />
        </Field>
      </div>

      {lev && (
        <div className="mb-3 p-3 rounded-lg border border-violet-800 bg-violet-950/20">
          <p className="text-[10px] text-violet-300 mb-2">
            ⚡ {lev.label} — 본주: <span className="font-bold">{lev.base}</span> × {lev.multiplier}배
          </p>
          <Field label={`매수 당시 ${lev.base} 가격 ($) — 선택`}>
            <input type="number" value={baseAtp} onChange={e => setBaseAtp(e.target.value)}
              placeholder={`예: ${lev.base} 매수 당시 종가`}
              className="input font-mono" />
          </Field>
        </div>
      )}

      <Field label="메모 (선택)">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="예: 반도체 사이클 회복 기대"
          className="input" />
      </Field>

      <div className="flex gap-2 mt-3">
        <button onClick={save}
          className="flex-1 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
          저장
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
          취소
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── 포지션 카드 ───────────────────────────────────────────────────────────────
function PositionCard({ r, onEdit, onDelete }: { r: PositionResult; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const sc = SC[r.signal];
  const plus = r.pnlPct >= 0;
  const barColor = r.score >= 70 ? '#10b981' : r.score >= 45 ? '#f59e0b' : '#ef4444';

  return (
    <div className={`border border-zinc-800 border-l-4 ${sc.border} rounded-xl bg-[#111]`}>

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-bold text-zinc-100 font-mono">{r.ticker}</span>
          {r.isLeverage && (
            <span className="text-[9px] border border-violet-700 text-violet-300 bg-violet-950/40 px-1.5 py-0.5 rounded font-mono">
              {r.leverageMultiplier}x {r.leverageBase}
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${sc.badge}`}>
            {SK[r.signal]}
          </span>
          <span className={`text-sm font-bold font-mono ${plus ? 'text-emerald-400' : 'text-red-400'}`}>
            {plus ? '+' : ''}{r.pnlPct.toFixed(2)}%
          </span>
          <span className="text-xs text-zinc-500 font-mono">${r.currentPrice.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-xs font-bold font-mono" style={{ color: barColor }}>{r.score}점</div>
            <div className="text-[9px] text-zinc-600">${r.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          </div>
          <span className="text-zinc-700 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* 접힌 요약 */}
      {!open && (
        <div className="px-4 pb-3 border-t border-zinc-900 pt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
          <span>평단 <span className="font-mono text-zinc-300">${r.avgPrice}</span></span>
          <span>수량 <span className="text-zinc-300">{r.shares}주</span></span>
          <span className={plus ? 'text-emerald-400' : 'text-red-400'}>
            {plus ? '+' : ''}${Math.abs(r.pnlAmt).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          {r.isLeverage && r.impliedBasePrice && (
            <span className="text-violet-400">{r.leverageBase} 추정 ${r.impliedBasePrice}</span>
          )}
          {r.rsi !== undefined && <span>RSI <span className={r.rsi > 75 ? 'text-red-400' : 'text-emerald-400'}>{r.rsi}</span></span>}
        </div>
      )}

      {/* 펼침 */}
      {open && (
        <div className="border-t border-zinc-900 px-4 pb-4 pt-3 space-y-3">

          {/* 신호 박스 */}
          <div className={`p-3 rounded-lg border ${sc.badge}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
              <span className={`text-sm font-bold ${sc.text}`}>{SK[r.signal]}</span>
            </div>
            <p className="text-xs text-zinc-300" style={{ fontFamily: 'system-ui' }}>{r.signalReason}</p>
          </div>

          {/* 점수 바 */}
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1.5">
              <span>모멘텀 점수</span>
              <span className="font-mono font-bold" style={{ color: barColor }}>{r.score} / 100</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${r.score}%`, background: barColor }} />
            </div>
          </div>

          {/* 포지션 수치 */}
          <div className="grid grid-cols-4 gap-2 p-3 bg-zinc-900/60 rounded-lg text-center">
            {[
              { label: '평단가', val: `$${r.avgPrice}`, color: 'text-zinc-200' },
              { label: '현재가', val: `$${r.currentPrice}`, color: 'text-zinc-100' },
              { label: '수익률', val: `${plus ? '+' : ''}${r.pnlPct.toFixed(2)}%`, color: plus ? 'text-emerald-400' : 'text-red-400' },
              { label: '평가손익', val: `${plus ? '+' : ''}$${Math.abs(r.pnlAmt).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: plus ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
              </div>
            ))}
          </div>

          {/* 기술지표 */}
          <div className="grid grid-cols-3 gap-2">
            {r.rsi !== undefined && (
              <IndBox label="RSI"
                val={String(r.rsi)}
                color={r.rsi > 78 ? 'text-red-400' : r.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'}
                sub={r.rsi > 78 ? '과열' : r.rsi < 35 ? '침체' : '정상'} />
            )}
            {r.macdBull !== undefined && (
              <IndBox label="MACD"
                val={r.macdBull ? '▲ 상승' : '▼ 하락'}
                color={r.macdBull ? 'text-emerald-400' : 'text-red-400'}
                sub={r.macdBull ? '골든' : '데드'} />
            )}
            {r.stage !== undefined && (
              <IndBox label="Stage"
                val={String(r.stage)}
                color={r.stage === 2 ? 'text-emerald-400' : r.stage === 1 ? 'text-violet-400' : 'text-red-400'}
                sub={r.stage === 2 ? '상승추세' : r.stage === 1 ? '기반구축' : '하락'} />
            )}
          </div>

          {/* 진입/손절 */}
          {(r.entryZone || r.stopLoss) && (
            <div className="flex flex-wrap gap-2">
              {r.entryZone && (
                <span className="text-xs px-2.5 py-1 border rounded-lg text-emerald-300 border-emerald-800 bg-emerald-950/30">
                  추가매수 {r.entryZone}
                </span>
              )}
              {r.stopLoss && (
                <span className="text-xs px-2.5 py-1 border rounded-lg text-red-300 border-red-800 bg-red-950/30">
                  손절 {r.stopLoss}
                </span>
              )}
            </div>
          )}

          {/* 레버리지 역산 */}
          {r.isLeverage && (
            <div className="p-3 rounded-lg border border-violet-800/50 bg-violet-950/10">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                레버리지 역산 — {r.leverageBase} ({r.leverageMultiplier}x)
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-zinc-600 mb-0.5">ETF 평단 → 현재</div>
                  <div className="font-mono text-zinc-300">${r.avgPrice} → ${r.currentPrice}</div>
                </div>
                {r.impliedBasePrice ? (
                  <div>
                    <div className="text-zinc-600 mb-0.5">{r.leverageBase} 현재 추정가</div>
                    <div className="text-xl font-bold font-mono text-violet-300">${r.impliedBasePrice}</div>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-700">
                    편집에서 본주 매수가 입력 시<br />역산 가능
                  </div>
                )}
              </div>
              <p className="text-[9px] text-zinc-700 mt-2">
                ※ 단기 근사값. 장기 보유 시 복리 괴리 발생 가능.
              </p>
            </div>
          )}

          {r.note && (
            <p className="text-[10px] text-zinc-600 italic" style={{ fontFamily: 'system-ui' }}>
              📝 {r.note}
            </p>
          )}

          <div className="flex gap-2 pt-2 border-t border-zinc-800">
            <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">수정</button>
            <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg border border-red-900 text-red-500 hover:bg-red-950 transition-colors">삭제</button>
          </div>
        </div>
      )}
    </div>
  );
}

function IndBox({ label, val, color, sub }: { label: string; val: string; color: string; sub: string }) {
  return (
    <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-800 text-center">
      <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{val}</div>
      <div className="text-[9px] text-zinc-600">{sub}</div>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function PortfolioTab() {
  const [positions,   setPositions]   = useState<Position[]>([]);
  const [results,     setResults]     = useState<PositionResult[]>([]);
  const [showForm,    setShowForm]    = useState(false);
  const [editId,      setEditId]      = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [updatedAt,   setUpdatedAt]   = useState<string | null>(null);

  useEffect(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); if (r) setPositions(JSON.parse(r)); } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch {}
  }, [positions]);

  const add    = (p: Omit<Position, 'id'>) => { setPositions(prev => [...prev, { ...p, id: genId() }]); setShowForm(false); };
  const update = (id: string, p: Omit<Position, 'id'>) => { setPositions(prev => prev.map(x => x.id === id ? { ...p, id } : x)); setEditId(null); };
  const del    = (id: string) => setPositions(prev => prev.filter(x => x.id !== id));

  const analyze = useCallback(async () => {
    if (positions.length === 0 || loading) return;
    setLoading(true);
    try {
      const tickers = [...new Set(positions.map(p => p.ticker))];
      const res  = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) });
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map: Record<string, any> = Object.fromEntries((data.stocks ?? []).map((s: any) => [s.ticker, s]));
      setUpdatedAt(new Date().toLocaleTimeString('ko-KR'));
      setResults(positions.map(pos => {
        const s = map[pos.ticker];
        const cur    = s?.price ?? pos.avgPrice;
        const pnlPct = Math.round(((cur - pos.avgPrice) / pos.avgPrice) * 10000) / 100;
        const pnlAmt = Math.round((cur - pos.avgPrice) * pos.shares * 100) / 100;
        const score  = s?.momentum_score ?? 50;
        const { signal, reason } = calcSignal(score, pnlPct);
        const implied = pos.isLeverage && pos.baseAtPurchase && pos.leverageMultiplier
          ? estimateBasePrice(cur, pos.avgPrice, pos.baseAtPurchase, pos.leverageMultiplier)
          : undefined;
        return {
          ...pos,
          currentPrice:     Math.round(cur * 100) / 100,
          pnlPct,
          pnlAmt,
          totalValue:       Math.round(cur * pos.shares * 100) / 100,
          score,
          signal,
          signalReason:     reason,
          entryZone:        s?.entry_zone,
          stopLoss:         s?.stop_loss,
          rsi:              s?.rsi,
          macdBull:         (s?.macd_histogram ?? 0) > 0,
          stage:            s?.setup_stage,
          impliedBasePrice: implied,
        };
      }));
    } catch {}
    setLoading(false);
  }, [positions, loading]);

  useEffect(() => { if (positions.length > 0) analyze(); }, [positions.length]); // eslint-disable-line

  const totalVal  = results.reduce((a, r) => a + r.totalValue, 0);
  const totalCost = positions.reduce((a, p) => a + p.avgPrice * p.shares, 0);
  const totalPnl  = totalVal - totalCost;
  const totalPct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const sigCnt    = results.reduce((acc, r) => { acc[r.signal] = (acc[r.signal] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const ORDER     = { ADD: 0, HOLD: 1, REDUCE: 2, SELL: 3 };

  return (
    <div className="mb-8">
      {/* 포트폴리오 요약 */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
          <SumBox label="총 평가액" val={`$${totalVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <SumBox
            label="총 손익"
            val={`${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            sub={`(${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)`}
            color={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
          <div className="text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">신호</div>
            <div className="flex justify-center gap-1 flex-wrap">
              {Object.entries(sigCnt).map(([sig, cnt]) => (
                <span key={sig} className={`text-[9px] px-1.5 py-0.5 rounded border ${SC[sig as keyof typeof SC]?.badge ?? ''}`}>
                  {SK[sig as keyof typeof SK]} {cnt}
                </span>
              ))}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">종목</div>
            <div className="text-lg font-bold text-zinc-200">{positions.length}개</div>
            {updatedAt && <div className="text-[9px] text-zinc-700">{updatedAt} 기준</div>}
          </div>
        </div>
      )}

      {/* 액션 바 */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => { setShowForm(true); setEditId(null); }}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
          + 포지션 추가
        </button>
        {positions.length > 0 && (
          <button onClick={analyze} disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors
              ${loading ? 'border-zinc-800 text-zinc-600 cursor-not-allowed' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}>
            {loading ? <span className="flex items-center gap-1"><span className="blink">▋</span>분석 중</span> : '↻ 갱신'}
          </button>
        )}
      </div>

      {showForm && !editId && <PositionForm onSave={add} onCancel={() => setShowForm(false)} />}

      {results.length > 0 ? (
        <div className="flex flex-col gap-3">
          {results
            .sort((a, b) => ORDER[a.signal] - ORDER[b.signal])
            .map(r => (
              <div key={r.id}>
                {editId === r.id ? (
                  <PositionForm
                    initial={positions.find(p => p.id === r.id)}
                    onSave={p => update(r.id, p)}
                    onCancel={() => setEditId(null)} />
                ) : (
                  <PositionCard r={r} onEdit={() => setEditId(r.id)} onDelete={() => del(r.id)} />
                )}
              </div>
            ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4 text-zinc-800">◈</div>
          <p className="text-zinc-500 text-sm mb-1">보유 포지션을 추가하세요</p>
          <p className="text-zinc-700 text-xs">티커 · 평단가 · 수량 입력 → 자동 신호 분석</p>
        </div>
      ) : (
        <div className="text-center py-12 text-zinc-600">분석 중...</div>
      )}
    </div>
  );
}

function SumBox({ label, val, sub, color }: { label: string; val: string; sub?: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-lg font-bold font-mono ${color ?? 'text-zinc-100'}`}>{val}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
