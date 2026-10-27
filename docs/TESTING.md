# Testing
Run `npm test` (Node's built-in test runner). The included smoke tests cover pure calculations and request schema rules without connecting to or modifying a business database. For integration testing, use a separate MongoDB replica-set database and set `MONGODB_URI` to that isolated database before starting the server. Never point test runs at the live business database.

Manual workflow: login → create manufacturer/oil/supplier → set `defaultPurchasePricePerKg` and `sellingPricePerKg` on oil type → create purchase with advance → inspect purchase payment history and `/stock` → create sale → inspect sale PDF, payments, dashboard and profit report → test insufficient-stock sale rejection → cancel sale and verify stock reversal.
