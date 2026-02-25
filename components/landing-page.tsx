'use client'

import { Button } from '@/components/ui/button'
import {
  ChevronRight20Regular,
  Search20Regular,
  DocumentBulletList20Regular,
  ChatBubblesQuestion20Regular,
} from '@fluentui/react-icons'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'

const CAPABILITIES = [
  {
    icon: ChatBubblesQuestion20Regular,
    title: 'Real-Time Guidance',
    desc: 'AI co-pilot answers agent questions directly and concisely during live interactions',
  },
  {
    icon: Search20Regular,
    title: 'Knowledge Retrieval',
    desc: 'Find relevant documentation and policies from company knowledge bases instantly',
  },
  {
    icon: DocumentBulletList20Regular,
    title: 'Cited Responses',
    desc: 'Every answer references source documents so agents can verify and share with confidence',
  },
]

export function LandingPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative">
      {/* Centered Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="text-center max-w-3xl"
      >
        {/* Logo */}
        <div className="mb-8 inline-flex">
          <Image
            src="/logo-dark.png"
            alt="Qatar Airways"
            width={72}
            height={72}
            className="dark:hidden object-contain"
          />
          <Image
            src="/logo_light.png"
            alt="Qatar Airways"
            width={72}
            height={72}
            className="hidden dark:block object-contain"
          />
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold text-fg-default tracking-tight mb-4">
          Contact Center Assistant
        </h1>

        {/* Description */}
        <p className="text-lg text-fg-muted mb-4 max-w-2xl mx-auto leading-relaxed">
          An AI co-pilot assisting customer service agents in real-time with company knowledge,
          suggested responses, and relevant documentation.
        </p>
        <p className="text-sm text-fg-subtle mb-10 max-w-xl mx-auto">
          Prioritizes customer resolution and agent efficiency — professional, helpful, and actionable.
        </p>

        {/* Capabilities */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {CAPABILITIES.map((cap, i) => (
            <motion.div
              key={cap.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 + i * 0.1 }}
              className="p-4 rounded-xl border border-stroke-divider bg-bg-card text-left space-y-2"
            >
              <cap.icon className="h-5 w-5 text-accent" />
              <h3 className="text-sm font-semibold text-fg-default">{cap.title}</h3>
              <p className="text-xs text-fg-muted leading-relaxed">{cap.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* CTA Button */}
        <Button
          size="lg"
          className="h-14 px-10 text-lg bg-accent hover:bg-accent-hover text-fg-on-accent"
          onClick={() => router.push('/test')}
        >
          Get Started
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
