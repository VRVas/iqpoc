'use client'

import React, { useState, useEffect, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const GENERAL_ACCESS_PASSWORD = '2026generalpassforqatarairwaysdemo2026'
const COOKIE_NAME = 'iq_general_access'
const COOKIE_MAX_AGE_DAYS = 30

function setAccessCookie() {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60
  document.cookie = `${COOKIE_NAME}=granted; path=/; max-age=${maxAge}; SameSite=Lax`
}

function hasAccessCookie(): boolean {
  return document.cookie.split(';').some(c => c.trim().startsWith(`${COOKIE_NAME}=`))
}

export function GeneralAccessGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    setAuthenticated(hasAccessCookie())
  }, [])

  // Still checking — render nothing to avoid flash
  if (authenticated === null) {
    return null
  }

  if (authenticated) {
    return <>{children}</>
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === GENERAL_ACCESS_PASSWORD) {
      setAccessCookie()
      setAuthenticated(true)
      setPassword('')
    } else {
      setError(true)
      setTimeout(() => setError(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#5C0632]/20 border border-[#5C0632]/30 mb-4">
            <svg className="w-8 h-8 text-[#5C0632]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-1">Foundry IQ Demo</h1>
          <p className="text-sm text-neutral-400">Enter the access password to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false) }}
            placeholder="Access password"
            autoFocus
            className={cn(
              'w-full px-4 py-3 rounded-xl border bg-neutral-900 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#5C0632]',
              error ? 'border-red-500 ring-2 ring-red-500/30' : 'border-neutral-700'
            )}
          />
          {error && <p className="text-xs text-red-400">Incorrect password</p>}
          <button
            type="submit"
            className="w-full px-4 py-3 rounded-xl bg-[#5C0632] text-white text-sm font-medium hover:bg-[#5C0632]/90 transition-colors"
          >
            Enter
          </button>
        </form>

        <p className="text-center text-xs text-neutral-600 mt-6">Qatar Airways Contact Center Assistant</p>
      </div>
    </div>
  )
}
