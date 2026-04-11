'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { KnowledgeBaseReference, KnowledgeBaseActivityRecord } from '@/types/knowledge-retrieval'
import { CitationHoverCard, getDocumentName } from '@/components/citation-hover-card'
import { SourceKindIcon } from '@/components/source-kind-icon'
import { cn } from '@/lib/utils'

/**
 * MarkdownMessage
 *
 * Renders assistant message text with full markdown formatting (GFM)
 * and interactive citation pills that replace [ref_id:N] markers.
 *
 * Supports:
 * - Standard markdown: headers, bold, italic, lists, tables, code blocks, blockquotes
 * - GitHub Flavored Markdown: strikethrough, task lists, autolinks, tables
 * - Inline citation pills with hover preview cards (Perplexity-style)
 * - Code Interpreter generated images (via markdown ![alt](url) syntax)
 * - File download links from Code Interpreter
 * - HTML file iframe preview modal
 */

interface MarkdownMessageProps {
  /** The raw message text (may contain markdown + [ref_id:N] markers) */
  content: string
  /** Knowledge base references for citation pills */
  references?: KnowledgeBaseReference[]
  /** Activity records for citation context */
  activity?: KnowledgeBaseActivityRecord[]
  /** Unique message ID for scrolling to citations */
  messageId: string
  /** Callback when user activates a citation */
  onActivateCitation?: () => void
  /** Generated files from Code Interpreter (for text preprocessing) */
  generatedFiles?: Array<{
    containerId: string
    fileId: string
    filename: string
    startIndex?: number
    endIndex?: number
  }>
  /** Additional className for the wrapper */
  className?: string
}

/**
 * Build a proxy URL for a Code Interpreter generated file.
 */
function buildFileProxyUrl(containerId: string, fileId: string, filename: string): string {
  return `/api/foundry/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}?filename=${encodeURIComponent(filename)}`
}

/**
 * Pre-process message text for markdown rendering:
 * 1. Replace container_file_citation annotation ranges with proper proxy URLs
 * 2. Replace any remaining sandbox:/mnt/data/ URLs with proxy URLs
 * 3. Convert [ref_id:N] citation markers to markdown links (rendered as pills)
 */
