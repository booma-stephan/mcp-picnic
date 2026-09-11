import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../../../src/tools/registry.js"

const mocks = vi.hoisted(() => ({
  initializePicnicClient: vi.fn(),
  sendRequest: vi.fn(),
  verifyPicnic2FACode: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    sendRequest: mocks.sendRequest,
  }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
  verifyPicnic2FACode: mocks.verifyPicnic2FACode,
}))

function parseToolResult(result: ToolResult) {
  return JSON.parse(result.content[0].text ?? "")
}

function promoTile({
  productId,
  promotionId,
  name,
  label,
  price,
  originalPrice,
}: {
  productId: string
  promotionId: string
  name: string
  label: string
  price: number
  originalPrice?: number
}) {
  return {
    type: "PML",
    id: `selling-unit-${productId}-tile`,
    analytics: {
      contexts: [
        {
          data: { product_id: productId },
          schema: "iglu:tech.picnic.snowplow.analytics/product/jsonschema/1-0-0",
        },
        {
          data: {
            promotion_id: promotionId,
            promotion_label: label,
            price,
            ...(originalPrice !== undefined && {
              strikethrough_price: originalPrice,
              show_strikethrough_price: true,
            }),
          },
          schema: "iglu:tech.picnic.snowplow.analytics/promotion/jsonschema/1-1-0",
        },
      ],
    },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: productId,
        display_price: price,
        image_id: `image-${productId}`,
        max_count: 12,
        name,
        unit_quantity: "1 stuk",
      },
    },
  }
}

function regularTile() {
  return {
    type: "PML",
    id: "selling-unit-s999-tile",
    analytics: { contexts: [{ data: { product_id: "s999" } }] },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: "s999",
        display_price: 399,
        name: "Regular product",
        unit_quantity: "1 stuk",
      },
    },
  }
}

function bootstrapWithPromoTab(pageId: string) {
  return {
    landing_tab_id: "home",
    tabs: [
      {
        id: "home",
        tab_type: "PAGE",
        target: { type: "PICNIC_PAGE_REFERENCE", reference: "home_page_root" },
        icon_config: { icons: [{ type: "PRESET", preset: "STOREFRONT" }] },
      },
      {
        id: "promo",
        tab_type: "PAGE",
        title: "Alle acties",
        target: { type: "PICNIC_PAGE_REFERENCE", reference: pageId },
        icon_config: { icons: [{ type: "PRESET", preset: "PROMO" }] },
      },
    ],
  }
}

function promoPage(children: unknown[]) {
  return {
    layout: {
      body: {
        children,
      },
    },
  }
}

async function loadTools() {
  vi.resetModules()
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  await import("../../../src/tools/picnic-tools.js")
  return toolRegistry
}

