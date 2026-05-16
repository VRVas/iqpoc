/**
 * Tenant resolution for the multi-tenant Foundry IQ Demo codebase.
 *
 * The same codebase ships two SWA deployments today: "qatar" (Qatar Airways
 * Contact Center Assistant) and "zava" (Zava Aviation AI Knowledge Management
 * System). The active tenant is selected at BUILD time via
 * `NEXT_PUBLIC_TENANT_ID` (so the value is inlined into the client bundle)
 * and re-confirmed at REQUEST time on the server via `TENANT_ID`.
 *
 * Adding a new tenant: drop a new `config/tenants/<id>.json` next to the two
 * existing files, add an import below, and set `NEXT_PUBLIC_TENANT_ID=<id>`
 * at build time.
 */
import qatarTenant from '@/config/tenants/qatar.json'
import zavaTenant from '@/config/tenants/zava.json'

export type TenantId = 'qatar' | 'zava'

export interface TenantConfig {
  id: TenantId
  displayName: string
  headerTitle: string
  metadataTitle: string
  metadataDescription: string
  footerCaption: string

  logoLight: string
  logoDark: string
  iconPath: string
  logoAltText: string

  fontFamily: string
  fontGoogleHref: string | null

  kbPrefix: string
  agentPrefix: string
  /**
   * Names that start with any of these prefixes belong to a sibling tenant
   * and must be hidden from the current tenant. Lets a tenant with an empty
   * `kbPrefix` (= match-all) still exclude resources owned by other tenants.
   */
  excludeKbPrefixes?: string[]
  excludeAgentPrefixes?: string[]

  /**
   * Prefix enforced for knowledge sources owned by this tenant. If omitted,
   * falls back to `kbPrefix`. Used by the shared-resource isolation helpers.
   */
  knowledgeSourcePrefix?: string
  /**
   * Prefix enforced for shared-storage blob containers owned by this tenant.
   * If omitted, falls back to `kbPrefix`.
   */
  containerPrefix?: string
  /**
   * Case-insensitive substrings that, when present anywhere in a name,
   * disqualify it from belonging to this tenant. Applies to knowledge sources
   * AND blob containers — both of which live in single Azure resources that
   * are shared across every tenant deployment. Stronger than a prefix exclude
   * (catches names like `mid-zava-name`, not just `zava-name`).
   */
  excludeNameSubstrings?: string[]

  timeZone: string
  timeZoneLabel: string

  defaultWebDomains: string[]
  topLoaderColor: string

  generalAccessGate: {
    enabled: boolean
    footerCaption?: string
  }

  /** Client-side admin-mode unlock password. NOTE: this ships in the bundle and is a UX gate only, not a security boundary. */
  adminPassword: string

  theme?: Record<string, string | undefined>

  /**
   * Optional landing page content. When present, the `/` route's hero is
   * driven by this block. Icons for capabilities are looked up by `iconId`
   * inside `components/landing-page.tsx` (so the JSON stays icon-agnostic).
   */
  landing?: {
    title: string
    description: string
    tagline?: string
    ctaLabel?: string
    ctaTarget?: string
    capabilities: Array<{
      iconId: string
      title: string
      desc: string
    }>
  }
}

const TENANTS: Record<TenantId, TenantConfig> = {
  qatar: qatarTenant as TenantConfig,
  zava: zavaTenant as TenantConfig,
}

function normalizeTenantId(raw: string | undefined | null): TenantId {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'zava') return 'zava'
  return 'qatar'
}

/**
 * Build-time tenant id, baked into the client bundle. Use this everywhere
 * except inside API route handlers where the request-time env var is preferred.
 */
export const BUILD_TENANT_ID: TenantId = normalizeTenantId(
  process.env.NEXT_PUBLIC_TENANT_ID
)

/**
 * Build-time tenant config object. Safe to import in client components.
 */
export const tenant: TenantConfig = TENANTS[BUILD_TENANT_ID]

/**
 * Resolve a tenant from an arbitrary id (or `undefined` → BUILD_TENANT_ID).
 * Use inside server-only code where you may want to honor `process.env.TENANT_ID`.
 */