function preprocessContent(
  text: string,
  generatedFiles: MarkdownMessageProps['generatedFiles'] = []
): string {
  let processed = text

  // Build a lookup from filename → proxy URL for sandbox URL replacement
  const filenameToUrl: Record<string, string> = {}
  for (const file of generatedFiles) {
    const url = buildFileProxyUrl(file.containerId, file.fileId, file.filename)
    filenameToUrl[file.filename] = url
  }

  // Replace file citation annotation ranges (process from end to preserve indices)
  const sortedFiles = [...generatedFiles]
    .filter(f => f.startIndex !== undefined && f.endIndex !== undefined)
    .sort((a, b) => (b.startIndex || 0) - (a.startIndex || 0))

  for (const file of sortedFiles) {
    const start = file.startIndex!
    const end = file.endIndex!
    const url = buildFileProxyUrl(file.containerId, file.fileId, file.filename)
    const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(file.filename)

    if (start === 0 && end === 0) {
      // Zero-range annotation = inline image display. Prepend the image.
      if (isImage) {
        processed = `![${file.filename}](${url})\n\n` + processed
      }
      continue
    }

    // The annotation range typically covers a "sandbox:/mnt/data/filename" URL
    // inside an existing markdown link like [text](sandbox:/mnt/data/file).
    // Just replace the range with the proxy URL — preserve surrounding markdown.
    const before = processed.slice(0, start)
    const after = processed.slice(end)

    // Check if this range sits inside a markdown link's URL portion: ](range)
    // If so, just substitute the URL. Otherwise, insert a full markdown link.
    const endsWithOpenParen = /\]\($/.test(before)
    const startsWithCloseParen = /^\)/.test(after)

    if (endsWithOpenParen && startsWithCloseParen) {
      // Inside markdown link parentheses — just replace the URL
      processed = before + url + after
    } else if (isImage) {
      processed = before + `\n\n![${file.filename}](${url})\n\n` + after
    } else {
      processed = before + `[📥 ${file.filename}](${url})` + after
    }
  }

  // Replace any remaining sandbox:/mnt/data/ URLs with proxy URLs
  processed = processed.replace(
    /sandbox:\/mnt\/data\/([^\s)]+)/g,
    (_match, filename) => {
      const decoded = decodeURIComponent(filename)
      if (filenameToUrl[decoded]) {
        return filenameToUrl[decoded]
      }
      // Fallback: use the first generated file that partially matches the filename
      const candidate = generatedFiles.find(f =>
        f.filename.includes(decoded) || decoded.includes(f.filename.replace(/^cfile_[a-f0-9]+\./, ''))
      )
      if (candidate) {
        return buildFileProxyUrl(candidate.containerId, candidate.fileId, candidate.filename)
      }
      return _match // leave as-is if no match
    }
  )

  // Convert citation markers [ref_id:N] to markdown links
  processed = processed.replace(/\[ref_id:(\d+)\]/g, '[📎$1](cite:$1)')

  // Auto-convert plain image URLs to markdown image syntax
  // Matches URLs ending in common image extensions that aren't already in markdown ![]()/[]() syntax
  processed = processed.replace(
    /(?<!\[.*?\]\()(?<!!)\b(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|svg|webp)(?:\?[^\s"'<>]*)?)/gi,
    (match, url) => {
      // Don't convert if it's already inside a markdown link or image
      return `\n\n![Image](${url})\n\n`
    }
  )

  return processed
}

/**
 * IframePreviewModal - Shows HTML content in an iframe modal with expand button
 */
const IframePreviewModal: React.FC<{
  src: string
  filename: string
  onClose: () => void
}> = ({ src, filename, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-bg-card border border-stroke-divider rounded-xl shadow-2xl w-[90vw] max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stroke-divider bg-bg-subtle">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-fg-default truncate">{filename}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent bg-bg-card border border-stroke-divider rounded-lg hover:bg-bg-hover transition-colors"
            >
              ↗ Open in new tab
            </a>
            <a
              href={src}
              download={filename}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-fg-default bg-bg-card border border-stroke-divider rounded-lg hover:bg-bg-hover transition-colors"
            >
              📥 Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-fg-muted hover:text-fg-default hover:bg-bg-hover rounded-lg transition-colors"
              aria-label="Close preview"
            >
              ✕
            </button>
          </div>
        </div>
        {/* Iframe */}
        <div className="flex-1 bg-white">
          <iframe
            src={src}
            title={filename}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  references = [],
  activity = [],
  messageId,
  onActivateCitation,
  generatedFiles = [],
  className,
}) => {
  const [iframePreview, setIframePreview] = React.useState<{
    src: string
    filename: string
  } | null>(null)

  const preprocessedContent = React.useMemo(
    () => preprocessContent(content, generatedFiles),
    [content, generatedFiles]
  )

  return (
    <>
      <div className={cn(
        "prose prose-sm max-w-none overflow-x-auto",
        // Headings
        "prose-headings:text-fg-default prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2",
        // Paragraphs
        "prose-p:text-fg-default prose-p:leading-relaxed prose-p:my-2",
        // Strong / emphasis
        "prose-strong:text-fg-default prose-strong:font-semibold",
        // Lists
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        // Inline code
        "prose-code:text-accent prose-code:bg-bg-subtle prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        // Code blocks
        "prose-pre:bg-bg-secondary prose-pre:border prose-pre:border-stroke-divider prose-pre:rounded-lg prose-pre:my-3",
        // Links
        "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
        // Blockquotes
        "prose-blockquote:border-l-accent prose-blockquote:bg-bg-subtle prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:my-3",
        // Horizontal rules
        "prose-hr:border-stroke-divider",
        // Images
        "prose-img:rounded-lg prose-img:shadow-md prose-img:my-4 prose-img:max-w-full",
        className
      )}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Tables: explicit styled rendering for reliable borders
            table: ({ children, ...props }: any) => (
              <div className="my-3 overflow-x-auto rounded-lg border border-[hsl(var(--stroke-divider))]">
                <table
                  className="w-full text-sm border-collapse"
                  {...props}
                >
                  {children}
                </table>
              </div>
            ),
            thead: ({ children, ...props }: any) => (
              <thead className="bg-[hsl(var(--bg-subtle))]" {...props}>{children}</thead>
            ),
            th: ({ children, ...props }: any) => (
              <th
                className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--fg-default))] border-b border-[hsl(var(--stroke-divider))]"
                {...props}
              >
                {children}
              </th>
            ),
            td: ({ children, ...props }: any) => (
              <td
                className="px-4 py-2 text-sm text-[hsl(var(--fg-default))] border-b border-[hsl(var(--stroke-divider))]"
                {...props}
              >
                {children}
              </td>
            ),
            tr: ({ children, ...props }: any) => (
              <tr className="hover:bg-[hsl(var(--bg-hover))] transition-colors" {...props}>
                {children}
              </tr>
            ),
            // Citation links: render as interactive pills
            a: ({ href, children, ...props }: any) => {
              if (href?.startsWith('cite:')) {
                const refIdx = parseInt(href.replace('cite:', ''), 10)
                const ref = references[refIdx]
                if (ref) {
                  const activityEntry = activity.find(
                    (a: KnowledgeBaseActivityRecord) => a.id === ref.activitySource
                  )
                  const documentName = getDocumentName(ref)
                  return (
                    <CitationHoverCard
                      reference={ref}
                      activity={activityEntry}
                      side="top"
                      align="center"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onActivateCitation?.()
                          const el = document.getElementById(`ref-${messageId}-${refIdx}`)
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            el.classList.add('ring-2', 'ring-accent', 'ring-offset-1')
                            setTimeout(() => el.classList.remove('ring-2', 'ring-accent', 'ring-offset-1'), 1400)
                          }
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 align-baseline",
                          "ml-1 px-2 py-0.5 rounded",
                          "bg-bg-subtle hover:bg-bg-hover",
                          "border border-stroke-divider hover:border-accent/40",
                          "text-[11px] text-fg-muted hover:text-fg-default",
                          "transition-all duration-150 no-underline",
                          "focus:outline-none focus:ring-1 focus:ring-accent",
                          "cursor-pointer"
                        )}
                      >
                        <SourceKindIcon kind={ref.type} size={12} variant="plain" />
                        <span className="truncate max-w-[180px]">{documentName}</span>
                      </button>
                    </CitationHoverCard>
                  )
                }
                return <span className="text-[11px] text-fg-subtle">[{refIdx + 1}]</span>
              }
              // File download/preview links from Code Interpreter
              if (href?.startsWith('/api/foundry/containers/')) {
                const isHtml = /\.html?(\?|$)/i.test(href)
                if (isHtml) {
                  // HTML files: open in iframe preview modal
                  const filenameMatch = href.match(/filename=([^&]+)/)
                  const fname = filenameMatch ? decodeURIComponent(filenameMatch[1]) : 'preview.html'
                  return (
                    <button
                      type="button"
                      onClick={() => setIframePreview({ src: href, filename: fname })}
                      className="inline-flex items-center gap-1.5 text-accent hover:underline text-sm cursor-pointer bg-transparent border-0 p-0"
                    >
                      {children}
                    </button>
                  )
                }
                return (
                  <a
                    href={href}
                    download
                    className="inline-flex items-center gap-1.5 text-accent hover:underline text-sm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                )
              }
              // Regular external links
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                  {...props}
                >
                  {children}
                </a>
              )
            },
            // Images: handle Code Interpreter generated images
            img: ({ src, alt, ...props }: any) => (
              <img
                src={src}
                alt={alt || 'Generated image'}
                className="rounded-lg shadow-md max-w-full my-4"
                loading="lazy"
                {...props}
              />
            ),
          }}
        >
          {preprocessedContent}
        </ReactMarkdown>
      </div>

      {/* HTML iframe preview modal */}
      {iframePreview && (
        <IframePreviewModal
          src={iframePreview.src}
          filename={iframePreview.filename}
          onClose={() => setIframePreview(null)}
        />
      )}
    </>
  )
}
