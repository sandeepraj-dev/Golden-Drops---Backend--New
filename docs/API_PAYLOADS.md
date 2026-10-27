# API request and response payloads
Money values in requests/responses are rupees (2 decimals); DB storage is integer paise. IDs are numeric, generated server-side starting at 101 per collection. Never send an ID when creating a record. Use valid IDs returned by the API. All examples after login require `Authorization: Bearer <accessToken>`.

## Login
`POST /api/v1/auth/login`
```json
{"username":"admin","password":"ChangeThisPassword123!"}
```
Success `200`: `{ "success": true, "message": "Login successful", "data": { "tokenType":"Bearer", "accessToken":"<JWT>", "expiresIn":"8h", "user":{"id":101,"username":"admin","role":"ADMIN"} } }`.

## Manufacturer CRUD
`POST /manufacturers`
```json
{"name":"ABC Oil Mills","phone":"9876500001","alternatePhone":"9876500002","address":"Industrial Road","villageOrCity":"Coimbatore","notes":"Call before dispatch"}
```
Returns `201` with `data.id`, `isActive`, `createdAt`, `updatedAt`. List response: `{ "success":true,"data":{"items":[...],"pagination":{"page":1,"limit":20,"total":1,"totalPages":1}} }`. `PATCH /manufacturers/101` accepts any subset of create fields. `DELETE /manufacturers/101` deactivates.

## Supplier CRUD
`POST /suppliers`
```json
{"name":"Default Oil Supplier","phone":"9876500003","address":"Market Road","gpayNumber":"9876500003","notes":"Default buyer","isDefault":true}
```
PATCH accepts the same fields optionally. Only one supplier should be default; configure `defaultSupplierId` in settings if needed.

## Oil type CRUD — prices live on this record
`POST /oil-types`
```json
{"name":"Groundnut Oil","code":"GNO","description":"Filtered groundnut oil","unit":"KG","minimumStockKg":100,"defaultPurchasePricePerKg":120,"sellingPricePerKg":140}
```
`PATCH /oil-types/101` example: `{"defaultPurchasePricePerKg":122.5,"sellingPricePerKg":145}`. The server validates values as non-negative rupee amounts. Purchase writes its actual rate to `defaultPurchasePricePerKg`; if `sellingPricePerKg` is zero/unset, it initializes it to purchase rate + configured default profit. Later purchase prices do not automatically overwrite a manually configured selling price.

## Create purchase
`POST /purchases` with optional header `Idempotency-Key: purchase-2026-001`
```json
{"manufacturerId":101,"oilTypeId":101,"quantityKg":1000,"purchasePricePerKg":120,"advanceAmount":30000,"gpayNumber":"9876500001","purchaseDate":"2026-10-26","notes":"Regular oil purchase"}
```
Server calculates total ₹120000, paid ₹30000, outstanding ₹90000, status `PARTIALLY_PAID`, and adds 1000 KG to stock. Response fields include `purchaseNumber`, `quantityKg`, `purchasePrice`, `total`, `totalPaid`, `outstanding`, `paymentStatus`, and snapshots. `GET /purchases?page=1&limit=20`; `GET /purchases/101`; `POST /purchases/101/cancel`; `GET /purchases/101/bill`; `GET /purchases/101/bill/pdf`.

## Purchase payment
`POST /purchases/101/payments`
```json
{"amount":10000,"paymentDate":"2026-10-27","method":"GPAY","reference":"UPI-REF-001","notes":"Second payment"}
```
Returns `201` payment record. `GET /purchases/101/payments` returns paginated posted payment history. Amount cannot exceed outstanding.

## Create sale
`POST /sales` with optional `Idempotency-Key: sale-2026-001`
```json
{"items":[{"oilTypeId":101,"quantityKg":50},{"oilTypeId":102,"quantityKg":10,"sellingPricePerKg":175}],"paymentReceived":1000,"paymentMethod":"GPAY","saleDate":"2026-10-27","notes":"Delivery to default supplier"}
```
Supplier is automatically selected from settings when `supplierId` is omitted. The first item uses oil type's configured `sellingPricePerKg`; item-level price overrides are optional. Server calculates line totals, grand total, weighted-average cost of goods sold, gross profit, outstanding, and stock deduction. Response contains `saleNumber`, `items`, `grandTotal`, `totalCost`, `grossProfit`, `totalPaid`, `outstanding`, and `paymentStatus`. `GET /sales?page=1&limit=20`; `GET /sales/101`; `POST /sales/101/cancel`; `GET /sales/101/bill`; `GET /sales/101/bill/pdf`.

## Sales payment
`POST /sales/101/payments`
```json
{"amount":2000,"paymentDate":"2026-10-27","method":"UPI","reference":"COLLECT-001","notes":"Part payment"}
```
Payment may not exceed outstanding. `GET /sales/101/payments` lists payment history.

## Stock, dashboard, reports
- `GET /stock` returns oil-wise `totalPurchasedKg`, `totalSoldKg`, `availableStockKg`, `averagePurchaseCostPerKg`, `stockValuation`, and last purchase/sale dates.
- `GET /stock/101` returns one oil's quantity, average cost and valuation.
- `GET /stock/101/movements?page=1&limit=20` returns ledger rows.
- `GET /stock/valuation` returns stock summary with valuations.
- `GET /dashboard` returns today's purchase/sales totals and quantities, stock total/valuation, gross profit today/month, purchase/sales outstanding and stock distribution.
- Reports endpoints accept `from`, `to`, and pagination where supported. See API_ENDPOINTS.md.

## Settings
`PATCH /settings`
```json
{"businessName":"ABC Brokerage","businessAddress":"Coimbatore, Tamil Nadu","businessPhone":"9876500000","defaultSupplierId":101,"defaultProfitPerKg":20,"timezone":"Asia/Kolkata","currency":"INR","currencySymbol":"₹","lowStockThresholdKg":50}
```
`GET /settings` returns current settings. Values already stored in MongoDB take precedence over environment defaults.

## Errors
```json
{"success":false,"error":{"code":"INSUFFICIENT_STOCK","message":"Insufficient stock. Available 10 KG; requested 50 KG"}}
```
Typical statuses: 400 validation/business rule; 401 auth; 404 missing record; 409 stock conflict/duplicate/immutable transaction; 429 rate limited. Exact data varies with record state.
