import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

/**
 * Get current date and time formatted for an arbitrary IANA timezone.
 * Used to inject temporal context into system messages for every conversation.
 *
 * On the client, prefer passing the browser-detected timezone via
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` so the LLM sees the user's
 * local time (effectively "by IP" since browser TZ is derived from OS locale).
 *
 * Pass `undefined` to use the server's local timezone, or pass a fallback
 * like `tenant.timeZone` when working server-side without a request header.
 */
export function getTenantDateTime(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date())
}

/**
 * Get current date and time formatted for the browser's detected timezone.
 * Returns `{ value, timeZone, label }` for easy injection into LLM prompts.
 * Client-side only — server-side code should use `getTenantDateTime(tz)`
 * with the timezone read from the request header.
 */
export function getBrowserDateTime(): { value: string; timeZone: string; label: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const value = getTenantDateTime(timeZone)
  return { value, timeZone, label: timeZone }
}

/**
 * @deprecated Use `getTenantDateTime(tenant.timeZone)` or `getBrowserDateTime()` instead.
 * Retained as a thin wrapper to avoid breaking any call site still on the old name.
 */
export function getQatarDateTime(): string {
  return getTenantDateTime('Asia/Qatar')
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffInMs = now.getTime() - d.getTime()
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60))
  const diffInHours = Math.floor(diffInMinutes / 60)
  const diffInDays = Math.floor(diffInHours / 24)

  if (diffInMinutes < 1) return 'Just now'
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`
  if (diffInHours < 24) return `${diffInHours}h ago`
  if (diffInDays < 7) return `${diffInDays}d ago`
  return formatDate(d)
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

/**
 * Clean and format text for display by removing HTML markup, 
 * normalizing whitespace, and handling common formatting issues
 */
export function cleanTextSnippet(text: string): string {
  if (!text) return ''
  
  return text
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove HTML entities (convert common ones, remove others)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x?[a-fA-F0-9]+;/g, '') // Remove other HTML entities
    .replace(/&[a-zA-Z0-9#]+;/g, '') // Remove remaining entities
    // Normalize various types of whitespace and line breaks
    .replace(/[\r\n]+/g, ' ') // Convert line breaks to spaces
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .replace(/\t/g, ' ') // Convert tabs to spaces
    // Clean up common formatting artifacts
    .replace(/\s*[•·▪▫]\s*/g, ' • ') // Normalize bullet points
    .replace(/\s*-\s*/g, ' - ') // Normalize dashes
    .trim()
}