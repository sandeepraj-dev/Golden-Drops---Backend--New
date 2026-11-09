import mongoose from "mongoose";
import Manufacturer from "../models/Manufacturer.js";
import Supplier from "../models/Supplier.js";
import OilType from "../models/OilType.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Payment from "../models/Payment.js";
import StockLedger from "../models/StockLedger.js";
import BusinessSettings from "../models/BusinessSettings.js";
import Counter from "../models/Counter.js";
import AuditLog from "../models/AuditLog.js";
import { AppError } from "../utils/errors.js";
import { stockForOil, ensureStock } from "./stockService.js";
const paise = (n) => Math.round((Number(n) + Number.EPSILON) * 100);
const rupees = (n) => Math.round(n) / 100;
const status = (paid, total) =>
  paid <= 0 ? "UNPAID" : paid >= total ? "PAID" : "PARTIALLY_PAID";
async function number(prefix, Model, date, session) {
  // Use a per-year atomic counter rather than countDocuments()+1. The old
  // implementation could generate the same bill number for concurrent requests.
  const year = new Date(date).getFullYear();
  const field = prefix === "PUR" ? "purchaseNumber" : "saleNumber";
  const counterKey = `${prefix}-${year}`;

  // Seed a new counter from the highest existing suffix, so deploying this
  // fix does not collide with bills created before the counter existed.
  const existingCounter = await Counter.findById(counterKey).session(session);
  if (!existingCounter) {
    const existing = await Model.find(
      { [field]: new RegExp(`^${prefix}-${year}-\\d+$`) },
      { [field]: 1, _id: 0 },
    ).session(session).lean();
    const highest = existing.reduce((max, row) => {
      const suffix = Number(String(row[field] || "").split("-").at(-1));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    await Counter.updateOne(
      { _id: counterKey },
      { $setOnInsert: { seq: highest } },
      { upsert: true, session },
    );
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session, setDefaultsOnInsert: true },
  );
  return `${prefix}-${year}-${String(counter.seq).padStart(4, "0")}`;
}
export async function createPurchase(body, idempotencyKey) {
  if (idempotencyKey) {
    const old = await Purchase.findOne({ idempotencyKey });
    if (old) return old;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const m = await Manufacturer.findOne({
        id: body.manufacturerId,
        isActive: true,
      }).session(session);
      if (!m) throw new AppError("Active manufacturer not found", 404);
      const oil = await OilType.findOne({
        id: body.oilTypeId,
        isActive: true,
      }).session(session);
      if (!oil) throw new AppError("Active oil type not found", 404);
      const date = body.purchaseDate || new Date(),
        total = paise(body.quantityKg * body.purchasePricePerKg),
        advance = paise(body.advanceAmount || 0);
      if (advance > total)
        throw new AppError("Advance cannot exceed purchase total", 400);
      const doc = new Purchase({
        purchaseNumber: await number("PUR", Purchase, date, session),
        manufacturerId: m.id,
        manufacturerSnapshot: {
          id: m.id,
          name: m.name,
          phone: m.phone,
          address: m.address,
        },
        oilTypeId: oil.id,
        oilSnapshot: { id: oil.id, name: oil.name, code: oil.code },
        quantityKg: body.quantityKg,
        purchasePricePaisePerKg: paise(body.purchasePricePerKg),
        totalPaise: total,
        gpayNumber: body.gpayNumber || "",
        purchaseDate: date,
        notes: body.notes || "",
        totalPaidPaise: advance,
        outstandingPaise: total - advance,
        paymentStatus: status(advance, total),
        idempotencyKey,
      });
      await doc.save({ session });
      oil.defaultPurchasePricePerKg = body.purchasePricePerKg;
      const settingsForPrice = await BusinessSettings.findOne({
        key: "main",
      }).session(session);
      if (!(oil.sellingPricePerKg > 0))
        oil.sellingPricePerKg = Number(
          (
            body.purchasePricePerKg +
            Number(settingsForPrice?.defaultProfitPerKg ?? 20)
          ).toFixed(2),
        );
      await oil.save({ session });
      const st = await stockForOil(oil.id, session);
      const balance = st.quantityKg + body.quantityKg;
      await StockLedger.create(
        [
          {
            oilTypeId: oil.id,
            movementType: "PURCHASE",
            quantityKg: body.quantityKg,
            unitCostPaise: doc.purchasePricePaisePerKg,
            referenceType: "PURCHASE",
            referenceId: doc.id,
            referenceNumber: doc.purchaseNumber,
            occurredAt: date,
            balanceAfterKg: balance,
          },
        ],
        { session },
      );
      if (advance > 0)
        await Payment.create(
          [
            {
              direction: "PURCHASE",
              transactionId: doc.id,
              amountPaise: advance,
              paymentDate: date,
              method: "GPAY",
              notes: "Initial advance",
            },
          ],
          { session },
        );
      result = doc;
    });
    return result;
  } catch (error) {
    if (error.code === 11000) {
      console.error("Duplicate key error:", {
        message: error.message,
        collection: error.collection,
        keyPattern: error.keyPattern,
        keyValue: error.keyValue,
      });
    }

    // A repeated Idempotency-Key represents the same client operation. If a
    // concurrent request won the race, return its already-created bill.
    if (error.code === 11000 && idempotencyKey) {
      const existing = await Purchase.findOne({ idempotencyKey });
      if (existing) return existing;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
export async function addPayment(direction, transactionId, body) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const Model = direction === "PURCHASE" ? Purchase : Sale;
      const doc = await Model.findOne({
        id: transactionId,
        status: "COMPLETED",
      }).session(session);
      if (!doc) throw new AppError("Transaction not found or cancelled", 404);
      const total =
        direction === "PURCHASE" ? doc.totalPaise : doc.grandTotalPaise;
      const paid = doc.totalPaidPaise + paise(body.amount);
      if (paid > total)
        throw new AppError("Payment exceeds outstanding balance", 400);
      const p = new Payment({
        direction,
        transactionId,
        amountPaise: paise(body.amount),
        paymentDate: body.paymentDate || new Date(),
        method: body.method || "GPAY",
        reference: body.reference || "",
        notes: body.notes || "",
      });
      await p.save({ session });
      doc.totalPaidPaise = paid;
      doc.outstandingPaise = total - paid;
      doc.paymentStatus = status(paid, total);
      await doc.save({ session });
      result = p;
    });
    return result;
  } finally {
    await session.endSession();
  }
}
export async function createSale(body, idempotencyKey) {
  if (idempotencyKey) {
    const old = await Sale.findOne({ idempotencyKey });
    if (old) return old;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      let supplier;
      if (body.supplierId)
        supplier = await Supplier.findOne({
          id: body.supplierId,
          isActive: true,
        }).session(session);
      else {
        const settings = await BusinessSettings.findOne({
          key: "main",
        }).session(session);
        supplier = settings?.defaultSupplierId
          ? await Supplier.findOne({
              id: settings.defaultSupplierId,
              isActive: true,
            }).session(session)
          : await Supplier.findOne({ isDefault: true, isActive: true }).session(
              session,
            );
      }
      if (!supplier)
        throw new AppError(
          "No active supplier supplied or configured as default",
          400,
        );
      const settings = await BusinessSettings.findOne({ key: "main" }).session(
        session,
      );
      const items = [];
      let total = 0,
        cost = 0,
        qty = 0;
      const requestedByOil = new Map();
      for (const input of body.items)
        requestedByOil.set(
          input.oilTypeId,
          (requestedByOil.get(input.oilTypeId) || 0) + input.quantityKg,
        );
      for (const [oilId, requestedQty] of requestedByOil) {
        const lock = await OilType.updateOne(
          { id: oilId, isActive: true },
          { $inc: { stockVersion: 1 } },
          { session },
        );
        if (!lock.matchedCount)
          throw new AppError(`Active oil type ${oilId} not found`, 404);
        const current = await stockForOil(oilId, session);
        await ensureStock(oilId, requestedQty, session);
      }
      for (const input of body.items) {
        const oil = await OilType.findOne({
          id: input.oilTypeId,
          isActive: true,
        }).session(session);
        if (!oil)
          throw new AppError(
            `Active oil type ${input.oilTypeId} not found`,
            404,
          );
        const st = await ensureStock(oil.id, input.quantityKg, session);
        const costPer = st.averageCostPaisePerKg;
        const configuredPrice = Number(oil.sellingPricePerKg || 0);
        const pricePer =
          input.sellingPricePerKg == null
            ? configuredPrice > 0
              ? paise(configuredPrice)
              : costPer + paise(settings?.defaultProfitPerKg ?? 20)
            : paise(input.sellingPricePerKg);
        const line = Math.round(input.quantityKg * pricePer),
          lineCost = Math.round(input.quantityKg * costPer);
        items.push({
          oilTypeId: oil.id,
          oilSnapshot: { id: oil.id, name: oil.name, code: oil.code },
          quantityKg: input.quantityKg,
          sellingPricePaisePerKg: pricePer,
          costPaisePerKg: costPer,
          lineTotalPaise: line,
          lineCostPaise: lineCost,
          grossProfitPaise: line - lineCost,
        });
        total += line;
        cost += lineCost;
        qty += input.quantityKg;
      }
      const date = body.saleDate || new Date();
      const advance = paise(body.paymentReceived || 0);
      if (advance > total)
        throw new AppError("Payment received cannot exceed bill total", 400);
      const doc = new Sale({
        saleNumber: await number("SAL", Sale, date, session),
        supplierId: supplier.id,
        supplierSnapshot: {
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          address: supplier.address,
          gpayNumber: supplier.gpayNumber,
        },
        items,
        saleDate: date,
        totalQuantityKg: qty,
        grandTotalPaise: total,
        totalCostPaise: cost,
        grossProfitPaise: total - cost,
        totalPaidPaise: advance,
        outstandingPaise: total - advance,
        paymentStatus: status(advance, total),
        notes: body.notes || "",
        idempotencyKey,
      });
      await doc.save({ session });
      for (const item of items) {
        const st = await stockForOil(item.oilTypeId, session);
        await StockLedger.create(
          [
            {
              oilTypeId: item.oilTypeId,
              movementType: "SALE",
              quantityKg: -item.quantityKg,
              unitCostPaise: item.costPaisePerKg,
              referenceType: "SALE",
              referenceId: doc.id,
              referenceNumber: doc.saleNumber,
              occurredAt: date,
              balanceAfterKg: st.quantityKg - item.quantityKg,
            },
          ],
          { session },
        );
      }
      if (advance > 0)
        await Payment.create(
          [
            {
              direction: "SALE",
              transactionId: doc.id,
              amountPaise: advance,
              paymentDate: date,
              method: body.paymentMethod || "GPAY",
              notes: "Payment received with sale",
            },
          ],
          { session },
        );
      result = doc;
    });
    return result;
  } catch (error) {
    // If two retries with the same Idempotency-Key race, return the first bill.
    if (error.code === 11000 && idempotencyKey) {
      const existing = await Sale.findOne({ idempotencyKey });
      if (existing) return existing;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
export async function cancelTransaction(type, id) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      if (type === "PURCHASE") {
        const p = await Purchase.findOne({ id }).session(session);
        if (!p) throw new AppError("Purchase not found", 404);
        if (p.status === "CANCELLED")
          throw new AppError("Already cancelled", 409);
        const st = await stockForOil(p.oilTypeId, session);
        if (st.quantityKg + 1e-9 < p.quantityKg)
          throw new AppError(
            "Cannot cancel purchase: some purchased stock has already been sold",
            409,
          );
        await StockLedger.create(
          [
            {
              oilTypeId: p.oilTypeId,
              movementType: "PURCHASE_REVERSAL",
              quantityKg: -p.quantityKg,
              unitCostPaise: p.purchasePricePaisePerKg,
              referenceType: "PURCHASE",
              referenceId: p.id,
              referenceNumber: p.purchaseNumber,
              occurredAt: new Date(),
              balanceAfterKg: st.quantityKg - p.quantityKg,
            },
          ],
          { session },
        );
        p.status = "CANCELLED";
        await p.save({ session });
        result = p;
      } else {
        const s = await Sale.findOne({ id }).session(session);
        if (!s) throw new AppError("Sale not found", 404);
        if (s.status === "CANCELLED")
          throw new AppError("Already cancelled", 409);
        for (const item of s.items) {
          const st = await stockForOil(item.oilTypeId, session);
          await StockLedger.create(
            [
              {
                oilTypeId: item.oilTypeId,
                movementType: "SALE_REVERSAL",
                quantityKg: item.quantityKg,
                unitCostPaise: item.costPaisePerKg,
                referenceType: "SALE",
                referenceId: s.id,
                referenceNumber: s.saleNumber,
                occurredAt: new Date(),
                balanceAfterKg: st.quantityKg + item.quantityKg,
              },
            ],
            { session },
          );
        }
        s.status = "CANCELLED";
        await s.save({ session });
        result = s;
      }
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Permanently remove a purchase or sale and its dependent financial/stock rows.
 * Purchase deletion is rejected when removing its stock receipt would make
 * any later stock movement negative. All writes run in one Mongo transaction.
 */
export async function deleteTransaction(type, id, actor = {}) {
  if (!["PURCHASE", "SALE"].includes(type)) throw new AppError("Unsupported transaction type", 400);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError("Invalid transaction ID", 400);

  const Model = type === "PURCHASE" ? Purchase : Sale;
  const numberField = type === "PURCHASE" ? "purchaseNumber" : "saleNumber";
  const session = await mongoose.startSession();
  let deleted;

  try {
    await session.withTransaction(async () => {
      const transaction = await Model.findOne({ id }).session(session);
      if (!transaction) throw new AppError(type === "PURCHASE" ? "Purchase not found" : "Sale not found", 404);

      const ledgerRows = await StockLedger.find({ referenceType: type, referenceId: id }).session(session).lean();
      const transactionOilIds = type === "PURCHASE"
        ? [Number(transaction.oilTypeId)]
        : (transaction.items || []).map(item => Number(item.oilTypeId));
      const affectedOilIds = [...new Set([
        ...ledgerRows.map(row => Number(row.oilTypeId)),
        ...transactionOilIds,
      ].filter(oilId => Number.isSafeInteger(oilId) && oilId > 0))];

      // A purchase contributes to stock and to the weighted-average cost used
      // by later sales. Reject deletion if any later stock-out exists, so old
      // sales COGS/profit figures cannot silently become inconsistent.
      if (type === "PURCHASE" && transaction.status !== "CANCELLED") {
        const oilId = Number(transaction.oilTypeId);
        const allOilRows = await StockLedger.find({ oilTypeId: oilId })
          .sort({ occurredAt: 1, _id: 1 }).session(session).lean();
        const targetIndex = allOilRows.findIndex(row =>
          row.referenceType === "PURCHASE" && Number(row.referenceId) === id && Number(row.quantityKg) > 0
        );
        const rowsAfterPurchase = targetIndex >= 0
          ? allOilRows.slice(targetIndex + 1)
          : allOilRows.filter(row => !(row.referenceType === "PURCHASE" && Number(row.referenceId) === id));
        if (rowsAfterPurchase.some(row => Number(row.quantityKg) < 0)) {
          throw new AppError(
            "Cannot delete this purchase because later sales or stock-out movements depend on its inventory/cost. Delete those dependent records first, then retry.",
            409,
            "PURCHASE_STOCK_ALREADY_USED",
          );
        }

        // Also ensure the remaining chronological ledger cannot go negative.
        let runningKg = 0;
        for (const row of allOilRows) {
          if (row.referenceType === "PURCHASE" && Number(row.referenceId) === id) continue;
          runningKg = Math.round((runningKg + Number(row.quantityKg || 0)) * 1000) / 1000;
          if (runningKg < -1e-9) {
            throw new AppError("Cannot delete this purchase because remaining stock movements would create negative inventory.", 409, "PURCHASE_STOCK_ALREADY_USED");
          }
        }
      }

      const paymentResult = await Payment.deleteMany({ direction: type, transactionId: id }, { session });
      const ledgerResult = await StockLedger.deleteMany({ referenceType: type, referenceId: id }, { session });
      const transactionNumber = transaction[numberField];
      await Model.deleteOne({ _id: transaction._id }, { session });

      // balanceAfterKg is a stored snapshot; recalculate it after removing rows.
      for (const oilTypeId of affectedOilIds) {
        const rows = await StockLedger.find({ oilTypeId }).sort({ occurredAt: 1, _id: 1 }).session(session).lean();
        let balanceKg = 0;
        const operations = rows.map(row => {
          balanceKg = Math.round((balanceKg + Number(row.quantityKg || 0)) * 1000) / 1000;
          return { updateOne: { filter: { _id: row._id }, update: { $set: { balanceAfterKg: balanceKg } } } };
        });
        if (operations.length) await StockLedger.bulkWrite(operations, { session });
      }

      await AuditLog.create([{
        action: "PERMANENT_DELETE",
        entityType: type,
        entityId: id,
        details: {
          transactionNumber,
          deletedBy: actor.username || "unknown",
          deletedUserId: actor.id || null,
          deletedPayments: paymentResult.deletedCount || 0,
          deletedStockMovements: ledgerResult.deletedCount || 0,
        },
      }], { session });

      deleted = {
        id, transactionNumber, type, deleted: true,
        deletedPayments: paymentResult.deletedCount || 0,
        deletedStockMovements: ledgerResult.deletedCount || 0,
      };
    });
    return deleted;
  } finally {
    await session.endSession();
  }
}


/**
 * Bulk transaction deletion with stock-dependency cascading.
 * When selected purchases are removed, sales are cascaded only when their
 * stock-out movement is required to keep the remaining chronological stock
 * ledger non-negative. A sale is deleted as a whole across all its oil lines.
 */
export async function bulkDeleteTransactionsCascade(type, ids, actor = {}) {
  if (!["PURCHASE", "SALE"].includes(type)) throw new AppError("Unsupported transaction type", 400);
  const cleanIds = [...new Set(ids)];
  if (!cleanIds.length || cleanIds.length > 100 || cleanIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new AppError("Provide between 1 and 100 valid record IDs", 400, "INVALID_BULK_IDS");
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const PurchaseDocs = type === "PURCHASE" ? await Purchase.find({ id: { $in: cleanIds } }).session(session) : [];
      const SaleDocs = type === "SALE" ? await Sale.find({ id: { $in: cleanIds } }).session(session) : [];
      const foundIds = (type === "PURCHASE" ? PurchaseDocs : SaleDocs).map(x => Number(x.id));
      const missing = cleanIds.filter(id => !foundIds.includes(id));
      if (missing.length) throw new AppError(`Records not found: ${missing.join(", ")}`, 404, "TRANSACTION_NOT_FOUND");

      const deletePurchaseIds = new Set(type === "PURCHASE" ? cleanIds : []);
      const deleteSaleIds = new Set(type === "SALE" ? cleanIds : []);
      const oilIds = new Set();
      for (const p of PurchaseDocs) oilIds.add(Number(p.oilTypeId));
      for (const sale of SaleDocs) for (const item of sale.items || []) oilIds.add(Number(item.oilTypeId));

      // Iteratively cascade only the sale bills whose stock-out is necessary
      // to prevent a negative balance after the selected purchase receipts go.
      if (type === "PURCHASE") {
        let changed = true;
        let passes = 0;
        while (changed && passes++ < 100) {
          changed = false;
          for (const oilId of oilIds) {
            const rows = await StockLedger.find({ oilTypeId: oilId }).sort({ occurredAt: 1, _id: 1 }).session(session).lean();
            let balance = 0;
            for (const row of rows) {
              const refId = Number(row.referenceId);
              if (row.referenceType === "PURCHASE" && deletePurchaseIds.has(refId)) continue;
              if (row.referenceType === "SALE" && deleteSaleIds.has(refId)) continue;
              balance = Math.round((balance + Number(row.quantityKg || 0)) * 1000) / 1000;
              if (balance < -1e-9) {
                if (row.referenceType === "SALE") {
                  if (!deleteSaleIds.has(refId)) {
                    deleteSaleIds.add(refId);
                    changed = true;
                    break;
                  }
                } else {
                  throw new AppError(`Cannot safely delete selected purchases: stock for oil type ${oilId} would become negative after remaining ${row.movementType} movement.`, 409, "STOCK_DEPENDENCY_NOT_SALE");
                }
              }
            }
          }
        }
        if (passes >= 100 && changed) throw new AppError("Could not resolve stock dependencies safely. No records were deleted.", 409, "STOCK_DEPENDENCY_LIMIT");
      }

      const affectedOilIds = [...oilIds];
      const deletedPurchaseDocs = PurchaseDocs;
      const deletedSaleDocs = deleteSaleIds.size
        ? await Sale.find({ id: { $in: [...deleteSaleIds] } }).session(session)
        : [];
      if (type === "PURCHASE" && deletedSaleDocs.length !== deleteSaleIds.size) {
        throw new AppError("A dependent sale record could not be found. No records were deleted.", 409, "DEPENDENT_SALE_MISSING");
      }
      // A cascaded multi-oil bill can affect stock balances for oils beyond
      // the selected purchase oil. Include every line before recalculation.
      for (const sale of deletedSaleDocs) for (const item of sale.items || []) oilIds.add(Number(item.oilTypeId));

      const deletedItems = [];
      const removeDocs = async (Model, docs, direction, refType, numberField) => {
        for (const doc of docs) {
          const paymentResult = await Payment.deleteMany({ direction, transactionId: doc.id }, { session });
          const ledgerResult = await StockLedger.deleteMany({ referenceType: refType, referenceId: doc.id }, { session });
          await Model.deleteOne({ _id: doc._id }, { session });
          const transactionNumber = doc[numberField];
          await AuditLog.create([{
            action: "PERMANENT_DELETE_CASCADE", entityType: refType, entityId: doc.id,
            details: { transactionNumber, deletedBy: actor.username || "unknown", deletedUserId: actor.id || null,
              deletedPayments: paymentResult.deletedCount || 0, deletedStockMovements: ledgerResult.deletedCount || 0,
              cascade: !cleanIds.includes(Number(doc.id)) },
          }], { session });
          deletedItems.push({ id: Number(doc.id), transactionNumber, type: refType, deletedPayments: paymentResult.deletedCount || 0, deletedStockMovements: ledgerResult.deletedCount || 0, cascaded: !cleanIds.includes(Number(doc.id)) });
        }
      };
      await removeDocs(Purchase, deletedPurchaseDocs, "PURCHASE", "PURCHASE", "purchaseNumber");
      await removeDocs(Sale, deletedSaleDocs, "SALE", "SALE", "saleNumber");

      // Rebuild both stock snapshots and weighted-average COGS for surviving
      // sale lines. This keeps inventory valuation and profit reports aligned
      // with the ledger after purchase/sale cascade deletion.
      const survivingSales = new Map();
      const usedSaleItems = new Map();
      for (const oilTypeId of affectedOilIds) {
        const rows = await StockLedger.find({ oilTypeId }).sort({ occurredAt: 1, _id: 1 }).session(session).lean();
        let balanceKg = 0;
        let inventoryCostPaise = 0;
        const operations = [];
        for (const row of rows) {
          const quantity = Number(row.quantityKg || 0);
          const oldUnitCost = Number(row.unitCostPaise || 0);
          if (quantity >= 0) {
            balanceKg += quantity;
            inventoryCostPaise += Math.round(quantity * oldUnitCost);
          } else {
            const removeQuantity = Math.min(balanceKg, Math.abs(quantity));
            const averageCost = balanceKg > 0 ? Math.round(inventoryCostPaise / balanceKg) : 0;
            if (row.referenceType === "SALE") {
              operations.push({ updateOne: { filter: { _id: row._id }, update: { $set: { unitCostPaise: averageCost } } } });
              let saleDoc = survivingSales.get(Number(row.referenceId));
              if (!saleDoc) {
                saleDoc = await Sale.findOne({ id: Number(row.referenceId) }).session(session);
                if (saleDoc) survivingSales.set(Number(row.referenceId), saleDoc);
              }
              if (saleDoc) {
                const useKey = `${saleDoc.id}:${oilTypeId}`;
                const used = usedSaleItems.get(useKey) || new Set();
                const itemIndex = saleDoc.items.findIndex((item, index) => !used.has(index) && Number(item.oilTypeId) === Number(oilTypeId) && Math.abs(Number(item.quantityKg) - Math.abs(quantity)) < 0.001);
                if (itemIndex >= 0) {
                  used.add(itemIndex);
                  usedSaleItems.set(useKey, used);
                  const item = saleDoc.items[itemIndex];
                  item.costPaisePerKg = averageCost;
                  item.lineCostPaise = Math.round(Number(item.quantityKg) * averageCost);
                  item.grossProfitPaise = Number(item.lineTotalPaise || 0) - item.lineCostPaise;
                }
              }
            }
            balanceKg += quantity;
            inventoryCostPaise = Math.max(0, Math.round(inventoryCostPaise - removeQuantity * averageCost));
          }
          balanceKg = Math.round(balanceKg * 1000) / 1000;
          operations.push({ updateOne: { filter: { _id: row._id }, update: { $set: { balanceAfterKg: balanceKg } } } });
        }
        if (operations.length) await StockLedger.bulkWrite(operations, { session });
      }
      for (const saleDoc of survivingSales.values()) {
        saleDoc.totalCostPaise = saleDoc.items.reduce((sum, item) => sum + Number(item.lineCostPaise || 0), 0);
        saleDoc.grossProfitPaise = Number(saleDoc.grandTotalPaise || 0) - saleDoc.totalCostPaise;
        await saleDoc.save({ session });
      }
      result = {
        requested: cleanIds.length,
        deletedCount: deletedItems.filter(x => !x.cascaded).length,
        cascadedSalesCount: deletedItems.filter(x => x.cascaded).length,
        totalDeletedCount: deletedItems.length,
        failedCount: 0,
        deleted: deletedItems,
        failed: [],
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export const moneyFields = (doc) => {
  const x = doc.toObject ? doc.toObject() : { ...doc };
  for (const k of [
    "purchasePricePaisePerKg",
    "totalPaise",
    "totalPaidPaise",
    "outstandingPaise",
    "grandTotalPaise",
    "totalCostPaise",
    "grossProfitPaise",
  ])
    if (x[k] !== undefined) x[k.replace("Paise", "")] = rupees(x[k]);
  if (x.items)
    x.items = x.items.map((i) => ({
      ...i,
      sellingPricePerKg: rupees(i.sellingPricePaisePerKg),
      costPerKg: rupees(i.costPaisePerKg),
      lineTotal: rupees(i.lineTotalPaise),
      lineCost: rupees(i.lineCostPaise),
      grossProfit: rupees(i.grossProfitPaise),
    }));
  return x;
};
