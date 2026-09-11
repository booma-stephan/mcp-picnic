type UnknownRecord = Record<string, unknown>

const PROMO_ICON_PRESETS = new Set(["PROMO", "ACTIVE_PROMO"])
const PROMO_TEXT_RE = /promo|actie|aktion|angebot|aanbied|offer|deal/i
const ALL_PROMOS_PAGE_RE = /(^|[-_])all([-_]|$)/i
const NAVIGATION_KEYS = new Set(["reference", "target", "deeplink", "onPress"])
const SKIP_TAB_TYPES = new Set(["CART", "SEARCH", "LEGACY_SEARCH"])
const GENERIC_LANDING_PAGES = new Set([
  "home_page_root",
  "purchases-page-root",
  "meals-page-root",
  "slot-selector-root",
  "category-tree-root",
  "parcels-overview-page-root",
  "empty-search-page-root",
  "cookbook-page-content",
  "product-details-page-root",
])
const PAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const PAGE_REF_IN_STRING_RE = /(?:page;id=|\/pages\/)([A-Za-z0-9][A-Za-z0-9_-]*)/gi

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isValidPageId(id: string): boolean {
  return PAGE_ID_RE.test(id)
}

function isGenericLandingPage(id: string): boolean {
  return GENERIC_LANDING_PAGES.has(id)
}

function isPromoPageId(id: string): boolean {
  return PROMO_TEXT_RE.test(id)
}

function looksLikeFusionPageId(id: string): boolean {
  return isValidPageId(id) && (id.includes("-") || id.includes("_")) && id.length >= 8
}

function collectPageIds(node: unknown, navigableOnly = false): string[] {
  const ids = new Set<string>()

  const visit = (value: unknown, key?: string, inNavigation = false): void => {
    const navigable = inNavigation || (key !== undefined && NAVIGATION_KEYS.has(key))

    if (typeof value === "string") {
      if (navigableOnly && !navigable) return
      for (const match of value.matchAll(PAGE_REF_IN_STRING_RE)) {
        ids.add(match[1])
      }
      const bare = value.split("?")[0]
      if (key === "reference" && isValidPageId(bare)) {
        ids.add(bare)
      } else if (looksLikeFusionPageId(bare) && isPromoPageId(bare)) {
        ids.add(bare)
      }
      return
    }

    if (Array.isArray(value)) {
      for (const child of value) visit(child, undefined, navigable)
      return
    }

    if (!isRecord(value)) return
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey, navigable)
  }

  visit(node)
  return [...ids]
}

function pageIdScore(id: string): number {
  if (!isValidPageId(id) || isGenericLandingPage(id)) return -1

  let score = 0
  if (ALL_PROMOS_PAGE_RE.test(id)) score += 50
  if (/^promo[-_]?page/i.test(id)) score += 30
  if (isPromoPageId(id)) score += 20
  return score
}

/**
 * Prefer an "all promotions" Fusion page over individual campaign pages.
 */
export function rankPromoPageIds(ids: string[]): string[] {
  return [...new Set(ids)]
    .map((id) => ({ id, score: pageIdScore(id) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id)
}

export function pickBestPromoPageId(ids: string[]): string | null {
  return rankPromoPageIds(ids)[0] ?? null
}

/**
 * Promo-looking Fusion page ids embedded in a page or bootstrap payload.
 */
export function extractPromoPageIds(node: unknown, navigableOnly = false): string[] {
  return collectPageIds(node, navigableOnly).filter((id) => pageIdScore(id) > 0)
}

function iconPresets(tab: UnknownRecord): string[] {
  const iconConfig = isRecord(tab.icon_config) ? tab.icon_config : null
  if (!iconConfig) return []

  const presets: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.preset === "string") presets.push(value.preset)
    for (const child of Object.values(value)) visit(child)
  }

  visit(iconConfig)
  return presets
}

function tabTextMatchesPromo(tab: UnknownRecord): boolean {
  const texts: unknown[] = [tab.id, tab.analytics_id, tab.title, tab.header]
  if (isRecord(tab.accessibility)) texts.push(tab.accessibility.label)
  return texts.some((text) => typeof text === "string" && PROMO_TEXT_RE.test(text))
}

function tabNavigationPageId(tab: UnknownRecord): string | null {
  const target = isRecord(tab.target) ? tab.target : null
  if (!target) return null

  if (typeof target.reference === "string") {
    const id = target.reference.split("?")[0]
    if (isValidPageId(id) && !isGenericLandingPage(id)) return id
  }

  if (typeof target.deeplink === "string") {
    for (const match of target.deeplink.matchAll(PAGE_REF_IN_STRING_RE)) {
      if (isValidPageId(match[1]) && !isGenericLandingPage(match[1])) return match[1]
    }
  }

  return null
}

function extractPageIdFromTab(tab: UnknownRecord): string | null {
  const trusted = tabNavigationPageId(tab)
  if (trusted) return trusted

  const ids = collectPageIds(tab).filter((id) => !isGenericLandingPage(id))
  const promoIds = ids.filter((id) => isPromoPageId(id))
  return pickBestPromoPageId(promoIds.length > 0 ? promoIds : ids)
}

function scoreTab(tab: UnknownRecord): number {
  const tabType = typeof tab.tab_type === "string" ? tab.tab_type : ""
  if (SKIP_TAB_TYPES.has(tabType)) return 0

  let score = 0
  if (iconPresets(tab).some((preset) => PROMO_ICON_PRESETS.has(preset))) score += 100
  if (tabTextMatchesPromo(tab)) score += 50

  const pageId = extractPageIdFromTab(tab)
  if (pageId && isPromoPageId(pageId)) score += 30

  return score
}

/**
 * Resolve the current weekly-deals Fusion page id from app bootstrap tabs.
 * Picnic rotates this id; it must not be hardcoded.
 */
export function resolvePromotionsPageId(bootstrap: unknown): string | null {
  if (!isRecord(bootstrap) || !Array.isArray(bootstrap.tabs)) {
    return pickBestPromoPageId(extractPromoPageIds(bootstrap))
  }

  let bestTab: UnknownRecord | null = null
  let bestScore = 0

  for (const tab of bootstrap.tabs) {
    if (!isRecord(tab)) continue
    const score = scoreTab(tab)
    if (score > bestScore) {
      bestTab = tab
      bestScore = score
    }
  }

  if (bestTab && bestScore > 0) {
    const pageId = extractPageIdFromTab(bestTab)
    if (pageId && !isGenericLandingPage(pageId)) return pageId
  }

  return pickBestPromoPageId(extractPromoPageIds(bootstrap))
}
