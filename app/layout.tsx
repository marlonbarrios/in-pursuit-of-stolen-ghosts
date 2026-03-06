import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'in pursuit of stolen ghosts | concept, programming, sound design and performance by marlon barrios solano',
  description: '',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="light" style={{ backgroundColor: '#f9fafb' }}>
      <body className={inter.className} style={{ backgroundColor: '#f9fafb' }}>{children}</body>
    </html>
  )
}
