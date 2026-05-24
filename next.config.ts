import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Yahoo Finance API 호출은 서버사이드(API Route)에서만 실행
  // 별도 외부 이미지 도메인 불필요
};

export default nextConfig;
