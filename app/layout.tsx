import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Gargle — Brainrot Experiment',
  description: 'Always-on Claude-powered agent under brain-rot feed.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
