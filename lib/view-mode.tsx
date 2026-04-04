'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type ViewMode = 'agent' | 'admin'

const ADMIN_PASSWORD = 'qrcc2026'

interface ViewModeContextType {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  isAgent: boolean
  isAdmin: boolean
  /** Prompt for admin password. Returns true if authenticated. */
  requestAdminAccess: () => Promise<boolean>
  /** Whether the password prompt dialog is currently open */
  showPasswordPrompt: boolean
  /** Submit password attempt */
  submitPassword: (password: string) => boolean
  /** Close the password prompt without authenticating */
  cancelPasswordPrompt: () => void
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined)

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>('agent')
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [pendingResolve, setPendingResolve] = useState<((val: boolean) => void) | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('viewMode')
      if (saved === 'agent' || saved === 'admin') {
        setViewModeState(saved)
      }
    } catch {}
  }, [])

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode)
    try {
      localStorage.setItem('viewMode', mode)
    } catch {}
  }

  const requestAdminAccess = (): Promise<boolean> => {
    // Already admin — no prompt needed
    if (viewMode === 'admin') return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      setPendingResolve(() => resolve)
      setShowPasswordPrompt(true)
    })
  }

  const submitPassword = (password: string): boolean => {
    if (password === ADMIN_PASSWORD) {
      setViewMode('admin')
      setShowPasswordPrompt(false)
      pendingResolve?.(true)
      setPendingResolve(null)
      return true
    }
    return false
  }

  const cancelPasswordPrompt = () => {
    setShowPasswordPrompt(false)
    pendingResolve?.(false)
    setPendingResolve(null)
  }

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        isAgent: viewMode === 'agent',
        isAdmin: viewMode === 'admin',
        requestAdminAccess,
        showPasswordPrompt,
        submitPassword,
        cancelPasswordPrompt,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext)
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider')
  return ctx
}

export { ADMIN_PASSWORD }
