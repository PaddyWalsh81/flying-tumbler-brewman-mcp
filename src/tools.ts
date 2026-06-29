import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callBrewman, handleApiError, toolResult } from "./client.js";

/**
 * Tool registration for the Brewman Web API.
 *
 * Design: a focused set of high-value tools for the common Flying Tumbler tasks
 * (orders, outlets, stock, reference/config reads) plus a generic `brewman_request`
 * escape hatch that can reach ANY of the ~90 Brewman methods. All Brewman calls are
 * POST; the tenant id is injected by the client from env.
 *
 * IMPORTANT: write tools (create/update/cancel) change Patrick's LIVE data exactly
 * like the web UI. The operator must confirm with Patrick before invoking them
 * (the brewman-operator skill enforces confirm-before-commit).
 */

// Map of friendly reference dataset names -> Brewman "GetAll" method paths.
const REFERENCE_ENDPOINTS: Record<string, string> = {
  product_brands: "/webapi/ProductBrand/v1/GetAllProductBrands",
  stock_locations: "/webapi/StockLocation/v1/GetAllStockLocations",
  package_types: "/webapi/PackageType/v1/GetAllPackageTypes",
  price_lists: "/webapi/PriceList/v1/GetAllPriceLists",
  pricing_categories: "/webapi/PricingCategory/v1/GetAllPricingCategories",
  sales_areas: "/webapi/SalesArea/v1/GetAllSalesAreas",
  sales_codes: "/webapi/SalesCode/v1/GetAllSalesCodes",
  credit_terms: "/webapi/CreditTerm/v1/GetAllCreditTerms",
  vat_codes: "/webapi/VatCode/v1/GetAllVatCodes",
  gl_codes: "/webapi/GlCode/v1/GetAllGlCodes",
  stock_groups: "/webapi/StockGroup/v1/GetAllStockGroups",
  units_of_measure: "/webapi/UnitOfMeasure/v1/GetAllUnitsOfMeasure",
  outlet_types: "/webapi/OutletType/v1/GetAllOutletTypes",
  outlet_ratings: "/webapi/OutletRating/v1/GetAllOutletRatings",
  outlet_sub_types: "/webapi/OutletSubType/v1/GetAllOutletSubTypes",
  couriers: "/webapi/Courier/v1/GetAllCouriers",
  delivery_areas: "/webapi/DeliveryArea/v1/GetAllDeliveryAreas",
  collection_times: "/webapi/CollectionTime/v1/GetAllCollectionTimes",
  outlet_groups: "/webapi/Group/v1/GetAllGroups",
  suppliers_manufacturers: "/webapi/SupplierManufacturer/v1/GetAllSupplierManufacturers",
  outlets: "/webapi/Outlet/v1/GetAllOutlets",
};

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const WRITE_DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

async function run(methodPath: string, body: Record<string, unknown>) {
  try {
    const data = await callBrewman(methodPath, body);
    return toolResult(data);
  } catch (err) {
    return { content: [{ type: "text" as const, text: handleApiError(err) }], isError: true };
  }
}

