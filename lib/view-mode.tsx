'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type ViewMode = 'agent' | 'admin'

interface ViewModeContextType {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  isAgent: boolean
  isAdmin: boolean
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined)

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>('agent')

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

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        isAgent: viewMode === 'agent',
        isAdmin: viewMode === 'admin',
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
