import type { Metadata } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/app-shell'
import { ThemeProvider } from '@/components/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { ViewModeProvider } from '@/lib/view-mode'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Qatar Airways Contact Center Assistant',
  description: 'AI co-pilot assisting customer service agents with company knowledge, suggested responses, and relevant documentation powered by Azure AI Search',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ViewModeProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </ViewModeProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}