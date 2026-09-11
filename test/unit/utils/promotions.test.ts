import { describe, expect, it } from "vitest"
import { pickBestPromoPageId, resolvePromotionsPageId } from "../../../src/utils/promotions.js"

function bootstrap(tabs: unknown[]) {
  return {
    landing_tab_id: "home",
    tabs,
  }
}

function pageTab({
  id,
  title,
  reference,
  deeplink,
  preset,
}: {
  id: string
  title?: string
  reference?: string
  deeplink?: string
  preset?: string
}) {
  return {
    id,
    tab_type: "PAGE",
    title,
    icon_config: {
      icons: preset ? [{ type: "PRESET", preset }] : [],
    },
    target: reference
      ? { type: "PICNIC_PAGE_REFERENCE", reference }
      : deeplink
        ? { type: "DEEPLINK", deeplink }
        : undefined,
  }
}

describe("resolvePromotionsPageId", () => {
  it("prefers the bootstrap tab with a PROMO icon over home/search/cart", () => {
    const pageId = resolvePromotionsPageId(
      bootstrap([
        pageTab({ id: "home", reference: "home_page_root", preset: "STOREFRONT" }),
        pageTab({ id: "search", title: "Search", preset: "SEARCH" }),
        pageTab({
          id: "deals",
          title: "Alle acties",
          reference: "promo-page-weekly-deals",
          preset: "PROMO",
        }),
        {
          id: "cart",
          tab_type: "CART",
          icon_config: { icons: [{ type: "PRESET", preset: "TROLLEY" }] },
        },
      ]),
    )

    expect(pageId).toBe("promo-page-weekly-deals")
  })

  it("finds a DE Aktionen tab by title when the icon is not a promo preset", () => {
    const pageId = resolvePromotionsPageId(
      bootstrap([
        pageTab({ id: "home", reference: "home_page_root", preset: "STOREFRONT" }),
        pageTab({
          id: "offers",
          title: "Aktionen",
          reference: "promo-page-de-aktionen",
          preset: "PERCENT",
        }),
      ]),
    )

    expect(pageId).toBe("promo-page-de-aktionen")
  })

  it("extracts a page id from a picnic store deeplink target", () => {
    const pageId = resolvePromotionsPageId(
      bootstrap([
        pageTab({
          id: "promo",
          preset: "ACTIVE_PROMO",
          deeplink: "de.picnic-supermarkt://store/page;id=promo-page-hub-2026",
        }),
      ]),
    )

    expect(pageId).toBe("promo-page-hub-2026")
  })

  it("returns null when bootstrap has no promotions page", () => {
    expect(
      resolvePromotionsPageId(
        bootstrap([
          pageTab({ id: "home", reference: "home_page_root", preset: "STOREFRONT" }),
          { id: "cart", tab_type: "CART" },
        ]),
      ),
    ).toBeNull()
  })

  it("uses a PROMO tab's page reference even when the id is not named promo", () => {
    expect(
      resolvePromotionsPageId(
        bootstrap([
          pageTab({ id: "home", reference: "home_page_root", preset: "STOREFRONT" }),
          pageTab({
            id: "deals",
            title: "Alle acties",
            reference: "week-voordeel-2026",
            preset: "PROMO",
          }),
        ]),
      ),
    ).toBe("week-voordeel-2026")
  })
})

describe("pickBestPromoPageId", () => {
  it("prefers an all-promos page over individual campaign pages", () => {
    expect(
      pickBestPromoPageId([
        "promo-page-europarade",
        "promo-page-all-current-deals",
        "home_page_root",
      ]),
    ).toBe("promo-page-all-current-deals")
  })

  it("does not treat fall or ballen as an all-promos page", () => {
    expect(
      pickBestPromoPageId([
        "promo-page-fall-specials",
        "promo-page-ballen",
        "promo-page-all-current-deals",
      ]),
    ).toBe("promo-page-all-current-deals")
  })
})
