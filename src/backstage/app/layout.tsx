import './globals.scss'

export const metadata = {
  title: '玺鸿珠宝后台',
  description: 'Xihong Jewelry commerce administration'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
