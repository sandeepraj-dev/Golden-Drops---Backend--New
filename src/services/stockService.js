import StockLedger from "../models/StockLedger.js";
import OilType from "../models/OilType.js";
import { AppError } from "../utils/errors.js";

/**
 * Calculate available stock and weighted-average cost for an oil type.
 *
 * Positive ledger quantities add stock.
 * Negative ledger quantities remove stock at the current average cost.
 *
 * All monetary costs are maintained in paise.
 */
export async function stockForOil(oilTypeId, session) {
  let query = StockLedger.find(
    { oilTypeId },
    {
      quantityKg: 1,
      unitCostPaise: 1,
      movementType: 1,
      occurredAt: 1,
      id: 1,
      _id: 1,
    },
  ).sort({ occurredAt: 1, _id: 1 });

  if (session) {
    query = query.session(session);
  }

  const rows = await query.lean();

  let quantityKg = 0;
  let inventoryCostPaise = 0;

  for (const row of rows) {
    const quantity = Number(row.quantityKg || 0);
    const unitCostPaise = Number(row.unitCostPaise || 0);

    if (!Number.isFinite(quantity) || !Number.isFinite(unitCostPaise)) {
      throw new AppError("Invalid stock ledger quantity or cost", 500);
    }

    if (quantity >= 0) {
      quantityKg += quantity;
      inventoryCostPaise += Math.round(quantity * unitCostPaise);
    } else {
      const removeQuantity = Math.min(quantityKg, Math.abs(quantity));

      const averageCost = quantityKg > 0 ? inventoryCostPaise / quantityKg : 0;

      quantityKg += quantity;

      inventoryCostPaise = Math.max(
        0,
        Math.round(inventoryCostPaise - removeQuantity * averageCost),
      );
    }

    // Avoid floating-point residue in KG quantities.
    quantityKg = Math.round(quantityKg * 1000) / 1000;
  }

  if (quantityKg < -1e-9) {
    throw new AppError(
      "Stock ledger contains a negative inventory balance",
      500,
    );
  }

  quantityKg = Math.max(0, quantityKg);
  inventoryCostPaise = Math.max(0, Math.round(inventoryCostPaise));

  return {
    quantityKg,
    costPaise: inventoryCostPaise,
    averageCostPaisePerKg:
      quantityKg > 0 ? Math.round(inventoryCostPaise / quantityKg) : 0,
  };
}

/**
 * Return stock summaries for all oil types.
 */
export async function listStock() {
  const oils = await OilType.find({}).sort({ name: 1 }).lean();

  const result = [];

  for (const oil of oils) {
    const stock = await stockForOil(oil.id);

    const [purchased, sold, lastPurchase, lastSale] = await Promise.all([
      StockLedger.aggregate([
        {
          $match: {
            oilTypeId: oil.id,
            movementType: "PURCHASE",
          },
        },
        {
          $group: {
            _id: null,
            quantityKg: { $sum: "$quantityKg" },
          },
        },
      ]),

      StockLedger.aggregate([
        {
          $match: {
            oilTypeId: oil.id,
            movementType: "SALE",
          },
        },
        {
          $group: {
            _id: null,
            quantityKg: {
              $sum: { $abs: "$quantityKg" },
            },
          },
        },
      ]),

      StockLedger.findOne({
        oilTypeId: oil.id,
        movementType: "PURCHASE",
      }).sort({ occurredAt: -1, _id: -1 }),

      StockLedger.findOne({
        oilTypeId: oil.id,
        movementType: "SALE",
      }).sort({ occurredAt: -1, _id: -1 }),
    ]);

    result.push({
      oilTypeId: oil.id,
      oilName: oil.name,
      unit: "KG",

      totalPurchasedKg: purchased[0]?.quantityKg || 0,

      totalSoldKg: sold[0]?.quantityKg || 0,

      availableStockKg: stock.quantityKg,

      averagePurchaseCostPerKg: stock.averageCostPaisePerKg / 100,

      stockValuation: stock.costPaise / 100,

      lastPurchaseDate: lastPurchase?.occurredAt || null,

      lastSaleDate: lastSale?.occurredAt || null,

      lowStock:
        stock.quantityKg <= Math.max(Number(oil.minimumStockKg || 0), 0),
    });
  }

  return result;
}

/**
 * Validate available stock before a sale.
 *
 * IMPORTANT:
 * This validation must run inside the same MongoDB transaction
 * as the sale and its stock-ledger writes.
 */
export async function ensureStock(oilTypeId, quantity, session) {
  const requestedQuantity = Number(quantity);

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new AppError(
      "Requested stock quantity must be greater than zero",
      400,
    );
  }

  const stock = await stockForOil(oilTypeId, session);

  if (stock.quantityKg + 1e-9 < requestedQuantity) {
    throw new AppError(
      `Insufficient stock. Available ${stock.quantityKg} KG; requested ${requestedQuantity} KG`,
      409,
      "INSUFFICIENT_STOCK",
    );
  }

  return stock;
}
