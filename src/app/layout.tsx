import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Momentum Trader V2',
  description: '포트폴리오 모멘텀 분석 · 레버리지 역산 · 매매 가이던스',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#0a0a0a] text-zinc-200 antialiased">
        {children}
      </body>
    </html>
  );
}
