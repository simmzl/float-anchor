import './globals.css'

export const metadata = { title: 'FloatAnchor 分享', robots: { index: false, follow: false } }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="zh"><body>{children}</body></html>)
}
