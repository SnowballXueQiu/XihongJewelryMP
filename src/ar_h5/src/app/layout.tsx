import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '玺鸿珠宝 AR 试戴',
  description: '在线 AR 手部珠宝试戴',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
