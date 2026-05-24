# Momentum Trader V2

포트폴리오 모멘텀 분석 · 레버리지 역산 · 매매 가이던스

## 기술 스택

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Yahoo Finance** (무료 · API 키 불필요)
- **localStorage** (별도 DB 없음)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 포지션 관리 | 티커 · 평단가 · 수량 직접 입력 |
| 매매 신호 | ADD / HOLD / REDUCE / SELL |
| 기술 지표 | RSI · MACD · ATR · VCP · Stage · OBV · RS Line |
| 레버리지 역산 | NVDL·TSLL·SOXL 등 → 본주 추정가 자동 계산 |
| 시장 국면 | SPY MA200 + VIX 기반 BULL/NEUTRAL/CAUTION/BEAR |

## 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000
```

## GitHub → Vercel 배포

```bash
# 1. GitHub 새 레포 생성 후
git init
git add .
git commit -m "feat: momentum trader v2 initial"
git remote add origin https://github.com/YOUR_USERNAME/momentum-trader-v2.git
git push -u origin main

# 2. vercel.com → Import Project → GitHub 레포 선택
# 3. 환경변수 없음 (Yahoo Finance 무료 사용)
# 4. Deploy
```

## 환경변수

없음. Yahoo Finance 공개 API 사용.

## 신호 기준

| 신호 | 조건 |
|---|---|
| 추가매수 | 모멘텀 점수 ≥ 72 |
| 홀드 | 50 ≤ 점수 < 72, 손실 < 20% |
| 부분매도 | 점수 < 40, 수익 > 15% |
| 매도 | 점수 < 35 또는 손실 > 25% |

## 레버리지 역산

ETF 평단가 대비 현재가 변동률을 배율로 나눠 본주 가격을 추정합니다.  
단기 근사값이며 장기 보유 시 복리 괴리 발생 가능.

```
본주 추정가 = 매수당시본주가 × (1 + (현재ETF/평단ETF - 1) / 배율)
```
