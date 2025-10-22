import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Brainrot Lab',
  description: 'Which model loses the plot first?',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
