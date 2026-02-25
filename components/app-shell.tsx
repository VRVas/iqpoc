'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ThemeToggle } from '@/components/theme-toggle'
import { useViewMode } from '@/lib/view-mode'
import {
  Database20Regular,
  Bot20Regular,
  Play20Regular,
  Navigation20Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Tooltip } from '@/components/ui/tooltip'
import Image from 'next/image'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const navigation: NavItem[] = [
  { href: '/agents', label: 'Agents', icon: Bot20Regular },
  { href: '/test', label: 'Playground', icon: Play20Regular },
  { href: '/knowledge', label: 'Knowledge', icon: Database20Regular },
]

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const pathname = usePathname()
  const { isAgent } = useViewMode()

  // Load persisted collapse state
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('sidebarCollapsed')
      if (stored === 'true') setCollapsed(true)
    } catch {}
  }, [])

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebarCollapsed', String(next)) } catch {}
      return next
    })
  }

  // Keyboard shortcut Ctrl+B to toggle collapse (similar to VS Code sidebar)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleCollapse();
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // In agent mode: no sidebar at all. In admin mode: sidebar except landing page.
  const showSidebar = !isAgent && pathname !== '/'

  return (
  <div className="relative h-screen overflow-y-hidden bg-bg-canvas text-fg-default">
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-50 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-fg-on-accent shadow-md focus:outline-none focus:ring-2 focus:ring-stroke-focus focus:ring-offset-2 focus:ring-offset-bg-canvas"
      >
        Skip to content
      </a>

      {/* Header */}
      <Header onMenuClick={() => setSidebarOpen(true)} showSidebar={showSidebar} />

  <div className="flex h-full">
        {showSidebar && (
          <>
            {/* Mobile sidebar overlay */}
            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="fixed inset-0 z-40 bg-overlay-soft/70 backdrop-blur-elevated md:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
            </AnimatePresence>

            {/* Sidebar */}
            <Sidebar
              navigation={navigation}
              currentPath={pathname}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
            />
          </>
        )}

        {/* Main content */}
        <main
          id="main-content"
          className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pt-16 transition-[margin] duration-200 ease-out hide-scrollbar',
            showSidebar && (collapsed ? 'md:ml-20' : 'md:ml-64')
          )}
        >
          <div className={cn('flex-1 min-h-0', showSidebar && !pathname.includes('/playground') && !pathname.includes('/test') ? 'px-6 pb-16 pt-6 md:px-10' : '')}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

interface HeaderProps {
  onMenuClick: () => void
  showSidebar: boolean
}

