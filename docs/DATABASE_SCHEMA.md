# Database schema
All schemas use Mongoose timestamps. Public numeric IDs use the `Counter` collection and begin at 101 per collection; MongoDB `_id` remains an ObjectId.
- **User**: `id`, unique lowercase `username`, `passwordHash` (bcrypt, excluded from normal reads), role (`ADMIN`), `isActive`, timestamps. Unique username.
- **Manufacturer**: numeric ID, name, phone, alternate phone, address, village/city, notes, active status. Unique name+phone.
- **Supplier**: ID, name, phone, address, GPay number, notes, `isDefault`, active status. Unique name+phone.
- **OilType**: ID, name, unique code, description, unit KG, `minimumStockKg`, `defaultPurchasePricePerKg`, `sellingPricePerKg`, active status. Prices are rupees at API/model layer; purchase/sale records snapshot actual prices in paise.
- **Purchase**: unique purchase number; manufacturer/oil numeric references and snapshots; quantity; unit price paise; total/paid/outstanding paise; date; GPay; status/payment status; idempotency key; notes.
- **Sale**: unique sale number; supplier reference/snapshot; item snapshots with quantity, selling price paise, cost paise, line total/cost/profit; bill totals; payment/outstanding; status and idempotency key.
- **Payment**: direction PURCHASE/SALE, transaction numeric ID, amount paise, date, method, reference, notes, POSTED/REVERSED status, optional reversal reference.
- **StockLedger**: oil reference, movement type, signed quantity KG, unit cost paise, transaction reference, timestamp, balance after movement, notes. This is the inventory movement history.
- **BusinessSettings**: singleton `key=main`, business identity, default supplier ID, default profit/KG, timezone/currency, bill prefixes, low-stock threshold.
- **Counter**: counter key and sequence used for public IDs.
- **AuditLog**: action/entity type/entity ID/details/request ID; available for future detailed audit wiring.

Relationships are numeric public IDs with snapshots for historical display. Financial transaction records are not hard-deleted. Unique indexes cover public IDs, bill numbers, username, oil code/name, and idempotency keys where configured.
