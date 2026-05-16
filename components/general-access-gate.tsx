'use client'

import React, { useState, useEffect, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { tenant } from '@/lib/tenant'

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
  // Tenants that opt out of the general-access password (e.g. Zava) skip the gate entirely.
  const gateEnabled = tenant.generalAccessGate?.enabled === true

  const [authenticated, setAuthenticated] = useState<boolean | null>(gateEnabled ? null : true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!gateEnabled) return
    setAuthenticated(hasAccessCookie())
  }, [gateEnabled])

  // Still checking — render nothing to avoid flash
  if (authenticated === null) {
    return null
  }

  if (authenticated) {
    return <>{children}</>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setAccessCookie()
        setAuthenticated(true)
        setPassword('')
      } else {
        setError(true)
        setTimeout(() => setError(false), 2000)
      }
    } catch {
      setError(true)
      setTimeout(() => setError(false), 2000)
    } finally {
      setSubmitting(false)
    }
  }

  const footer = tenant.generalAccessGate?.footerCaption ?? tenant.footerCaption

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/20 border border-accent/30 mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
            disabled={submitting}
            className={cn(
              'w-full px-4 py-3 rounded-xl border bg-neutral-900 text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60',
              error ? 'border-red-500 ring-2 ring-red-500/30' : 'border-neutral-700'
            )}
          />
          {error && <p className="text-xs text-red-400">Incorrect password</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-3 rounded-xl bg-accent text-fg-on-accent text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-60"
          >
            {submitting ? 'Verifying…' : 'Enter'}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-600 mt-6">{footer}</p>
      </div>
    </div>
  )
}