export function registerTools(server: McpServer): void {
  // --- Session / health -----------------------------------------------------
  server.registerTool(
    "brewman_get_user_context",
    {
      title: "Get current user & tenant",
      description:
        "Verify the API token works and return the authenticated user plus the tenant (group) id. Call this first to confirm connectivity and to discover the tenant id. Takes no parameters.",
      inputSchema: {},
      annotations: READ,
    },
    async () => run("/webapi/User/v1/GetCurrentUserContext", {})
  );

  // --- Reference / config reads (one tool, many datasets) -------------------
  server.registerTool(
    "brewman_get_reference",
    {
      title: "Get Brewman reference/config data",
      description:
        "Read a full reference/config list from Brewman. Use for: product_brands, stock_locations (incl. bonded flags), package_types (incl. duty categories), price_lists, pricing_categories, sales_areas, sales_codes, credit_terms, vat_codes, gl_codes, stock_groups, units_of_measure, outlet_types, outlet_ratings, outlet_sub_types, couriers, delivery_areas, collection_times, outlet_groups, suppliers_manufacturers, outlets. Returns the raw Brewman objects for that dataset.",
      inputSchema: {
        dataset: z
          .enum(Object.keys(REFERENCE_ENDPOINTS) as [string, ...string[]])
          .describe("Which reference dataset to fetch"),
      },
      annotations: READ,
    },
    async ({ dataset }) => run(REFERENCE_ENDPOINTS[dataset], {})
  );

  // --- Stock reads ----------------------------------------------------------
  server.registerTool(
    "brewman_get_stock_levels",
    {
      title: "Get current stock levels",
      description:
        "Get the current in-stock quantity (sum of all batches) for the given stock item ids. Pass the item ids you got from products/materials. Returns current stock level per item.",
      inputSchema: {
        itemIds: z
          .array(z.string())
          .min(1)
          .describe("Stock item ids (product or material guids) to get levels for"),
      },
      annotations: READ,
    },
    async ({ itemIds }) =>
      run("/webapi/Stock/v1/GetStockItemsQuantityCurrentlyInStock", { itemIds })
  );

  server.registerTool(
    "brewman_get_stock_incoming_outgoing",
    {
      title: "Get incoming/outgoing stock",
      description:
        "Get known totals of incoming and outgoing stock for the given item ids and (optionally) stock location ids. Useful for availability planning.",
      inputSchema: {
        itemIds: z.array(z.string()).min(1).describe("Stock item ids"),
        stockLocationIds: z
          .array(z.string())
          .optional()
          .describe("Optional stock location ids to scope to"),
      },
      annotations: READ,
    },
    async ({ itemIds, stockLocationIds }) =>
      run("/webapi/Stock/v1/GetStockIncomingOutgoing", {
        itemIds,
        ...(stockLocationIds ? { stockLocationIds } : {}),
      })
  );

  // --- Pricing --------------------------------------------------------------
  server.registerTool(
    "brewman_get_price_list_lines",
    {
      title: "Get price list lines",
      description:
        "Get the price of all products on a given price list. Pass the priceListId (from brewman_get_reference dataset=price_lists).",
      inputSchema: {
        priceListId: z.string().describe("The price list id"),
      },
      annotations: READ,
    },
    async ({ priceListId }) =>
      run("/webapi/PriceList/v1/GetLinesForPriceList", { priceListId })
  );

  server.registerTool(
    "brewman_evaluate_prices",
    {
      title: "Evaluate prices for items",
      description:
        "Evaluate the prices of given items on a given price list (applies list price + discounts the way the UI would). Provide the priceListId and a list of items (each with an item id and quantity). Use this to quote a line before creating an order.",
      inputSchema: {
        priceListId: z.string().describe("Price list id to evaluate against"),
        items: z
          .array(z.record(z.unknown()))
          .describe(
            "Items to price; each item is an object with at least the item id and quantity per the Brewman EvaluatePrices schema (see Swagger)."
          ),
      },
      annotations: READ,
    },
    async ({ priceListId, items }) =>
      run("/webapi/Price/v1/EvaluatePrices", { priceListId, items })
  );

  // --- Outlets --------------------------------------------------------------
  server.registerTool(
    "brewman_get_outlets_by_filter",
    {
      title: "Get / search outlets",
      description:
        "Get outlets. Pass `outletIds` for specific ones, or omit to use brewman_get_reference dataset=outlets for all. Returns outlet records (codes, pricing, finance, distribution).",
      inputSchema: {
        outletIds: z
          .array(z.string())
          .optional()
          .describe("Specific outlet ids; omit to fetch all via GetAllOutlets"),
      },
      annotations: READ,
    },
    async ({ outletIds }) =>
      outletIds && outletIds.length
        ? run("/webapi/Outlet/v1/GetOutlets", { outletIds })
        : run("/webapi/Outlet/v1/GetAllOutlets", {})
  );

  server.registerTool(
    "brewman_create_outlet",
    {
      title: "Create an outlet (WRITE)",
      description:
        "Create a new outlet (customer). WRITE — changes live data. Provide the full outlet payload per the Brewman CreateOutlet schema (Swagger). Confirm details with Patrick before calling. Note: Outlet Category (Retail/Trade) cannot be changed after creation, and Credit Terms must be set before orders can be placed.",
      inputSchema: {
        outlet: z
          .record(z.unknown())
          .describe("Outlet object per Brewman Outlet/v1/CreateOutlet schema"),
      },
      annotations: WRITE,
    },
    async ({ outlet }) => run("/webapi/Outlet/v1/CreateOutlet", outlet)
  );

  server.registerTool(
    "brewman_update_outlet",
    {
      title: "Update an outlet (WRITE)",
      description:
        "Update an existing outlet. WRITE — changes live data. Provide the full outlet payload (including its id) per the Brewman UpdateOutlet schema. Confirm with Patrick first.",
      inputSchema: {
        outlet: z
          .record(z.unknown())
          .describe("Outlet object (with id) per Brewman Outlet/v1/UpdateOutlet schema"),
      },
      annotations: WRITE,
    },
    async ({ outlet }) => run("/webapi/Outlet/v1/UpdateOutlet", outlet)
  );

  // --- Orders ---------------------------------------------------------------
  server.registerTool(
    "brewman_get_orders_by_filter",
    {
      title: "Get orders by filter",
      description:
        "Get full orders (header + lines) matching a filter (e.g. by outlet, status, date range) per the Brewman Order/v2/GetOrdersByFilter schema. Read-only.",
      inputSchema: {
        filter: z
          .record(z.unknown())
          .describe("Filter object per Order/v2/GetOrdersByFilter schema (Swagger)"),
      },
      annotations: READ,
    },
    async ({ filter }) => run("/webapi/Order/v2/GetOrdersByFilter", filter)
  );

  server.registerTool(
    "brewman_build_order_lines",
    {
      title: "Preview order lines (no save)",
      description:
        "Performs the standard UI calculations for adding items to an order and returns what the order WOULD look like — WITHOUT saving it. Use this to preview pricing/duty before creating an order, then show Patrick and, on approval, create the order. Provide the order context (outlet, price list, items) per Order/v2/BuildOrderLines schema.",
      inputSchema: {
        order: z
          .record(z.unknown())
          .describe("Order context + items per Order/v2/BuildOrderLines schema"),
      },
      annotations: READ,
    },
    async ({ order }) => run("/webapi/Order/v2/BuildOrderLines", order)
  );

  server.registerTool(
    "brewman_create_order",
    {
      title: "Create an order (WRITE)",
      description:
        "Create a new order in OPEN status. WRITE — changes live data and allocates stock. Provide the order payload per Order/v1/CreateOrder schema (use brewman_build_order_lines first to construct/verify the lines). ALWAYS confirm the full order with Patrick before calling. Remember market-correct brand variants (IRE/UK/EU/US).",
      inputSchema: {
        order: z
          .record(z.unknown())
          .describe("Order object per Brewman Order/v1/CreateOrder schema"),
      },
      annotations: WRITE,
    },
    async ({ order }) => run("/webapi/Order/v1/CreateOrder", order)
  );

  server.registerTool(
    "brewman_cancel_order",
    {
      title: "Cancel an order (WRITE, destructive)",
      description:
        "Cancel the given order. WRITE and effectively destructive — confirm with Patrick first. Provide the orderId.",
      inputSchema: {
        orderId: z.string().describe("The id of the order to cancel"),
      },
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ orderId }) => run("/webapi/Order/v1/CancelOrder", { orderId })
  );

  // --- Accounts posting -----------------------------------------------------
  server.registerTool(
    "brewman_get_current_posting_items",
    {
      title: "Get items awaiting accounts posting",
      description:
        "Get everything currently queued/in-progress for posting to accounts (orders, credits, purchase orders). Read-only.",
      inputSchema: {},
      annotations: READ,
    },
    async () => run("/webapi/AccountPosting/v1/GetCurrentPostingItems", {})
  );

  // --- Generic escape hatch (full API coverage) -----------------------------
  server.registerTool(
    "brewman_request",
    {
      title: "Call any Brewman API method (advanced)",
      description:
        "Generic passthrough to ANY Brewman Web API method not covered by a dedicated tool (all are POST). Provide the method path (e.g. '/webapi/PurchaseOrder/v1/GetPurchaseOrdersByFilter') and the JSON body per the Swagger schema. The tenant id is injected automatically. Use this for reads freely; for any write/create/update/cancel method, treat it as a WRITE and confirm with Patrick first. Reference: https://brewman.premiersystems.com/swagger/index.html",
      inputSchema: {
        method_path: z
          .string()
          .regex(/^\/webapi\//, "Must start with /webapi/")
          .describe("Full method path, e.g. /webapi/Order/v2/GetOrders"),
        body: z
          .record(z.unknown())
          .default({})
          .describe("JSON request body per the method's Swagger schema"),
        is_write: z
          .boolean()
          .default(false)
          .describe(
            "Set true if this method creates/updates/cancels/records data (so the operator knows to confirm with Patrick first)."
          ),
      },
      annotations: WRITE, // conservative: a generic call may write
    },
    async ({ method_path, body }) => run(method_path, body ?? {})
  );
}
