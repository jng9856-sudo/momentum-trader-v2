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

// ── 복리 역산 공식 ─────────────────────────────────────────────────────────────
// 단순 선형(1차): base0 × (1 + (etf현재/etf평단 - 1) / N)  → 단기만 유효
// 지수(복리반영): base0 × (etf현재/etf평단)^(1/N)          → 장기 더 정확
// 음의 복리(변동성 감쇠) 효과: 실제 본주는 역산값보다 더 높을 수 있음 (ETF가 더 많이 손실)
function estimateBasePrice(
  etfNow: number,
  etfAvg: number,
  baseAtPurchase: number,
  multiplier: number,
): {
  linear: number;   // 단기 근사
  compound: number; // 복리 반영 (더 정확)
  decay: number;    // 변동성 감쇠 추정 (compound보다 보수적)
} {
  const ratio = etfNow / etfAvg;
  const linear   = Math.round(baseAtPurchase * (1 + (ratio - 1) / multiplier) * 100) / 100;
  const compound = Math.round(baseAtPurchase * Math.pow(ratio, 1 / multiplier) * 100) / 100;
  // 변동성 감쇠: 실제 본주는 compound보다 약간 높게 추정 (ETF 손실이 더 크므로)
  // 근사: compound 값에서 약 2~5% 상향 보정 (배율이 클수록 더 큼)
  const decayAdj = multiplier >= 3 ? 1.04 : 1.02;
  const decay    = Math.round(compound * decayAdj * 100) / 100;
  return { linear, compound, decay };
}

