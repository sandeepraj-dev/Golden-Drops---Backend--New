# API endpoint reference
Base URL: `http://localhost:4000/api/v1`. All endpoints except `GET /health` and `POST /auth/login` require `Authorization: Bearer <JWT>`. JSON responses use `{success,message,data}`; errors use `{success:false,error:{code,message,details?}}`. List endpoints accept `page` (default 1) and `limit` (default 20, max 100), except current stock summary which currently returns all oil types.

## Authentication and health
- `GET /health` — liveness/database-connected check; no body.
- `POST /auth/login` — body `{ "username":"admin", "password":"..." }`; returns JWT in `data.accessToken`.

## Master CRUD
For each resource `manufacturers`, `suppliers`, and `oil-types`:
- `POST /{resource}` create; body documented in API_PAYLOADS.md.
- `GET /{resource}?page=1&limit=20&search=ground&active=true` list/search/filter.
- `GET /{resource}/:id` read one.
- `PATCH /{resource}/:id` update supplied fields only.
- `DELETE /{resource}/:id` soft-deactivate; never physically deletes.

Oil type additionally stores `defaultPurchasePricePerKg` and `sellingPricePerKg` in rupees. These prices can be set and updated in the oil-type CRUD form. A purchase updates the default purchase price; a sale uses configured selling price unless the item overrides it.

## Purchases
- `POST /purchases` create purchase and stock ledger movement. Send optional `Idempotency-Key` header.
- `GET /purchases?page=1&limit=20&search=PUR-2026&manufacturerId=101&oilTypeId=101&from=2026-10-01&to=2026-10-31&status=COMPLETED` list/filter.
- `GET /purchases/:id` detail.
- `PATCH /purchases/:id` returns `409 IMMUTABLE_TRANSACTION`; cancel and recreate to correct a finalized purchase.
- `POST /purchases/:id/cancel` safely reverses stock only if the purchased stock is still available.
- `GET /purchases/:id/payments` history; `POST /purchases/:id/payments` record payment.
- `GET /purchases/:id/bill` stored bill JSON; `GET /purchases/:id/bill/pdf` PDF.

## Sales
- `POST /sales` create finalized bill and deduct stock atomically; supplier defaults from settings. Supports multiple items. Send optional `Idempotency-Key` header.
- `GET /sales?page=1&limit=20&search=SAL-2026&supplierId=101&from=2026-10-01&to=2026-10-31&status=COMPLETED` list/filter.
- `GET /sales/:id` detail.
- `PATCH /sales/:id` returns `409 IMMUTABLE_TRANSACTION`; cancel and recreate to correct.
- `POST /sales/:id/cancel` reverse sold stock.
- `GET /sales/:id/payments`, `POST /sales/:id/payments`.
- `GET /sales/:id/bill` JSON; `GET /sales/:id/bill/pdf` PDF.

## Stock
- `GET /stock` all oil stock summary.
- `GET /stock/valuation` current stock valuation (same stock summary shape).
- `GET /stock/:oilTypeId` stock for one oil type.
- `GET /stock/:oilTypeId/movements?page=1&limit=20&from=2026-10-01&to=2026-10-31` ledger history. (Date filters are planned but not currently applied by the controller; use pagination.)

## Dashboard and reports
- `GET /dashboard` cards and stock distribution.
- `GET /reports/purchases?from=YYYY-MM-DD&to=YYYY-MM-DD&manufacturerId=101&page=1&limit=20`
- `GET /reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=20`
- `GET /reports/stock`
- `GET /reports/profit?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=20`
- `GET /reports/payments?page=1&limit=20`
- `GET /reports/outstanding`

## Settings
- `GET /settings` get business settings.
- `PATCH /settings` update `businessName`, `businessAddress`, `businessPhone`, `defaultSupplierId`, `defaultProfitPerKg`, `timezone`, `currency`, `currencySymbol`, `purchasePrefix`, `salePrefix`, `lowStockThresholdKg`.

## Status and error codes
- `200` successful read/update; `201` created; `400` invalid input/business rule; `401` missing/invalid token or credentials; `404` missing record; `409` stock conflict, duplicate, or immutable transaction; `429` rate limit; `500` unexpected server error.
