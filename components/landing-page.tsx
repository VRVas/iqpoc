'use client'

import { Button } from '@/components/ui/button'
import {
  ChevronRight20Regular,
  Search20Regular,
  DocumentBulletList20Regular,
  ChatBubblesQuestion20Regular,
  BotSparkle20Regular,
  Database20Regular,
  LayerDiagonal20Regular,
  DocumentCheckmark20Regular,
  Beaker20Regular,
  DataTrending20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { tenant } from '@/lib/tenant'

// Map JSON-driven `iconId` values to actual Fluent UI icon components. Adding
// a new id here keeps the tenant JSON files free of code-level imports.
const ICON_BY_ID: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: ChatBubblesQuestion20Regular,
  search: Search20Regular,
  document: DocumentBulletList20Regular,
  'agent-build': BotSparkle20Regular,
  knowledge: Database20Regular,
  retrieval: LayerDiagonal20Regular,
  citations: DocumentCheckmark20Regular,
  evaluation: Beaker20Regular,
  monitoring: DataTrending20Regular,
}

// Hard fallback used only if a tenant JSON is missing its `landing` block.
const FALLBACK_LANDING = {
  title: 'Foundry IQ Demo',
  description: 'AI assistant powered by Azure AI Search and Azure AI Foundry.',
  tagline: '',
  ctaLabel: 'Get Started',
  ctaTarget: '/agents',
  capabilities: [] as Array<{ iconId: string; title: string; desc: string }>,
}

export function LandingPage() {
  const router = useRouter()
  const landing = tenant.landing ?? FALLBACK_LANDING

  // Choose a responsive grid based on how many cards the tenant configured.
  // 3 → 3-col, 4 → 2x2, 5+ → 2 cols on tablet, 3 cols on desktop.
  const capabilityCount = landing.capabilities.length
  const gridCols =
    capabilityCount <= 3
      ? 'sm:grid-cols-3'
      : capabilityCount === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : 'sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative">
      {/* Centered Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="text-center max-w-5xl"
      >
        {/* Logo */}
        <div className="mb-8 inline-flex">
          <Image
            src={tenant.logoLight}
            alt={tenant.logoAltText}
            width={72}
            height={72}
            className="object-contain"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold text-fg-default tracking-tight mb-4">
          {landing.title}
        </h1>

        {/* Description */}
        <p className="text-lg text-fg-muted mb-4 max-w-2xl mx-auto leading-relaxed">
          {landing.description}
        </p>
        {landing.tagline && (
          <p className="text-sm text-fg-subtle mb-10 max-w-xl mx-auto">
            {landing.tagline}
          </p>
        )}

        {/* Capabilities */}
        {capabilityCount > 0 && (
          <div className={`grid grid-cols-1 ${gridCols} gap-4 mb-10`}>
            {landing.capabilities.map((cap, i) => {
              const Icon = ICON_BY_ID[cap.iconId] ?? Sparkle20Regular
              return (
                <motion.div
                  key={`${cap.iconId}-${i}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
                  className="p-4 rounded-xl border border-stroke-divider bg-bg-card text-left space-y-2"
                >
                  <Icon className="h-5 w-5 text-accent" />
                  <h3 className="text-sm font-semibold text-fg-default">{cap.title}</h3>
                  <p className="text-xs text-fg-muted leading-relaxed">{cap.desc}</p>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* CTA Button */}
        <Button
          size="lg"
          className="h-14 px-10 text-lg bg-accent hover:bg-accent-hover text-fg-on-accent"
          onClick={() => router.push(landing.ctaTarget ?? '/agents')}
        >
          {landing.ctaLabel ?? 'Get Started'}
          <ChevronRight20Regular className="ml-2 h-5 w-5" />
        </Button>
      </motion.div>

      {/* Footer */}
      <footer className="absolute bottom-0 left-0 right-0 p-6 text-center text-xs text-fg-subtle">
        Powered by Azure AI Search &bull; Azure AI Foundry
      </footer>
    </div>
  )
}