function Header({ onMenuClick, showSidebar }: HeaderProps) {
  const { viewMode, setViewMode, isAdmin } = useViewMode()
  const router = useRouter()

  const handleModeToggle = (checked: boolean) => {
    const newMode = checked ? 'admin' : 'agent'
    setViewMode(newMode)
    // When switching to agent mode, redirect to /test?agent=test
    if (newMode === 'agent') {
      router.push('/test?agent=test')
    }
  }

  return (
  <header className="fixed top-0 left-0 right-0 z-30 border-b border-glass-border bg-glass-surface backdrop-blur-elevated shadow-sm">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          {showSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={onMenuClick}
              aria-label="Open navigation menu"
            >
              <Navigation20Regular className="h-5 w-5" />
            </Button>
          )}

          <Link href={isAdmin ? '/' : '/test?agent=test'} aria-label="Home" className="flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-stroke-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas">
            {/* QR Oryx logo — dark version for light mode, light for dark */}
            <Image src="/logo-dark.png" alt="Qatar Airways" width={32} height={32} priority className="shrink-0 dark:hidden object-contain" />
            <Image src="/logo_light.png" alt="Qatar Airways" width={32} height={32} priority className="shrink-0 hidden dark:block object-contain" />
            <span className="truncate text-base font-semibold leading-tight tracking-tight max-w-[14rem] sm:max-w-none">
              <span className="hidden sm:inline">Qatar Airways Contact Center Assistant</span>
              <span className="sm:hidden">QR Assistant</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {/* Agent / Admin toggle */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium transition-colors', !isAdmin ? 'text-accent' : 'text-fg-muted')}>Agent</span>
            <Switch
              checked={isAdmin}
              onCheckedChange={handleModeToggle}
              aria-label="Toggle between Agent and Admin view"
            />
            <span className={cn('text-xs font-medium transition-colors', isAdmin ? 'text-accent' : 'text-fg-muted')}>Admin</span>
          </div>

          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

interface SidebarProps {
  navigation: NavItem[]
  currentPath: string
  isOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

function Sidebar({ navigation, currentPath, isOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <nav className={cn('hidden md:fixed md:inset-y-0 md:top-16 md:flex md:flex-col transition-[width] duration-200 ease-out', collapsed ? 'md:w-20' : 'md:w-64')}
        aria-label="Primary navigation"
        aria-expanded={!collapsed}
      >
  <div className="flex flex-1 flex-col overflow-hidden border-r border-glass-border bg-glass-surface backdrop-blur-elevated shadow-lg">
          <div className="flex flex-1 flex-col overflow-y-auto px-3 py-6">
            <div className={cn('mb-6 flex justify-end', collapsed && 'justify-center')}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full border border-transparent hover:border-accent-muted"
                onClick={onToggleCollapse}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={collapsed}
              >
                <motion.span
                  initial={false}
                  animate={{ rotate: collapsed ? 180 : 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="inline-flex"
                >
                  <Navigation20Regular className="h-5 w-5" />
                </motion.span>
              </Button>
            </div>
            <nav className="mt-2 flex-1 space-y-1.5">
              {navigation.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  isActive={currentPath === item.href}
                  collapsed={collapsed}
                />
              ))}
            </nav>
          </div>
        </div>
      </nav>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {isOpen && (
          <motion.nav
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-y-0 left-0 z-50 w-64 border-r border-glass-border bg-glass-surface backdrop-blur-elevated shadow-xl md:hidden"
          >
            <div className="flex flex-col h-full">
              <div className="flex h-16 items-center justify-between border-b border-glass-border px-4">
                <Link href="/" aria-label="Home" className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-stroke-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas">
                  <Image src="/logo-dark.png" alt="Qatar Airways" width={24} height={24} className="shrink-0 dark:hidden object-contain" />
                  <Image src="/logo_light.png" alt="Qatar Airways" width={24} height={24} className="shrink-0 hidden dark:block object-contain" />
                  <span className="truncate text-sm font-semibold leading-tight">QR Assistant</span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Close navigation menu"
                >
                  <Dismiss20Regular className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex flex-1 flex-col overflow-y-auto px-3 py-6">
                <nav className="mt-2 flex-1 space-y-1.5">
                  {navigation.map((item) => (
                    <SidebarLink
                      key={item.href}
                      item={item}
                      isActive={currentPath === item.href}
                      onClick={onClose}
                    />
                  ))}
                </nav>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  )
}

interface SidebarLinkProps {
  item: NavItem
  isActive: boolean
  onClick?: () => void
  collapsed?: boolean
}

function SidebarLink({ item, isActive, onClick, collapsed }: SidebarLinkProps) {
  const Icon = item.icon

  const linkEl = (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-fast ease-out',
        isActive
          ? 'bg-accent-subtle text-accent shadow-sm'
          : 'text-fg-muted hover:bg-glass-hover hover:text-fg-default',
        collapsed && 'justify-center px-2'
      )}
    >
      {isActive && (
  <div className="absolute left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-accent" />
      )}
      <Icon className={cn('h-5 w-5 flex-shrink-0', collapsed ? 'mx-auto' : 'text-fg-muted group-hover:text-fg-default')} />
      {!collapsed && <span className="truncate tracking-tight">{item.label}</span>}
    </Link>
  )
  return collapsed ? <Tooltip content={item.label}>{linkEl}</Tooltip> : linkEl
}