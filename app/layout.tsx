import type { Metadata } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/app-shell'
import { ThemeProvider } from '@/components/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { ViewModeProvider } from '@/lib/view-mode'
import { GeneralAccessGate } from '@/components/general-access-gate'
import NextTopLoader from 'nextjs-toploader'
import { tenant, BUILD_TENANT_ID } from '@/lib/tenant'

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
  title: tenant.metadataTitle,
  description: tenant.metadataDescription,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const tenantClass = BUILD_TENANT_ID === 'qatar' ? '' : `tenant-${BUILD_TENANT_ID}`
  // For tenants that ship a custom non-Next-bundled font (e.g. Zava → Stack Sans Text),
  // override the CSS var that Tailwind's `font-sans` consumes. The font itself is
  // imported via @import in app/globals.css so the file is fetched once per page.
  const sansFontOverride =
    tenant.fontFamily !== 'Space Grotesk'
      ? ({ ['--font-sans' as any]: `'${tenant.fontFamily}', system-ui, -apple-system, sans-serif` } as React.CSSProperties)
      : undefined

  return (
    <html lang="en" className={tenantClass} suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
        style={sansFontOverride}
      >
        <NextTopLoader color={tenant.topLoaderColor} height={3} showSpinner={false} />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <GeneralAccessGate>
            <ViewModeProvider>
              <ToastProvider>
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </ViewModeProvider>
          </GeneralAccessGate>
        </ThemeProvider>
      </body>
    </html>
  )
}