# brewman-mcp-server

An MCP server that wraps the **Brewman Web (V7) API** so Claude can read and write
Brewman data through tools — without ever seeing the raw API token. Built for Flying
Tumbler as the **fast read/write layer** alongside the browser-driven `brewman-operator`
skill (which handles production, duty, ullages, containers, distribution and reports —
the things the API can't do).

> The token is held as a **server environment variable**. It is never in code, never
> in chat, never logged.

## What it exposes

Tools (all calls are POST to `/webapi/...`; the tenant id is injected automatically):

| Tool | Type | Purpose |
|---|---|---|
| `brewman_get_user_context` | read | Verify token + get the tenant id. Call first. |
| `brewman_get_reference` | read | Any config list: product_brands, stock_locations, package_types, price_lists, pricing_categories, sales_areas/codes, credit_terms, vat_codes, gl_codes, stock_groups, units_of_measure, outlet_types/ratings/sub_types, couriers, delivery_areas, collection_times, outlet_groups, suppliers_manufacturers, outlets. |
| `brewman_get_stock_levels` | read | Current in-stock qty per item id. |
| `brewman_get_stock_incoming_outgoing` | read | Incoming/outgoing totals. |
| `brewman_get_price_list_lines` | read | All product prices on a price list. |
| `brewman_evaluate_prices` | read | Price items on a list (list price + discounts). |
| `brewman_get_outlets_by_filter` | read | Outlets (all or by id). |
| `brewman_create_outlet` | **write** | Create a customer. |
| `brewman_update_outlet` | **write** | Update a customer. |
| `brewman_get_orders_by_filter` | read | Orders (header + lines) by filter. |
| `brewman_build_order_lines` | read | Preview an order's lines/pricing WITHOUT saving. |
| `brewman_create_order` | **write** | Create an order (Open status). |
| `brewman_cancel_order` | **write/destructive** | Cancel an order. |
| `brewman_get_current_posting_items` | read | What's queued for accounts posting. |
| `brewman_request` | **advanced** | Generic passthrough to ANY of the ~90 Brewman methods. |

Full API reference (Swagger): https://brewman.premiersystems.com/swagger/index.html

## Setup

### 1. Create a dedicated Brewman API user + token
In Brewman, create a **new user just for the API** (so anything it creates is attributed
to "API" in the UI, not to you). Generate an **API token** from that user's screen and
note the **tenant (group) id** shown there.

### 2. Configure environment variables
Copy `.env.example` → `.env` (local) or set them in your host's project settings:

- `BREWMAN_API_TOKEN` — the token (secret)
- `BREWMAN_TENANT_ID` — the tenant/group id
- optional: `BREWMAN_BASE_URL`, `BREWMAN_TENANT_FIELD`, `TRANSPORT`, `PORT`

### 3a. Deploy to Vercel (matches the FT Meta MCP setup)
```bash
npm install
vercel            # link/deploy
# In the Vercel dashboard: Project → Settings → Environment Variables:
#   BREWMAN_API_TOKEN, BREWMAN_TENANT_ID
vercel --prod
```
MCP endpoint: `https://<your-app>.vercel.app/mcp` (rewritten to `/api/mcp`).

### 3b. Or run anywhere as a Node service / locally
```bash
npm install
npm run build
BREWMAN_API_TOKEN=... BREWMAN_TENANT_ID=... npm start   # http on :3000 -> /mcp
```

### 4. Connect it to Claude / Cowork
Add the deployed URL as a custom MCP connector (same way the FT Meta MCP is wired):
`https://<your-app>.vercel.app/mcp`. Then the `brewman-operator` skill will use these
tools for orders/outlets/stock/config and fall back to the browser for everything else.

## Verify
```bash
# health check
curl https://<your-app>.vercel.app/mcp        # -> {"ok":true,...}
```
Then from Claude, call `brewman_get_user_context` — it should return your user + tenant id.

## Safety
- **Reads** are free. **Writes** (`create_order`, `create/update_outlet`, `cancel_order`,
  and any write via `brewman_request`) change live data exactly like the UI — the operator
  confirms with Patrick before calling them.
- The API is **BETA**; schemas may change. The dedicated tools cover the common cases; use
  `brewman_request` with the Swagger schema for anything else.
- Not available via API (use the browser/`brewman-operator` skill): production/batches,
  duty & excise returns, ullages, container tracking, distribution journeys, BI reports.
