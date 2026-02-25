'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowRight20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Database20Regular,
} from '@fluentui/react-icons'
import { useRouter } from 'next/navigation'
import { fetchKnowledgeBases } from '@/lib/api'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import Image from 'next/image'
import { cn } from '@/lib/utils'

interface KnowledgeBase {
  name: string
  description?: string
  outputMode?: string
  knowledgeSources?: { name: string }[]
}

export function IndustryKnowledgeSelector() {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKB, setSelectedKB] = useState<string | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchKnowledgeBases()
        setKnowledgeBases(data.value || [])
      } catch (err) {
        console.error('Failed to fetch knowledge bases:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const checkScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true })
      window.addEventListener('resize', checkScroll)
      return () => {
        el.removeEventListener('scroll', checkScroll)
        window.removeEventListener('resize', checkScroll)
      }
    }
  }, [knowledgeBases])

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' })
  }

  const handleSelect = (kb: KnowledgeBase) => {
    setSelectedKB(kb.name)
    router.push(`/test?agent=${encodeURIComponent(kb.name)}`)
  }

  return (
    <div className="min-h-[calc(100vh-7rem)] flex flex-col items-center justify-center p-6">
      <div className="max-w-7xl w-full space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-4"
        >
          <div className="inline-flex mb-2">
            <Image src="/logo-dark.png" alt="Qatar Airways" width={48} height={48} className="dark:hidden object-contain" />
            <Image src="/logo_light.png" alt="Qatar Airways" width={48} height={48} className="hidden dark:block object-contain" />
          </div>
          <h1 className="text-4xl font-bold text-fg-default">
            Knowledge Bases
          </h1>
          <p className="text-lg text-fg-muted max-w-2xl mx-auto">
            Select a knowledge base to start querying with AI-powered search and answer synthesis
          </p>
        </motion.div>

        {/* Carousel */}
        {loading ? (
          <div className="flex gap-6 justify-center">
            {[1, 2, 3].map(i => (
              <LoadingSkeleton key={i} className="h-56 w-80 rounded-xl" />
            ))}
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Database20Regular className="h-12 w-12 mx-auto text-fg-subtle" />
            <p className="text-fg-muted">No knowledge bases found. Create one in Admin mode.</p>
          </div>
        ) : (
          <div className="relative group">
            {/* Scroll buttons */}
            {canScrollLeft && (
              <button
                onClick={() => scroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 h-10 w-10 rounded-full bg-bg-card border border-stroke-divider shadow-md flex items-center justify-center hover:bg-bg-hover transition-colors"
              >
                <ChevronLeft20Regular className="h-5 w-5" />
              </button>
            )}
            {canScrollRight && (
              <button
                onClick={() => scroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 h-10 w-10 rounded-full bg-bg-card border border-stroke-divider shadow-md flex items-center justify-center hover:bg-bg-hover transition-colors"
              >
                <ChevronRight20Regular className="h-5 w-5" />
              </button>
            )}

            <div
              ref={scrollRef}
              className="flex gap-6 overflow-x-auto hide-scrollbar scroll-smooth px-2 py-2"
            >
              {knowledgeBases.map((kb, index) => {
                const isSelected = selectedKB === kb.name
                const sourceCount = kb.knowledgeSources?.length ?? 0

                return (
                  <motion.div
                    key={kb.name}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.08 }}
                    className="flex-shrink-0 w-80"
                  >
                    <Card
                      className={cn(
                        'h-full cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1',
                        isSelected
                          ? 'border-accent shadow-lg ring-2 ring-accent ring-offset-2 ring-offset-bg-canvas'
                          : 'hover:border-accent/50'
                      )}
                      onClick={() => handleSelect(kb)}
                    >
                      <CardHeader className="space-y-3 pb-2">
                        <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                          <Database20Regular className="h-6 w-6 text-accent" />
                        </div>
                        <div className="space-y-1">
                          <CardTitle className="text-lg">{kb.name}</CardTitle>
                          {kb.outputMode && (
                            <span className="inline-block text-xs font-medium text-accent capitalize">
                              {kb.outputMode === 'answerSynthesis' ? 'Answer Synthesis' : 'Extractive Data'}
                            </span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {kb.description && (
                          <CardDescription className="text-sm leading-relaxed line-clamp-3">
                            {kb.description}
                          </CardDescription>
                        )}
                        {sourceCount > 0 && (
                          <p className="text-xs text-fg-subtle">
                            {sourceCount} knowledge source{sourceCount !== 1 ? 's' : ''}
                          </p>
                        )}
                        <Button
                          className="w-full group"
                          variant={isSelected ? 'default' : 'outline'}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelect(kb)
                          }}
                        >
                          {isSelected ? 'Opening...' : 'Try Now'}
                          <ArrowRight20Regular className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          </div>
        )}

        {/* Helper */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center"
        >
          <p className="text-sm text-fg-muted">
            Each knowledge base is connected to your Azure AI Search resource
          </p>
        </motion.div>
      </div>
    </div>
  )
}

