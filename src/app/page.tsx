'use client';

import { useState } from 'react';
import PortfolioTab from '@/components/PortfolioTab';
import MarketStatus from '@/components/MarketStatus';

type Tab = 'portfolio';

export default function Home() {
  const [tab] = useState<Tab>('portfolio');
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* 헤더 */}
        <header className="mb-6 pb-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                MOMENTUM TRADER
                <span className="ml-2 text-[10px] text-zinc-600 border border-zinc-800 px-1.5 py-0.5 rounded font-mono">v2</span>
              </h1>
              <p className="text-xs text-zinc-600 mt-0.5">{today}</p>
            </div>
            <MarketStatus />
          </div>
        </header>

        {/* 탭 콘텐츠 */}
        {tab === 'portfolio' && <PortfolioTab />}

        <footer className="mt-8 pt-4 border-t border-zinc-900">
          <p className="text-[10px] text-zinc-700 text-center" style={{ fontFamily: 'system-ui' }}>
            Yahoo Finance 공개 데이터 기반 참고 정보 · 투자 권유 아님
          </p>
        </footer>
      </div>
    </div>
  );
}