describe("promotions tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("discovers the current acties page from bootstrap instead of a hardcoded id", async () => {
    const firstTile = promoTile({
      productId: "s100",
      promotionId: "promo-1",
      name: "Discount tomatoes",
      label: "nu €1.99",
      price: 199,
      originalPrice: 249,
    })
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") return bootstrapWithPromoTab("promo-page-weekly-deals")
      if (path === "/pages/promo-page-weekly-deals") {
        return promoPage([
          firstTile,
          regularTile(),
          [
            promoTile({
              productId: "s200",
              promotionId: "promo-2",
              name: "Bonus pasta",
              label: "1+1 gratis",
              price: 239,
            }),
            firstTile,
          ],
        ])
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenCalledWith("GET", "/bootstrap", null, true)
    expect(mocks.sendRequest).toHaveBeenCalledWith(
      "GET",
      "/pages/promo-page-weekly-deals",
      null,
      true,
    )
    expect(payload.source).toEqual({
      pageId: "promo-page-weekly-deals",
      endpoint: "/pages/promo-page-weekly-deals",
    })
    expect(payload.promotions).toEqual([
      {
        product_id: "s100",
        promotion_id: "promo-1",
        name: "Discount tomatoes",
        price: 199,
        unit: "1 stuk",
        promotion_label: "nu €1.99",
        original_price: 249,
        image_id: "image-s100",
        max_count: 12,
      },
      {
        product_id: "s200",
        promotion_id: "promo-2",
        name: "Bonus pasta",
        price: 239,
        unit: "1 stuk",
        promotion_label: "1+1 gratis",
        image_id: "image-s200",
        max_count: 12,
      },
    ])
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 25,
      returned: 2,
      total: 2,
      hasMore: false,
    })
  })

  it("follows an all-promos link when the bootstrap tab page has no deal tiles", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") return bootstrapWithPromoTab("promo-page-hub")
      if (path === "/pages/promo-page-hub") {
        return {
          body: {
            children: [
              {
                type: "TOUCHABLE",
                onPress: {
                  actionType: "OPEN",
                  target: "nl.picnic-supermarkt://store/page;id=promo-page-all-current-deals",
                },
              },
            ],
          },
        }
      }
      if (path === "/pages/promo-page-all-current-deals") {
        return promoPage([
          promoTile({
            productId: "s100",
            promotionId: "promo-1",
            name: "Discount tomatoes",
            label: "nu €1.99",
            price: 199,
          }),
        ])
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(payload.source.pageId).toBe("promo-page-all-current-deals")
    expect(payload.promotions).toEqual([
      expect.objectContaining({ product_id: "s100", promotion_id: "promo-1" }),
    ])
  })

  it("skips a stale leftover all-promos page id when the nested fetch 404s", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") return bootstrapWithPromoTab("promo-page-hub")
      if (path === "/pages/promo-page-hub") {
        return {
          body: {
            children: [
              {
                analytics: { leftover: "/pages/promo-page-all-promos-redirect" },
              },
              {
                type: "TOUCHABLE",
                onPress: {
                  actionType: "OPEN",
                  target: "nl.picnic-supermarkt://store/page;id=promo-page-weekly-deals",
                },
              },
            ],
          },
        }
      }
      if (path === "/pages/promo-page-all-promos-redirect") {
        throw new Error("page-template not found")
      }
      if (path === "/pages/promo-page-weekly-deals") {
        return promoPage([
          promoTile({
            productId: "s200",
            promotionId: "promo-2",
            name: "Bonus pasta",
            label: "1+1 gratis",
            price: 239,
          }),
        ])
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(payload.source.pageId).toBe("promo-page-weekly-deals")
    expect(payload.promotions[0].product_id).toBe("s200")
  })

  it("falls back to a promo page linked from the home page when bootstrap has no acties tab", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") {
        return {
          tabs: [
            {
              id: "home",
              tab_type: "PAGE",
              target: { type: "PICNIC_PAGE_REFERENCE", reference: "home_page_root" },
              icon_config: { icons: [{ type: "PRESET", preset: "STOREFRONT" }] },
            },
          ],
        }
      }
      if (path === "/pages/home_page_root") {
        return {
          body: {
            children: [
              {
                type: "TOUCHABLE",
                onPress: {
                  actionType: "OPEN",
                  target: "nl.picnic-supermarkt://store/page;id=promo-page-home-acties",
                },
              },
            ],
          },
        }
      }
      if (path === "/pages/promo-page-home-acties") {
        return promoPage([
          promoTile({
            productId: "s400",
            promotionId: "promo-4",
            name: "Deal milk",
            label: "nu €0.99",
            price: 99,
          }),
        ])
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(payload.source.pageId).toBe("promo-page-home-acties")
    expect(payload.promotions[0].product_id).toBe("s400")
  })

  it("fails clearly when bootstrap and home do not expose an acties page", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") {
        return {
          tabs: [
            {
              id: "home",
              tab_type: "PAGE",
              target: { type: "PICNIC_PAGE_REFERENCE", reference: "home_page_root" },
            },
          ],
        }
      }
      if (path === "/pages/home_page_root") return { body: { children: [] } }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    await expect(toolRegistry.executeTool("picnic_get_promotions", {})).rejects.toThrow(
      /could not discover/i,
    )
    expect(mocks.sendRequest).not.toHaveBeenCalledWith(
      "GET",
      "/pages/promo-page-all-promos-redirect",
      null,
      true,
    )
  })

  it("paginates promotions after deduplicating repeated tiles", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/bootstrap") return bootstrapWithPromoTab("promo-page-weekly-deals")
      if (path === "/pages/promo-page-weekly-deals") {
        return {
          layout: {
            body: [
              promoTile({
                productId: "s100",
                promotionId: "promo-1",
                name: "Discount tomatoes",
                label: "nu €1.99",
                price: 199,
              }),
              promoTile({
                productId: "s200",
                promotionId: "promo-2",
                name: "Bonus pasta",
                label: "1+1 gratis",
                price: 239,
              }),
              promoTile({
                productId: "s300",
                promotionId: "promo-3",
                name: "Deal soap",
                label: "2 voor €5",
                price: 279,
              }),
            ],
          },
        }
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {
      offset: 1,
      limit: 1,
    })
    const payload = parseToolResult(result)

    expect(payload.promotions).toEqual([
      expect.objectContaining({
        product_id: "s200",
        promotion_id: "promo-2",
      }),
    ])
    expect(payload.pagination).toEqual({
      offset: 1,
      limit: 1,
      returned: 1,
      total: 3,
      hasMore: true,
    })
  })
})