// ── 본주 기준 신호 판단 ───────────────────────────────────────────────────────
// ETF 신호가 아닌 본주 모멘텀으로 판단
function calcSignal(
  score: number,
  pnlPct: number,
  baseScore?: number, // 본주 모멘텀 점수
): { signal: PositionResult['signal']; reason: string } {
  const effectiveScore = baseScore !== undefined ? Math.round((score + baseScore) / 2) : score;
  if (effectiveScore >= 72)                   return { signal: 'ADD',    reason: `종합 ${effectiveScore}점 강세 — 추가매수 구간` };
  if (effectiveScore >= 50 && pnlPct > -20)  return { signal: 'HOLD',   reason: `종합 ${effectiveScore}점 양호 — 현 포지션 유지` };
  if (effectiveScore < 40  && pnlPct > 15)   return { signal: 'REDUCE', reason: `수익 ${pnlPct.toFixed(1)}% 확보, 지표 약화 — 분할 익절` };
  if (effectiveScore < 35  || pnlPct < -25)  return { signal: 'SELL',   reason: `종합 ${effectiveScore}점 약세 — 손실 관리` };
  return { signal: 'HOLD', reason: `종합 ${effectiveScore}점 — 추세 확인 중` };
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

// 본주 분석 데이터
interface BaseAnalysis {
  ticker: string;
  price: number;
  score: number;
  ma20: number;
  ma50: number;
  ma200: number;
  rsi: number;
  macdBull: boolean;
  stage: number;
  entryZone?: string | null;
  stopLoss?: string | null;
  impliedPrices: { linear: number; compound: number; decay: number };
  impliedPnlPct: number; // 본주 기준 수익률
}

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

  const t   = ticker.trim().toUpperCase();
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
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="NVDL" className="input font-mono" />
        </Field>
        <Field label="평단가 ($)">
          <input type="number" value={avg} onChange={e => setAvg(e.target.value)}
            placeholder="106.00" className="input font-mono" />
        </Field>
        <Field label="수량 (주)">
          <input type="number" value={shares} onChange={e => setShares(e.target.value)}
            placeholder="10" className="input font-mono" />
        </Field>
      </div>

      {lev && (
        <div className="mb-3 p-3 rounded-lg border border-violet-800 bg-violet-950/20">
          <p className="text-[10px] text-violet-300 mb-2">
            ⚡ {lev.label} — 본주: <span className="font-bold">{lev.base}</span> × {lev.multiplier}배
          </p>
          <p className="text-[9px] text-zinc-500 mb-2">
            본주 매수가를 입력하면 복리 감쇠를 반영한 정확한 역산이 가능합니다
          </p>
          <Field label={`매수 당시 ${lev.base} 가격 ($) — 선택`}>
            <input type="number" value={baseAtp} onChange={e => setBaseAtp(e.target.value)}
              placeholder={`예: ${lev.base} 매수 당시 종가`} className="input font-mono" />
          </Field>
        </div>
      )}

      <Field label="메모 (선택)">
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder="예: 반도체 사이클 회복 기대" className="input" />
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

// ── 레버리지 역산 패널 ─────────────────────────────────────────────────────────
function LeveragePanel({ r, base }: { r: PositionResult; base?: BaseAnalysis }) {
  const mult = r.leverageMultiplier ?? 2;
  const { impliedPrices } = base ?? {};

  return (
    <div className="p-3 rounded-lg border border-violet-800/50 bg-violet-950/10 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
          레버리지 역산 — {r.leverageBase} ({mult}x)
        </p>
        <span className="text-[9px] text-zinc-600">음/양의 복리 반영</span>
      </div>

      {/* ETF 가격 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-zinc-900 rounded-lg text-center">
          <div className="text-zinc-600 mb-0.5 text-[9px]">ETF 평단</div>
          <div className="font-mono font-bold text-zinc-200">${r.avgPrice}</div>
        </div>
        <div className="p-2 bg-zinc-900 rounded-lg text-center">
          <div className="text-zinc-600 mb-0.5 text-[9px]">ETF 현재</div>
          <div className="font-mono font-bold text-zinc-100">${r.currentPrice}</div>
        </div>
      </div>

      {/* 본주 역산값 */}
      {impliedPrices && r.baseAtPurchase ? (
        <>
          <div>
            <p className="text-[10px] text-zinc-500 mb-2">
              {r.leverageBase} 역산 (매수 당시 ${r.baseAtPurchase} 기준)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-zinc-900/80 rounded-lg text-center border border-zinc-800">
                <div className="text-[9px] text-zinc-600 mb-0.5">단순 추정</div>
                <div className="font-mono font-bold text-zinc-400 text-sm">${impliedPrices.linear}</div>
                <div className="text-[8px] text-zinc-700">선형 근사</div>
              </div>
              <div className="p-2 bg-violet-950/40 rounded-lg text-center border border-violet-800">
                <div className="text-[9px] text-violet-400 mb-0.5">복리 반영</div>
                <div className="font-mono font-bold text-violet-300 text-sm">${impliedPrices.compound}</div>
                <div className="text-[8px] text-violet-700">권장 기준</div>
              </div>
              <div className="p-2 bg-zinc-900/80 rounded-lg text-center border border-zinc-800">
                <div className="text-[9px] text-zinc-600 mb-0.5">감쇠 보정</div>
                <div className="font-mono font-bold text-amber-400 text-sm">${impliedPrices.decay}</div>
                <div className="text-[8px] text-zinc-700">보수적 추정</div>
              </div>
            </div>
          </div>

          {/* 본주 기준 수익률 */}
          {base && (
            <div className={`p-2 rounded-lg text-center border ${base.impliedPnlPct >= 0 ? 'border-emerald-800 bg-emerald-950/20' : 'border-red-800 bg-red-950/20'}`}>
              <div className="text-[9px] text-zinc-500 mb-0.5">{r.leverageBase} 기준 수익률 (복리 반영)</div>
              <div className={`text-lg font-bold font-mono ${base.impliedPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {base.impliedPnlPct >= 0 ? '+' : ''}{base.impliedPnlPct.toFixed(2)}%
              </div>
              <div className="text-[9px] text-zinc-600 mt-0.5">
                ${r.baseAtPurchase} → ${impliedPrices.compound}
              </div>
            </div>
          )}

          <p className="text-[9px] text-zinc-700 leading-relaxed">
            ※ 음의 복리(변동성 감쇠): 레버리지 ETF는 일별 복리 구조로 장기 보유 시
            본주 수익률 × {mult}배보다 실제 수익이 낮아집니다.
            배율이 높을수록, 기간이 길수록, 변동성이 클수록 감쇠가 커집니다.
          </p>
        </>
      ) : (
        <p className="text-[10px] text-zinc-600 text-center py-2">
          편집에서 본주 매수 당시 가격 입력 시<br />복리 반영 역산 계산 가능
        </p>
      )}
    </div>
  );
}

// ── 본주 기준 분석 패널 ────────────────────────────────────────────────────────
function BaseAnalysisPanel({ base, mult }: { base: BaseAnalysis; mult: number }) {
  const ma50Status  = base.price > base.ma50  ? '위' : '아래';
  const ma200Status = base.price > base.ma200 ? '위' : '아래';

  return (
    <div className="p-3 rounded-lg border border-sky-800/50 bg-sky-950/10 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
          {base.ticker} 본주 기준 분석
        </p>
        <span className="text-[9px] text-sky-400 border border-sky-800 bg-sky-950 px-1.5 py-0.5 rounded">
          모멘텀 {base.score}점
        </span>
      </div>

      {/* 본주 현재가 */}
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[9px] text-zinc-600">본주 현재가</div>
          <div className="text-lg font-bold font-mono text-sky-300">${base.price}</div>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-1 text-center text-[9px]">
          <div className="p-1.5 bg-zinc-900 rounded border border-zinc-800">
            <div className="text-zinc-600">MA20</div>
            <div className={`font-mono font-bold ${base.price > base.ma20 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${base.ma20}
            </div>
          </div>
          <div className="p-1.5 bg-zinc-900 rounded border border-zinc-800">
            <div className="text-zinc-600">MA50</div>
            <div className={`font-mono font-bold ${base.price > base.ma50 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${base.ma50}
            </div>
          </div>
          <div className="p-1.5 bg-zinc-900 rounded border border-zinc-800">
            <div className="text-zinc-600">MA200</div>
            <div className={`font-mono font-bold ${base.price > base.ma200 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${base.ma200}
            </div>
          </div>
        </div>
      </div>

      {/* 본주 기준 신호 */}
      <div className="grid grid-cols-3 gap-2 text-[9px] text-center">
        <div className={`p-1.5 rounded border ${base.rsi > 75 ? 'border-red-800 bg-red-950/20' : base.rsi < 35 ? 'border-sky-800 bg-sky-950/20' : 'border-emerald-800 bg-emerald-950/20'}`}>
          <div className="text-zinc-500">RSI</div>
          <div className={`font-bold font-mono ${base.rsi > 75 ? 'text-red-400' : base.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'}`}>{base.rsi}</div>
        </div>
        <div className={`p-1.5 rounded border ${base.macdBull ? 'border-emerald-800 bg-emerald-950/20' : 'border-red-800 bg-red-950/20'}`}>
          <div className="text-zinc-500">MACD</div>
          <div className={`font-bold ${base.macdBull ? 'text-emerald-400' : 'text-red-400'}`}>{base.macdBull ? '▲' : '▼'}</div>
        </div>
        <div className={`p-1.5 rounded border ${base.stage === 2 ? 'border-emerald-800 bg-emerald-950/20' : 'border-zinc-800'}`}>
          <div className="text-zinc-500">Stage</div>
          <div className={`font-bold ${base.stage === 2 ? 'text-emerald-400' : base.stage === 1 ? 'text-violet-400' : 'text-red-400'}`}>{base.stage}</div>
        </div>
      </div>

      {/* 본주 기준 포지션 제안 */}
      <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
        <p className="text-[9px] text-zinc-500 mb-1">본주 {base.ticker} 기준 포지션 제안</p>
        <p className="text-[10px] text-zinc-300" style={{ fontFamily: 'system-ui' }}>
          MA50 <span className={base.price > base.ma50 ? 'text-emerald-400' : 'text-red-400'}>{ma50Status}</span>
          {' · '}MA200 <span className={base.price > base.ma200 ? 'text-emerald-400' : 'text-red-400'}>{ma200Status}</span>
          {' · '}레버리지 {mult}x 보유 중
          {base.price > base.ma50 && base.price > base.ma200 && base.stage === 2
            ? ' → 본주 상승추세 유지, ETF 홀드 적합'
            : base.price < base.ma50
            ? ' → 본주 MA50 이탈, ETF 리스크 관리 필요'
            : ' → 본주 추세 확인 중'}
        </p>
      </div>

      {(base.entryZone || base.stopLoss) && (
        <div className="flex flex-wrap gap-1.5">
          {base.entryZone && (
            <span className="text-[9px] px-2 py-1 border rounded text-emerald-300 border-emerald-800 bg-emerald-950/30">
              {base.ticker} 추가매수 {base.entryZone}
            </span>
          )}
          {base.stopLoss && (
            <span className="text-[9px] px-2 py-1 border rounded text-red-300 border-red-800 bg-red-950/30">
              {base.ticker} 손절 {base.stopLoss}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── 포지션 카드 ───────────────────────────────────────────────────────────────
function PositionCard({ r, base, onEdit, onDelete }: {
  r: PositionResult;
  base?: BaseAnalysis;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sc   = SC[r.signal];
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
          {/* 본주 추정가 헤더 표시 */}
          {base?.impliedPrices && (
            <span className="text-[9px] text-violet-400 border border-violet-900 bg-violet-950/30 px-1.5 py-0.5 rounded font-mono">
              {base.ticker} ≈ ${base.impliedPrices.compound}
            </span>
          )}
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
          {base && (
            <span className="text-violet-400">
              {base.ticker} 본주기준 {base.impliedPnlPct >= 0 ? '+' : ''}{base.impliedPnlPct.toFixed(2)}%
            </span>
          )}
        </div>
      )}

      {/* 펼침 */}
      {open && (
        <div className="border-t border-zinc-900 px-4 pb-4 pt-3 space-y-3">

          {/* 신호 */}
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
              <span>모멘텀 점수 {r.isLeverage && base ? `(ETF + ${base.ticker} 평균)` : ''}</span>
              <span className="font-mono font-bold" style={{ color: barColor }}>{r.score} / 100</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${r.score}%`, background: barColor }} />
            </div>
          </div>

          {/* 포지션 수치 */}
          <div className="grid grid-cols-4 gap-2 p-3 bg-zinc-900/60 rounded-lg text-center">
            {[
              { label: '평단가',  val: `$${r.avgPrice}`,  color: 'text-zinc-200' },
              { label: '현재가',  val: `$${r.currentPrice}`, color: 'text-zinc-100' },
              { label: '수익률',  val: `${plus ? '+' : ''}${r.pnlPct.toFixed(2)}%`, color: plus ? 'text-emerald-400' : 'text-red-400' },
              { label: '평가손익', val: `${plus ? '+' : ''}$${Math.abs(r.pnlAmt).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: plus ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
              </div>
            ))}
          </div>

          {/* 레버리지 역산 패널 */}
          {r.isLeverage && <LeveragePanel r={r} base={base} />}

          {/* 본주 기준 분석 */}
          {r.isLeverage && base && (
            <BaseAnalysisPanel base={base} mult={r.leverageMultiplier ?? 2} />
          )}

          {/* 일반 종목 기술지표 */}
          {!r.isLeverage && (
            <div className="grid grid-cols-3 gap-2">
              {r.rsi !== undefined && (
                <IndBox label="RSI" val={String(r.rsi)}
                  color={r.rsi > 78 ? 'text-red-400' : r.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'}
                  sub={r.rsi > 78 ? '과열' : r.rsi < 35 ? '침체' : '정상'} />
              )}
              {r.macdBull !== undefined && (
                <IndBox label="MACD" val={r.macdBull ? '▲ 상승' : '▼ 하락'}
                  color={r.macdBull ? 'text-emerald-400' : 'text-red-400'}
                  sub={r.macdBull ? '골든' : '데드'} />
              )}
              {r.stage !== undefined && (
                <IndBox label="Stage" val={String(r.stage)}
                  color={r.stage === 2 ? 'text-emerald-400' : r.stage === 1 ? 'text-violet-400' : 'text-red-400'}
                  sub={r.stage === 2 ? '상승추세' : r.stage === 1 ? '기반구축' : '하락'} />
              )}
            </div>
          )}

          {/* 진입/손절 (일반 종목) */}
          {!r.isLeverage && (r.entryZone || r.stopLoss) && (
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

          {r.note && (
            <p className="text-[10px] text-zinc-600 italic" style={{ fontFamily: 'system-ui' }}>📝 {r.note}</p>
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
  const [baseMap,     setBaseMap]     = useState<Record<string, BaseAnalysis>>({});
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
      // ETF 티커 + 본주 티커 모두 분석 요청
      const etfTickers  = [...new Set(positions.map(p => p.ticker))];
      const baseTickers = [...new Set(positions.filter(p => p.isLeverage && p.leverageBase).map(p => p.leverageBase as string))];
      const allTickers  = [...new Set([...etfTickers, ...baseTickers])];

      const res  = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: allTickers }),
      });
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map: Record<string, any> = Object.fromEntries((data.stocks ?? []).map((s: any) => [s.ticker, s]));

      setUpdatedAt(new Date().toLocaleTimeString('ko-KR'));

      // 포지션 결과 계산
      const newResults = positions.map(pos => {
        const s      = map[pos.ticker];
        const cur    = s?.price ?? pos.avgPrice;
        const pnlPct = Math.round(((cur - pos.avgPrice) / pos.avgPrice) * 10000) / 100;
        const pnlAmt = Math.round((cur - pos.avgPrice) * pos.shares * 100) / 100;

        // 본주 점수 (레버리지인 경우)
        const baseS     = pos.isLeverage && pos.leverageBase ? map[pos.leverageBase] : null;
        const baseScore = baseS?.momentum_score;
        const etfScore  = s?.momentum_score ?? 50;
        const score     = baseScore !== undefined ? Math.round((etfScore + baseScore) / 2) : etfScore;

        const { signal, reason } = calcSignal(etfScore, pnlPct, baseScore);

        return {
          ...pos,
          currentPrice: Math.round(cur * 100) / 100,
          pnlPct, pnlAmt,
          totalValue: Math.round(cur * pos.shares * 100) / 100,
          score, signal, signalReason: reason,
          entryZone: s?.entry_zone,
          stopLoss:  s?.stop_loss,
          rsi:       s?.rsi,
          macdBull:  (s?.macd_histogram ?? 0) > 0,
          stage:     s?.setup_stage,
        };
      });
      setResults(newResults);

      // 본주 분석 맵 계산
      const newBaseMap: Record<string, BaseAnalysis> = {};
      for (const pos of positions) {
        if (!pos.isLeverage || !pos.leverageBase) continue;
        const s    = map[pos.ticker];     // ETF 데이터
        const bs   = map[pos.leverageBase]; // 본주 데이터
        if (!bs || !s) continue;

        const etfNow = s.price ?? pos.avgPrice;
        const implied = pos.baseAtPurchase
          ? estimateBasePrice(etfNow, pos.avgPrice, pos.baseAtPurchase, pos.leverageMultiplier ?? 2)
          : undefined;

        const impliedPnlPct = implied && pos.baseAtPurchase
          ? Math.round(((implied.compound - pos.baseAtPurchase) / pos.baseAtPurchase) * 10000) / 100
          : 0;

        newBaseMap[pos.id] = {
          ticker:        pos.leverageBase,
          price:         Math.round((bs.price ?? 0) * 100) / 100,
          score:         bs.momentum_score ?? 50,
          ma20:          Math.round((bs.ma20 ?? 0) * 100) / 100,
          ma50:          Math.round((bs.ma50 ?? 0) * 100) / 100,
          ma200:         Math.round((bs.ma200 ?? 0) * 100) / 100,
          rsi:           bs.rsi ?? 50,
          macdBull:      (bs.macd_histogram ?? 0) > 0,
          stage:         bs.setup_stage ?? 0,
          entryZone:     bs.entry_zone,
          stopLoss:      bs.stop_loss,
          impliedPrices: implied ?? { linear: 0, compound: 0, decay: 0 },
          impliedPnlPct,
        };
      }
      setBaseMap(newBaseMap);

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
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
          <SumBox label="총 평가액" val={`$${totalVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <SumBox label="총 손익"
            val={`${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            sub={`(${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)`}
            color={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
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
            {updatedAt && <div className="text-[9px] text-zinc-700">{updatedAt}</div>}
          </div>
        </div>
      )}

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
                  <PositionCard
                    r={r}
                    base={baseMap[r.id]}
                    onEdit={() => setEditId(r.id)}
                    onDelete={() => del(r.id)} />
                )}
              </div>
            ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4 text-zinc-800">◈</div>
          <p className="text-zinc-500 text-sm mb-1">보유 포지션을 추가하세요</p>
          <p className="text-zinc-700 text-xs">레버리지 ETF는 본주 기준 복리 역산 자동 계산</p>
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