export function getTenant(id?: string | null): TenantConfig {
  if (!id) return tenant
  return TENANTS[normalizeTenantId(id)]
}

/**
 * Server-only: returns the tenant according to the runtime env var, falling
 * back to the build-time tenant if unset. Both should match in a correctly
 * configured deployment; use this in API routes to defend against
 * misconfigured app settings.
 */
export function getServerTenant(): TenantConfig {
  return getTenant(process.env.TENANT_ID ?? process.env.NEXT_PUBLIC_TENANT_ID)
}

/**
 * True when `name` belongs to the given tenant according to its kb prefix /
 * exclude-prefix rules. Use to gate list filtering and single-resource lookups.
 */
export function isOwnedKb(name: string | undefined | null, t: TenantConfig = tenant): boolean {
  if (!name) return false
  if (t.kbPrefix && !name.startsWith(t.kbPrefix)) return false
  for (const p of t.excludeKbPrefixes ?? []) {
    if (p && name.startsWith(p)) return false
  }
  return true
}

export function isOwnedAgent(name: string | undefined | null, t: TenantConfig = tenant): boolean {
  if (!name) return false
  if (t.agentPrefix && !name.startsWith(t.agentPrefix)) return false
  for (const p of t.excludeAgentPrefixes ?? []) {
    if (p && name.startsWith(p)) return false
  }
  return true
}

function resolveKnowledgeSourcePrefix(t: TenantConfig): string {
  return t.knowledgeSourcePrefix ?? t.kbPrefix ?? ''
}

function resolveContainerPrefix(t: TenantConfig): string {
  return t.containerPrefix ?? t.kbPrefix ?? ''
}

/** Returns the matching substring (verbatim from config) if `name` is banned, else null. */
function nameContainsExcludedSubstring(name: string, t: TenantConfig): string | null {
  const lc = name.toLowerCase()
  for (const sub of t.excludeNameSubstrings ?? []) {
    if (sub && lc.includes(sub.toLowerCase())) return sub
  }
  return null
}

/**
 * True when a knowledge source `name` belongs to `t`. Knowledge sources live
 * in a single Azure AI Search instance shared by every tenant, so this is the
 * sole gate preventing cross-tenant visibility through our API.
 */
export function isOwnedKnowledgeSource(
  name: string | undefined | null,
  t: TenantConfig = tenant
): boolean {
  if (!name) return false
  const prefix = resolveKnowledgeSourcePrefix(t)
  if (prefix && !name.startsWith(prefix)) return false
  if (nameContainsExcludedSubstring(name, t)) return false
  return true
}

/**
 * True when a shared-storage blob container `name` belongs to `t`. Same
 * single-resource sharing story as `isOwnedKnowledgeSource`.
 */
export function isOwnedContainer(
  name: string | undefined | null,
  t: TenantConfig = tenant
): boolean {
  if (!name) return false
  const prefix = resolveContainerPrefix(t)
  if (prefix && !name.startsWith(prefix)) return false
  if (nameContainsExcludedSubstring(name, t)) return false
  return true
}

/**
 * Validate that a name being CREATED is acceptable for the current tenant.
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` with a clean
 * human-readable message so API routes can render a 400 with a tenant-specific
 * hint rather than letting Azure reject the call with a more confusing
 * downstream error.
 *
 * Returns a single object shape (rather than a discriminated union) so it
 * works under `strict: false` where TS narrowing on `!result.ok` is weaker.
 */
export function validateOwnedName(
  name: string | undefined | null,
  kind: 'knowledgeSource' | 'container',
  t: TenantConfig = tenant
): { ok: boolean; reason?: string } {
  if (!name) return { ok: false, reason: 'Name is required.' }
  const prefix =
    kind === 'knowledgeSource' ? resolveKnowledgeSourcePrefix(t) : resolveContainerPrefix(t)
  if (prefix && !name.startsWith(prefix)) {
    return { ok: false, reason: `Name must start with "${prefix}".` }
  }
  const hit = nameContainsExcludedSubstring(name, t)
  if (hit) {
    return { ok: false, reason: `"${hit}" is not permitted in the name.` }
  }
  return { ok: true }
}
