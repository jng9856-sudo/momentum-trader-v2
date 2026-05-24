'use client';

import { useState, useEffect } from 'react';

interface RegimeData {
  regime: 'BULL' | 'NEUTRAL' | 'CAUTION' | 'BEAR';
  label: string;
  emoji: string;
  vix: number;
}

const REGIME_STYLE = {
  BULL:    'border-emerald-800 bg-emerald-950/20 text-emerald-300',
  NEUTRAL: 'border-amber-800   bg-amber-950/20   text-amber-300',
  CAUTION: 'border-orange-800  bg-orange-950/20  text-orange-300',
  BEAR:    'border-red-800     bg-red-950/20     text-red-300',
} as const;

export default function MarketStatus() {
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: ['SPY'] }),
    })
      .then(r => r.json())
      .then(d => { if (d.market_regime) setRegime(d.market_regime); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/40 p-4 flex items-center gap-2">
      <span className="text-[10px] text-zinc-600 uppercase tracking-widest">시장 국면</span>
      <span className="text-zinc-700 text-xs blink">분석 중...</span>
    </div>
  );

  if (!regime) return null;

  return (
    <div className={`border rounded-xl p-4 flex items-center justify-between ${REGIME_STYLE[regime.regime]}`}>
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">시장 국면</p>
        <p className="text-sm font-bold">{regime.emoji} {regime.label}</p>
      </div>
      <div className="text-right">
        <p className="text-[10px] text-zinc-500 mb-0.5">VIX</p>
        <p className={`text-lg font-bold font-mono ${regime.vix > 30 ? 'text-red-400' : regime.vix > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {regime.vix}
        </p>
      </div>
    </div>
  );
}
